use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::config::ObjectStore;
use crate::error::{ApiError, ApiResult};
use crate::rbac;
use crate::routes::dto::{OK, Ok};
use crate::state::AppState;
use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tessery_core::Permission as P;
use tessery_db::assets as db;
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

pub const MAX_BYTES: usize = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

fn store(state: &AppState) -> ApiResult<&ObjectStore> {
    state.config.object_store.as_ref().ok_or_else(|| ApiError::Conflict("object storage is not set up; set TESSERY_S3_ENDPOINT".into()))
}

/// The type of an upload, read from its first bytes rather than trusted from the browser.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    let head = &bytes[..bytes.len().min(512)];
    let starts = |sig: &[u8]| head.starts_with(sig);
    if starts(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if starts(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if starts(b"GIF87a") || starts(b"GIF89a") {
        Some("image/gif")
    } else if head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        Some("image/webp")
    } else if head.len() >= 12 && &head[4..8] == b"ftyp" && (&head[8..12] == b"avif" || &head[8..12] == b"avis") {
        Some("image/avif")
    } else if head.len() >= 12 && &head[4..8] == b"ftyp" {
        Some("video/mp4")
    } else if starts(b"wOF2") {
        Some("font/woff2")
    } else if starts(b"wOFF") {
        Some("font/woff")
    } else {
        let text = String::from_utf8_lossy(head).trim_start_matches('\u{feff}').trim_start().to_ascii_lowercase();
        ((text.starts_with("<svg") || text.starts_with("<?xml")) && String::from_utf8_lossy(bytes).to_ascii_lowercase().contains("<svg")).then_some("image/svg+xml")
    }
}

/// Width and height of PNG, GIF, JPEG and WebP images, read from their headers.
pub fn dimensions(bytes: &[u8], kind: &str) -> Option<(u32, u32)> {
    let be16 = |i: usize| bytes.get(i..i + 2).map(|b| u32::from(u16::from_be_bytes([b[0], b[1]])));
    let le16 = |i: usize| bytes.get(i..i + 2).map(|b| u32::from(u16::from_le_bytes([b[0], b[1]])));
    let be32 = |i: usize| bytes.get(i..i + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]));
    match kind {
        "image/png" => Some((be32(16)?, be32(20)?)),
        "image/gif" => Some((le16(6)?, le16(8)?)),
        "image/webp" => match bytes.get(12..16)? {
            b"VP8X" => {
                let w = 1 + (u32::from(bytes[24]) | u32::from(bytes[25]) << 8 | u32::from(bytes[26]) << 16);
                let h = 1 + (u32::from(bytes[27]) | u32::from(bytes[28]) << 8 | u32::from(bytes[29]) << 16);
                Some((w, h))
            }
            b"VP8L" => {
                let b = bytes.get(21..25)?;
                let bits = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
            }
            b"VP8 " => Some((le16(26)? & 0x3fff, le16(28)? & 0x3fff)),
            _ => None,
        },
        "image/jpeg" => {
            let mut i = 2;
            while i + 9 < bytes.len() {
                if bytes[i] != 0xff {
                    return None;
                }
                let marker = bytes[i + 1];
                let len = be16(i + 2)? as usize;
                if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
                    return Some((be16(i + 7)?, be16(i + 5)?));
                }
                i += 2 + len;
            }
            None
        }
        _ => None,
    }
}

