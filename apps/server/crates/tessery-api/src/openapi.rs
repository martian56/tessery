use crate::routes::{access, admin, audit_log, auth, delivery, dto, integrations, orgs, projects, runtime, servers, sso, system, teams, telemetry, tokens};
use axum::Json;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(title = "Tessery API", version = env!("CARGO_PKG_VERSION"), description = "Self-hosted system design, code generation and deployment platform."),
    paths(
        system::health, system::setup_status, system::setup,
        auth::login, auth::logout, auth::me, auth::update_me, auth::change_password, auth::my_permissions,
        access::catalog, access::list_roles, access::create_role, access::update_role, access::delete_role,
        access::list_bindings, access::create_binding, access::delete_binding,
        orgs::list, orgs::create, orgs::get, orgs::update, orgs::delete, orgs::list_members, orgs::add_member, orgs::remove_member,
        integrations::providers, integrations::list, integrations::create, integrations::update, integrations::check, integrations::delete,
        servers::list, servers::create, servers::provision, integrations::catalog, servers::update, servers::delete, servers::check,
        teams::list, teams::create, teams::get, teams::update, teams::delete, teams::add_member, teams::remove_member,
        projects::list, projects::create, projects::get, projects::save, projects::move_to_team, projects::delete, projects::versions, projects::version, projects::generated,
        delivery::list_checkpoints, delivery::create_checkpoint, delivery::checkpoint_doc, delivery::checkpoint_diff,
        delivery::pipeline, delivery::list_releases, delivery::create_release, delivery::release_preview, delivery::approve, delivery::reject, delivery::cancel,
        delivery::get_remote, delivery::put_remote, delivery::delete_remote, delivery::push_remote, delivery::bundle,
        tokens::list, tokens::create, tokens::revoke, sso::info,
        runtime::status, runtime::logs, runtime::tables, runtime::rows, runtime::sql, telemetry::traces, telemetry::trace,
        delivery::stop_env, delivery::release_logs, delivery::list_secrets, delivery::put_secret, delivery::delete_secret,
        audit_log::list, audit_log::create_export, audit_log::get_export, audit_log::download_export,
        admin::users, admin::update_user, admin::orgs, admin::get_settings, admin::put_settings,
    ),
    components(schemas(crate::error::ErrorBody, dto::UserDto, dto::OrgDto, dto::Ok)),
    tags(
        (name = "system"), (name = "auth"), (name = "orgs"), (name = "members"), (name = "teams"), (name = "servers", description = "Machines with Docker that environments deploy to over SSH"), (name = "integrations", description = "Cloud provider accounts connected to an organization"),
        (name = "access", description = "Roles, permissions and access grants"), (name = "projects"),
        (name = "delivery", description = "Checkpoints, environment pipeline and git remotes"), (name = "audit"),
        (name = "admin", description = "Instance administration"),
    )
)]
pub struct ApiDoc;

pub async fn serve() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}
