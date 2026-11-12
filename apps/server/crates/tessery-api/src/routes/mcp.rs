use crate::auth::Principal;
use crate::error::ApiError;
use crate::routes::{delivery, orgs, projects};
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use uuid::Uuid;

const VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

fn tools() -> Value {
    let project = json!({ "type": "string", "description": "Project id from list_projects" });
    json!([
        { "name": "list_projects", "description": "Projects you can see, with ids, versions and node counts.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "design_reference", "description": "Every design operation with its arguments, plus the technology and language catalog. Read this before edit_design.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "create_project", "description": "Create a project, empty or from a template (blank, saas, chat, iot, ai, commerce). Returns its id.",
          "inputSchema": { "type": "object", "properties": { "name": { "type": "string" }, "template": { "type": "string", "default": "blank" }, "org": { "type": "string", "description": "Organization id; defaults to your first one" } }, "required": ["name"] } },
        { "name": "get_project", "description": "The full design document and its version.", "inputSchema": { "type": "object", "properties": { "project": project }, "required": ["project"] } },
        { "name": "edit_design", "description": "Apply design operations in order and save the result as a new version. All or nothing. Use \"$N\" to refer to the result of operation N in the same call.",
          "inputSchema": { "type": "object", "properties": { "project": project, "operations": { "type": "array", "items": { "type": "object", "properties": { "op": { "type": "string" }, "args": { "type": "object" } }, "required": ["op"] } }, "message": { "type": "string" } }, "required": ["project", "operations"] } },
        { "name": "validate_design", "description": "Problems Tessery finds in the design, optionally for one environment.", "inputSchema": { "type": "object", "properties": { "project": project, "env": { "type": "string" } }, "required": ["project"] } },
        { "name": "list_files", "description": "Paths of the code and infrastructure Tessery generates for the current design.", "inputSchema": { "type": "object", "properties": { "project": project, "prefix": { "type": "string" } }, "required": ["project"] } },
        { "name": "read_file", "description": "One generated file.", "inputSchema": { "type": "object", "properties": { "project": project, "path": { "type": "string" } }, "required": ["project", "path"] } },
        { "name": "create_checkpoint", "description": "Commit the saved design and its generated code to the project repository, merged with what developers pushed to main.",
          "inputSchema": { "type": "object", "properties": { "project": project, "name": { "type": "string" }, "message": { "type": "string" } }, "required": ["project", "name"] } },
        { "name": "get_pipeline", "description": "Each environment in order: what it runs, what can be promoted into it, and pending or running deploys.", "inputSchema": { "type": "object", "properties": { "project": project }, "required": ["project"] } },
        { "name": "deploy", "description": "Release a checkpoint to an environment. Defaults to what the pipeline would promote: the latest checkpoint for the first environment, otherwise what the previous environment runs.",
          "inputSchema": { "type": "object", "properties": { "project": project, "env": { "type": "string" }, "checkpoint": { "type": "integer", "description": "Checkpoint number" }, "note": { "type": "string" } }, "required": ["project", "env"] } },
        { "name": "deploy_status", "description": "Status, public URLs and the end of the log of a release.", "inputSchema": { "type": "object", "properties": { "release": { "type": "string" }, "lines": { "type": "integer", "default": 60 } }, "required": ["release"] } },
        { "name": "approve_release", "description": "Approve a release waiting for approval.", "inputSchema": { "type": "object", "properties": { "release": { "type": "string" }, "note": { "type": "string" } }, "required": ["release"] } },
        { "name": "set_secret", "description": "Set an environment secret, such as an API key a service needs. Values are encrypted and cannot be read back.",
          "inputSchema": { "type": "object", "properties": { "project": project, "env": { "type": "string" }, "name": { "type": "string" }, "value": { "type": "string" } }, "required": ["project", "env", "name", "value"] } },
    ])
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ApiError> {
    args.get(key).and_then(Value::as_str).ok_or_else(|| ApiError::BadRequest(format!("`{key}` is required")))
}

fn arg_id(args: &Value, key: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(arg_str(args, key)?).map_err(|_| ApiError::BadRequest(format!("`{key}` must be an id")))
}

fn to_json<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

async fn call(state: &AppState, p: &Principal, name: &str, args: &Value) -> Result<Value, ApiError> {
    let st = || State(state.clone());
    match name {
        "list_projects" => {
            if let Some(only) = p.scope.as_ref().and_then(|s| s.project) {
                let x = projects::get(st(), p.clone(), Path(only)).await?.0;
                return Ok(json!([{ "projects": [{ "id": x.id, "version": x.version, "name": x.doc["name"] }] }]));
            }
            let mut out = Vec::new();
            for o in orgs::list(st(), p.clone()).await?.0 {
                if !o.member && !p.is_instance_admin() {
                    continue;
                }
                let list = projects::list(st(), p.clone(), Path(o.org.id)).await.map(|j| j.0).unwrap_or_default();
                out.push(json!({ "org": { "id": o.org.id, "name": o.org.name }, "projects": list.iter().map(|x| json!({ "id": x.id, "name": x.name, "nodes": x.nodes, "version": x.version })).collect::<Vec<_>>() }));
            }
            Ok(json!(out))
        }
        "design_reference" => {
            let ops = state.engine.describe().await.map_err(delivery::engine_err)?;
            let catalog = state.engine.catalog().await.map_err(delivery::engine_err)?;
            Ok(json!({ "operations": ops["operations"], "catalog": catalog }))
        }
        "create_project" => {
            let org = match args.get("org").and_then(Value::as_str) {
                Some(o) => Uuid::parse_str(o).map_err(|_| ApiError::BadRequest("`org` must be an id".into()))?,
                None => orgs::list(st(), p.clone()).await?.0.into_iter().find(|o| o.member).map(|o| o.org.id).ok_or_else(|| ApiError::BadRequest("you belong to no organization".into()))?,
            };
            let template = args.get("template").and_then(Value::as_str).unwrap_or("blank");
            let doc = state.engine.template(template, Some(arg_str(args, "name")?)).await.map_err(delivery::engine_err)?;
            let created = projects::create(st(), p.clone(), Path(org), Json(projects::CreateProject { slug: None, team_id: None, doc })).await?.1.0;
            Ok(json!({ "id": created.id, "version": created.version, "slug": created.slug }))
        }
        "get_project" => Ok(to_json(projects::get(st(), p.clone(), Path(arg_id(args, "project")?)).await?.0)),
        "edit_design" => {
            let project = arg_id(args, "project")?;
            let ops = args.get("operations").and_then(Value::as_array).ok_or_else(|| ApiError::BadRequest("`operations` must be a list".into()))?;
            let current = projects::get(st(), p.clone(), Path(project)).await?.0;
            let applied = state.engine.apply(&current.doc, ops).await.map_err(delivery::engine_err)?;
            let message = args.get("message").and_then(Value::as_str).unwrap_or("edited by an agent").to_owned();
            let saved = projects::save(st(), p.clone(), Path(project), Json(projects::SaveProject { version: current.version, doc: applied.doc, message })).await?.0;
            let problems = state.engine.validate(&saved.doc, None).await.map_err(delivery::engine_err)?;
            Ok(json!({ "version": saved.version, "results": applied.results, "problems": problems["problems"] }))
        }
        "validate_design" => {
            let current = projects::get(st(), p.clone(), Path(arg_id(args, "project")?)).await?.0;
            state.engine.validate(&current.doc, args.get("env").and_then(Value::as_str)).await.map_err(delivery::engine_err)
        }
        "list_files" | "read_file" => {
            let files = projects::generated(st(), p.clone(), Path(arg_id(args, "project")?)).await?.0.files;
            if name == "list_files" {
                let prefix = args.get("prefix").and_then(Value::as_str).unwrap_or("");
                return Ok(json!(files.keys().filter(|k| k.starts_with(prefix)).collect::<Vec<_>>()));
            }
            let path = arg_str(args, "path")?;
            files.get(path).map(|c| json!(c)).ok_or_else(|| ApiError::BadRequest(format!("{path} is not generated; use list_files")))
        }
        "create_checkpoint" => {
            let project = arg_id(args, "project")?;
            let current = projects::get(st(), p.clone(), Path(project)).await?.0;
            let req = delivery::CreateCheckpoint { name: arg_str(args, "name")?.to_owned(), message: args.get("message").and_then(Value::as_str).unwrap_or("").to_owned(), version: current.version };
            Ok(to_json(delivery::create_checkpoint(st(), p.clone(), Path(project), Json(req)).await?.1.0))
        }
        "get_pipeline" => Ok(to_json(delivery::pipeline(st(), p.clone(), Path(arg_id(args, "project")?)).await?.0)),
        "deploy" => {
            let project = arg_id(args, "project")?;
            let env = arg_str(args, "env")?.to_owned();
            let checkpoint_id = match args.get("checkpoint").and_then(Value::as_i64) {
                Some(seq) => delivery::list_checkpoints(st(), p.clone(), Path(project)).await?.0.into_iter().find(|c| i64::from(c.seq) == seq).map(|c| c.id).ok_or_else(|| ApiError::BadRequest(format!("no checkpoint {seq}")))?,
                None => {
                    let pipe = delivery::pipeline(st(), p.clone(), Path(project)).await?.0;
                    let stage = pipe.stages.iter().find(|s| s.key == env).ok_or_else(|| ApiError::BadRequest(format!("no environment `{env}`")))?;
                    stage.candidate.as_ref().map(|c| c.id).ok_or_else(|| ApiError::Conflict(format!("nothing new to release to {env}; it already runs what the pipeline offers")))?
                }
            };
            let req = delivery::CreateRelease { env, checkpoint_id, note: args.get("note").and_then(Value::as_str).unwrap_or("").to_owned(), redeploy: false };
            Ok(to_json(delivery::create_release(st(), p.clone(), Path(project), Json(req)).await?.1.0))
        }
        "deploy_status" => {
            let release = arg_id(args, "release")?;
            let log = delivery::release_logs(st(), p.clone(), Path(release), Query(delivery::LogQuery { after: 0 })).await?.0;
            let keep = args.get("lines").and_then(Value::as_u64).unwrap_or(60).clamp(1, 500) as usize;
            let lines: Vec<&str> = log.lines.iter().map(|l| l.line.as_str()).collect();
            let tail = &lines[lines.len().saturating_sub(keep)..];
            Ok(json!({ "status": log.release.status, "error": log.release.error, "endpoints": log.release.endpoints, "log": tail }))
        }
        "approve_release" => {
            let note = args.get("note").and_then(Value::as_str).unwrap_or("").to_owned();
            Ok(to_json(delivery::approve(st(), p.clone(), Path(arg_id(args, "release")?), Some(Json(delivery::DecisionBody { note }))).await?.0))
        }
        "set_secret" => {
            let path = Path((arg_id(args, "project")?, arg_str(args, "env")?.to_owned(), arg_str(args, "name")?.to_owned()));
            let _ = delivery::put_secret(st(), p.clone(), path, Json(delivery::PutSecret { value: arg_str(args, "value")?.to_owned() })).await?;
            Ok(json!({ "ok": true }))
        }
        other => Err(ApiError::BadRequest(format!("unknown tool `{other}`"))),
    }
}

fn reply(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

async fn handle(state: &AppState, p: &Principal, msg: &Value) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    Some(match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or(VERSIONS[0]);
            let version = VERSIONS.iter().find(|v| **v == asked).copied().unwrap_or(VERSIONS[0]);
            reply(&id, json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "tessery", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Tessery designs, generates and deploys software systems. Call design_reference first, then create_project or list_projects, edit_design to build the system, create_checkpoint, and deploy to each environment in order. deploy_status shows progress and public URLs.",
            }))
        }
        "ping" => reply(&id, json!({})),
        "tools/list" => reply(&id, json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match call(state, p, name, &args).await {
                Ok(v) => reply(&id, json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }], "isError": false })),
                Err(e) => {
                    if let ApiError::Internal(err) = &e {
                        tracing::error!(error = %err, tool = name, "MCP tool failed");
                    }
                    reply(&id, json!({ "content": [{ "type": "text", "text": e.to_string() }], "isError": true }))
                }
            }
        }
        _ => rpc_error(&id, -32601, &format!("method `{method}` is not supported")),
    })
}

pub async fn post(State(state): State<AppState>, principal: Result<Principal, ApiError>, Json(body): Json<Value>) -> Response {
    let Some(p) = principal.ok().filter(|p| p.scope.is_some()) else {
        let mut r = (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Send an Tessery API token: Authorization: Bearer tessery_..." }))).into_response();
        r.headers_mut().insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer realm=\"Tessery\""));
        return r;
    };
    let replies: Vec<Value> = match &body {
        Value::Array(batch) => {
            let mut out = Vec::new();
            for m in batch {
                if let Some(r) = handle(&state, &p, m).await {
                    out.push(r);
                }
            }
            out
        }
        m => handle(&state, &p, m).await.into_iter().collect(),
    };
    if replies.is_empty() {
        return StatusCode::ACCEPTED.into_response();
    }
    if body.is_array() { Json(Value::Array(replies)).into_response() } else { Json(replies.into_iter().next().unwrap_or(Value::Null)).into_response() }
}

pub async fn get() -> Response {
    (StatusCode::METHOD_NOT_ALLOWED, [(header::ALLOW, "POST")], "This server answers over POST only.").into_response()
}
