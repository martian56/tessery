use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::ApiError;
use crate::rbac;
use crate::state::AppState;
use tessery_core::Permission as P;
use axum::body::{Body, Bytes};
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;
use uuid::Uuid;

fn plain(status: StatusCode, msg: &str) -> Response {
    (status, [(header::CONTENT_TYPE, "text/plain; charset=utf-8")], format!("{msg}\n")).into_response()
}

fn challenge() -> Response {
    let mut r = plain(StatusCode::UNAUTHORIZED, "Use an Tessery API token as the password (Account > API tokens).");
    r.headers_mut().insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Basic realm=\"Tessery\""));
    r
}

fn protected(r: &str) -> bool {
    r.starts_with("refs/heads/env/") || r.starts_with("refs/heads/tessery/") || r.starts_with("refs/tags/checkpoint/")
}

fn pushed_refs(body: &[u8]) -> Vec<String> {
    let mut refs = Vec::new();
    let mut at = 0;
    while at + 4 <= body.len() {
        let Some(len) = std::str::from_utf8(&body[at..at + 4]).ok().and_then(|h| usize::from_str_radix(h, 16).ok()) else { break };
        if len == 0 || len < 4 || at + len > body.len() {
            break;
        }
        let line = String::from_utf8_lossy(&body[at + 4..at + len]);
        let cmd = line.split('\0').next().unwrap_or_default().trim_end();
        if let Some(name) = cmd.split(' ').nth(2) {
            refs.push(name.to_owned());
        }
        at += len;
    }
    refs
}

pub async fn serve(
    State(state): State<AppState>,
    principal: Result<Principal, ApiError>,
    Path((repo, rest)): Path<(String, String)>,
    RawQuery(query): RawQuery,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(project) = repo.strip_suffix(".git").and_then(|id| Uuid::parse_str(id).ok()) else {
        return plain(StatusCode::NOT_FOUND, "Repository not found.");
    };
    let query = query.unwrap_or_default();
    let service = match (rest.as_str(), &method) {
        ("info/refs", &Method::GET) => query.split('&').find_map(|kv| kv.strip_prefix("service=")).unwrap_or("").to_owned(),
        ("git-upload-pack", &Method::POST) => "git-upload-pack".into(),
        ("git-receive-pack", &Method::POST) => "git-receive-pack".into(),
        _ => return plain(StatusCode::NOT_FOUND, "Only the smart HTTP protocol is supported."),
    };
    let push = match service.as_str() {
        "git-upload-pack" => false,
        "git-receive-pack" => true,
        _ => return plain(StatusCode::FORBIDDEN, "Update your git client; only smart HTTP is supported."),
    };
    let p = match principal {
        Ok(p) => p,
        Err(_) => return challenge(),
    };
    let target = match rbac::project_target(&state, project).await {
        Ok(t) => t,
        Err(_) => return plain(StatusCode::NOT_FOUND, "Repository not found."),
    };
    let perm = if push { P::ProjectEdit } else { P::ProjectRead };
    if let Err(e) = rbac::require(&state, &p, &target, perm).await {
        return match e {
            ApiError::NotFound => plain(StatusCode::NOT_FOUND, "Repository not found."),
            _ => plain(StatusCode::FORBIDDEN, &format!("Your token or role lacks {}.", perm.as_str())),
        };
    }

    let encoded = headers.get(header::CONTENT_ENCODING).and_then(|v| v.to_str().ok()).is_some_and(|e| !e.eq_ignore_ascii_case("identity"));
    if push && method == Method::POST && encoded {
        return plain(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Compressed pushes are not accepted.");
    }
    let refs = if push && method == Method::POST { pushed_refs(&body) } else { Vec::new() };
    if let Some(r) = refs.iter().find(|r| protected(r)) {
        return plain(StatusCode::FORBIDDEN, &format!("{r} is managed by Tessery and cannot be pushed to. Push to main or a feature branch."));
    }
    let exists = state.repos.path(project).join("HEAD").exists();
    if !exists {
        if !push {
            return plain(StatusCode::NOT_FOUND, "This project has no checkpoints yet, so its repository is empty.");
        }
        if let Err(e) = state.repos.ensure(project).await {
            tracing::error!(error = %e, %project, "creating repository for push");
            return plain(StatusCode::INTERNAL_SERVER_ERROR, "Could not create the repository.");
        }
    }

    let header_str = |h: header::HeaderName| headers.get(h).and_then(|v| v.to_str().ok());
    let path = format!("/{rest}");
    let result = state
        .repos
        .http_backend(
            project,
            tessery_git::HttpRequest {
                method: method.as_str(),
                path: &path,
                query: &query,
                content_type: header_str(header::CONTENT_TYPE).unwrap_or(""),
                content_encoding: header_str(header::CONTENT_ENCODING),
                git_protocol: headers.get("git-protocol").and_then(|v| v.to_str().ok()),
                user: &p.user.email,
                body: &body,
            },
        )
        .await;
    let out = match result {
        Ok(o) => o,
        Err(e) => {
            tracing::error!(error = %e, %project, "git http-backend failed");
            return plain(StatusCode::INTERNAL_SERVER_ERROR, "git failed on the server.");
        }
    };
    if !refs.is_empty() && out.status == 200 {
        let entry = Entry::new(Some(target.org().0), "git.push", "project", project).details(json!({ "refs": refs }));
        if let Err(e) = audit::record(&state.db, &p, entry).await {
            tracing::warn!(error = %e, "could not audit a push");
        }
    }
    let mut resp = Response::builder().status(out.status);
    for (k, v) in &out.headers {
        resp = resp.header(k.as_str(), v.as_str());
    }
    resp.body(Body::from(out.body)).unwrap_or_else(|_| plain(StatusCode::INTERNAL_SERVER_ERROR, "Bad response from git."))
}