fn clean_name(name: &str, kind: &str) -> String {
    let stem: String = name.rsplit(['/', '\\']).next().unwrap_or_default().chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c.to_ascii_lowercase() } else { '-' }).collect();
    let stem = stem.trim_matches(['-', '.']).to_owned();
    let ext = match kind {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        "video/mp4" => "mp4",
        "font/woff2" => "woff2",
        _ => "woff",
    };
    let base = stem.rsplit_once('.').map(|(b, _)| b.to_owned()).unwrap_or(stem);
    let base: String = base.trim_matches(['-', '.']).chars().take(80).collect();
    format!("{}.{ext}", if base.is_empty() { "asset".to_owned() } else { base })
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetDto {
    pub id: Uuid,
    pub name: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    /// What a page stores to use this asset, for example as an image source.
    pub reference: String,
    /// Where the editor loads it from.
    pub url: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<db::Asset> for AssetDto {
    fn from(a: db::Asset) -> Self {
        Self { reference: format!("asset:{}/{}", a.id, a.name), url: format!("/api/assets/{}/{}", a.id, a.name), id: a.id, name: a.name, content_type: a.content_type, size_bytes: a.size_bytes, width: a.width, height: a.height, created_at: a.created_at }
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct UploadQuery {
    /// The original file name; it is cleaned and given the extension of the detected type.
    pub name: String,
}

/// Uploads an image, video or font. Send the file as the raw request body.
#[utoipa::path(post, path = "/api/projects/{project}/assets/upload", tag = "assets", params(("project" = Uuid, Path), UploadQuery), request_body(content = Vec<u8>, content_type = "application/octet-stream"), responses((status = 201, body = AssetDto), (status = 413), (status = 415)))]
pub async fn upload(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>, Query(q): Query<UploadQuery>, body: Bytes) -> ApiResult<Response> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    let store = store(&state)?;
    let kind = sniff(&body).ok_or_else(|| ApiError::invalid("file", "upload a PNG, JPEG, GIF, WebP, AVIF or SVG image, an MP4 video, or a WOFF or WOFF2 font"))?;
    let limit = if kind.starts_with("image/") { MAX_IMAGE_BYTES } else { MAX_BYTES };
    if body.is_empty() || body.len() > limit {
        return Ok((StatusCode::PAYLOAD_TOO_LARGE, Json(json!({ "error": "too_large", "message": format!("the file must be under {} MB", limit / 1024 / 1024) }))).into_response());
    }
    let (width, height) = dimensions(&body, kind).map(|(w, h)| (Some(w as i32), Some(h as i32))).unwrap_or((None, None));
    let id = Uuid::now_v7();
    let name = clean_name(&q.name, kind);
    let key = format!("projects/{project}/assets/{id}");
    store.s3.ensure_bucket(&store.bucket).await.map_err(ApiError::Conflict)?;
    store.s3.put(&store.bucket, &key, &body).await.map_err(ApiError::Conflict)?;
    let asset = db::insert(
        &state.db,
        db::NewAsset { id, project_id: project, name: &name, content_type: kind, size_bytes: body.len() as i64, sha256: &Sha256::digest(&body), width, height, created_by: p.user.id },
    )
    .await?;
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "asset.upload", "project", project).decision(d).details(json!({ "asset": id, "name": name, "type": kind, "bytes": body.len() }))).await?;
    Ok((StatusCode::CREATED, Json(AssetDto::from(asset))).into_response())
}

#[utoipa::path(get, path = "/api/projects/{project}/assets", tag = "assets", params(("project" = Uuid, Path)), responses((status = 200, body = [AssetDto])))]
pub async fn list(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<AssetDto>>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    Ok(Json(db::list(&state.db, project).await?.into_iter().map(Into::into).collect()))
}

/// Serves an asset to the editor. Generated apps ship their own copies, so deployed sites never call this.
#[utoipa::path(get, path = "/api/assets/{asset}/{name}", tag = "assets", params(("asset" = Uuid, Path), ("name" = String, Path)), responses((status = 200), (status = 404)))]
pub async fn serve(State(state): State<AppState>, p: Principal, Path((id, _name)): Path<(Uuid, String)>, headers: HeaderMap) -> ApiResult<Response> {
    let asset = db::get(&state.db, id).await?;
    let target = rbac::project_target(&state, asset.project_id).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    let etag = format!("\"{}\"", hex::encode(&asset.sha256));
    if headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(etag.as_str()) {
        return Ok(StatusCode::NOT_MODIFIED.into_response());
    }
    let store = store(&state)?;
    let bytes = store.s3.get(&store.bucket, &asset.object_key()).await.map_err(ApiError::Conflict)?;
    let mut res = bytes.into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&asset.content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
    h.insert(header::ETAG, HeaderValue::from_str(&etag).unwrap_or(HeaderValue::from_static("\"\"")));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"));
    Ok(res)
}

