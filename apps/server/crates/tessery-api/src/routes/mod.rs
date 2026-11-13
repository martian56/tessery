pub mod access;
pub mod admin;
pub mod audit_log;
pub mod auth;
pub mod delivery;
pub mod dto;
pub mod git;
pub mod mcp;
pub mod orgs;
pub mod projects;
pub mod runtime;
pub mod sso;
pub mod system;
pub mod teams;
pub mod telemetry;
pub mod tokens;

use crate::state::AppState;
use axum::Router;
use axum::routing::{delete, get, patch, post};

pub fn api() -> Router<AppState> {
    Router::new()
        .route("/health", get(system::health))
        .route("/setup", get(system::setup_status).post(system::setup))
        .route("/openapi.json", get(crate::openapi::serve))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me).patch(auth::update_me))
        .route("/auth/password", post(auth::change_password))
        .route("/auth/tokens", get(tokens::list).post(tokens::create))
        .route("/auth/sso", get(sso::info))
        .route("/auth/sso/start", get(sso::start))
        .route("/auth/sso/callback", get(sso::callback))
        .route("/mcp", get(mcp::get).post(mcp::post))
        .route("/auth/tokens/{id}", axum::routing::delete(tokens::revoke))
        .route("/me/permissions", get(auth::my_permissions))
        .route("/permissions", get(access::catalog))
        .route("/orgs", get(orgs::list).post(orgs::create))
        .route(
            "/orgs/{org}",
            get(orgs::get).patch(orgs::update).delete(orgs::delete),
        )
        .route(
            "/orgs/{org}/members",
            get(orgs::list_members).post(orgs::add_member),
        )
        .route("/orgs/{org}/members/{user}", delete(orgs::remove_member))
        .route("/orgs/{org}/teams", get(teams::list).post(teams::create))
        .route(
            "/orgs/{org}/teams/{team}",
            get(teams::get).patch(teams::update).delete(teams::delete),
        )
        .route("/orgs/{org}/teams/{team}/members", post(teams::add_member))
        .route(
            "/orgs/{org}/teams/{team}/members/{user}",
            delete(teams::remove_member),
        )
        .route(
            "/orgs/{org}/roles",
            get(access::list_roles).post(access::create_role),
        )
        .route(
            "/orgs/{org}/roles/{role}",
            patch(access::update_role).delete(access::delete_role),
        )
        .route(
            "/orgs/{org}/bindings",
            get(access::list_bindings).post(access::create_binding),
        )
        .route(
            "/orgs/{org}/bindings/{binding}",
            delete(access::delete_binding),
        )
        .route(
            "/orgs/{org}/projects",
            get(projects::list).post(projects::create),
        )
        .route(
            "/projects/{project}",
            get(projects::get)
                .put(projects::save)
                .delete(projects::delete),
        )
        .route("/projects/{project}/team", patch(projects::move_to_team))
        .route("/projects/{project}/generated", get(projects::generated))
        .route("/projects/{project}/versions", get(projects::versions))
        .route(
            "/projects/{project}/versions/{version}",
            get(projects::version),
        )
        .route(
            "/projects/{project}/checkpoints",
            get(delivery::list_checkpoints).post(delivery::create_checkpoint),
        )
        .route(
            "/projects/{project}/checkpoints/{checkpoint}/doc",
            get(delivery::checkpoint_doc),
        )
        .route(
            "/projects/{project}/checkpoints/{checkpoint}/diff",
            get(delivery::checkpoint_diff),
        )
        .route("/projects/{project}/pipeline", get(delivery::pipeline))
        .route(
            "/projects/{project}/releases",
            get(delivery::list_releases).post(delivery::create_release),
        )
        .route("/projects/{project}/releases/preview", get(delivery::release_preview))
        .route("/releases/{release}/approve", post(delivery::approve))
        .route("/releases/{release}/reject", post(delivery::reject))
        .route("/releases/{release}/cancel", post(delivery::cancel))
        .route("/releases/{release}/logs", get(delivery::release_logs))
        .route("/projects/{project}/environments/{env}/status", get(runtime::status))
        .route("/projects/{project}/environments/{env}/stop", post(delivery::stop_env))
        .route("/projects/{project}/environments/{env}/logs", get(runtime::logs))
        .route("/projects/{project}/environments/{env}/traces", get(telemetry::traces))
        .route("/projects/{project}/environments/{env}/traces/{trace}", get(telemetry::trace))
        .route("/otlp/{project}/{env}/v1/{signal}", post(telemetry::ingest))
        .route("/projects/{project}/environments/{env}/databases/{node}/tables", get(runtime::tables))
        .route("/projects/{project}/environments/{env}/databases/{node}/tables/{table}/rows", get(runtime::rows))
        .route("/projects/{project}/environments/{env}/databases/{node}/sql", post(runtime::sql))
        .route("/projects/{project}/environments/{env}/secrets", get(delivery::list_secrets))
        .route("/projects/{project}/environments/{env}/secrets/{name}", axum::routing::put(delivery::put_secret).delete(delivery::delete_secret))
        .route(
            "/projects/{project}/remote",
            get(delivery::get_remote)
                .put(delivery::put_remote)
                .delete(delivery::delete_remote),
        )
        .route("/projects/{project}/remote/push", post(delivery::push_remote))
        .route(
            "/projects/{project}/repository.bundle",
            get(delivery::bundle),
        )
        .route("/orgs/{org}/audit", get(audit_log::list))
        .route("/orgs/{org}/audit/exports", post(audit_log::create_export))
        .route(
            "/orgs/{org}/audit/exports/{export}",
            get(audit_log::get_export),
        )
        .route(
            "/orgs/{org}/audit/exports/{export}/download",
            get(audit_log::download_export),
        )
        .route("/admin/users", get(admin::users))
        .route("/admin/users/{user}", patch(admin::update_user))
        .route("/admin/orgs", get(admin::orgs))
        .route(
            "/admin/settings",
            get(admin::get_settings).put(admin::put_settings),
        )
}