#[utoipa::path(delete, path = "/api/projects/{project}/assets/{asset}", tag = "assets", params(("project" = Uuid, Path), ("asset" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete(State(state): State<AppState>, p: Principal, Path((project, id)): Path<(Uuid, Uuid)>) -> ApiResult<Json<Ok>> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    let asset = db::delete(&state.db, project, id).await?;
    if let Ok(store) = store(&state)
        && let Err(e) = store.s3.delete(&store.bucket, &asset.object_key()).await
    {
        tracing::warn!(error = %e, asset = %id, "the asset row was deleted but its bytes could not be");
    }
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "asset.delete", "project", project).decision(d).details(json!({ "asset": id, "name": asset.name }))).await?;
    Ok(Json(OK))
}

/// Asset references (`asset:<id>/<name>`) used anywhere in a value, such as a page tree.
pub fn references(value: &serde_json::Value) -> Vec<Uuid> {
    let text = value.to_string();
    let mut out: Vec<Uuid> = text.match_indices("asset:").filter_map(|(i, _)| text.get(i + 6..i + 42)).filter_map(|s| Uuid::parse_str(s).ok()).collect();
    out.sort();
    out.dedup();
    out
}

/// Copies every asset the design uses into each web app's public folder, so the deployed site serves it itself.
pub async fn bundle(state: &AppState, project: Uuid, doc: &serde_json::Value, files: &mut std::collections::BTreeMap<String, Vec<u8>>) -> ApiResult<()> {
    let apps: Vec<(String, String)> = doc["nodes"].as_array().into_iter().flatten().filter(|n| n["techId"] == "web-app").filter_map(|n| Some((n["id"].as_str()?.to_owned(), n["name"].as_str()?.to_owned()))).collect();
    for (app_id, app_name) in apps {
        let pages: Vec<&serde_json::Value> = doc["pages"].as_array().into_iter().flatten().filter(|p| p["appNodeId"] == app_id.as_str()).collect();
        let mut used = references(&serde_json::Value::Array(pages.into_iter().cloned().collect()));
        used.extend(references(&doc["themes"][&app_id]));
        if used.is_empty() {
            continue;
        }
        let store = store(state)?;
        for asset in db::many(&state.db, project, &used).await? {
            let bytes = store.s3.get(&store.bucket, &asset.object_key()).await.map_err(|e| ApiError::Conflict(format!("could not read asset {}: {e}", asset.name)))?;
            files.insert(format!("apps/{app_name}/public/assets/{}/{}", asset.id, asset.name), bytes);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_types_from_content_not_names() {
        let png = [b"\x89PNG\r\n\x1a\n".as_slice(), &[0, 0, 0, 13], b"IHDR", &640u32.to_be_bytes(), &480u32.to_be_bytes()].concat();
        assert_eq!(sniff(&png), Some("image/png"));
        assert_eq!(dimensions(&png, "image/png"), Some((640, 480)));
        let gif = [b"GIF89a".as_slice(), &[0x20, 0x03, 0x58, 0x02]].concat();
        assert_eq!(sniff(&gif), Some("image/gif"));
        assert_eq!(dimensions(&gif, "image/gif"), Some((800, 600)));
        assert_eq!(sniff(b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"), Some("image/svg+xml"));
        assert_eq!(sniff(b"<html><script>alert(1)</script></html>"), None, "HTML renamed to .png is refused");
        assert_eq!(sniff(b"MZ\x90\x00"), None);
        assert_eq!(clean_name("../My Photo (1).JPEG", "image/jpeg"), "my-photo--1.jpg");
        assert_eq!(clean_name("evil.html", "image/png"), "evil.png", "the extension follows the detected type");
        let ids = references(&json!({ "root": { "props": { "src": "asset:0193f3a4-0000-7000-8000-000000000001/hero.png" } } }));
        assert_eq!(ids.len(), 1);
    }
}
