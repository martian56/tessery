use crate::deploy::Log;
use crate::jobs::Ctx;
use anyhow::{Result, anyhow};
use serde_json::{Map, Value};
use tessery_cloud::{DnsChange, Zone};
use uuid::Uuid;

async fn cloudflare_accounts(ctx: &Ctx, org: Uuid) -> Result<Vec<(Map<String, Value>, Vec<Zone>)>> {
    let key = ctx.secret_key.as_ref().ok_or_else(|| anyhow!("TESSERY_SECRET_KEY is not set on the worker"))?;
    let apis = tessery_cloud::endpoints_from_env();
    let mut out = Vec::new();
    for i in tessery_db::integrations::list(&ctx.db, org).await?.into_iter().filter(|i| i.provider == "cloudflare") {
        let (_, cipher) = tessery_db::integrations::secret(&ctx.db, org, i.id).await?;
        let fields: Map<String, Value> = serde_json::from_slice(&key.decrypt(&cipher)?)?;
        match tessery_cloud::cloudflare_zones(&fields, &apis).await {
            Ok(zones) => out.push((fields, zones)),
            Err(e) => tracing::warn!(integration = %i.id, error = %e, "a Cloudflare account could not list its zones"),
        }
    }
    Ok(out)
}

fn host_of(address: &str) -> Option<&str> {
    let rest = address.strip_prefix("ssh://")?;
    let host = rest.rsplit_once('@').map_or(rest, |(_, h)| h);
    Some(host.rsplit_once(':').map_or(host, |(h, _)| h))
}

async fn ipv4(host: &str) -> Option<String> {
    if host.parse::<std::net::Ipv4Addr>().is_ok() {
        return Some(host.to_owned());
    }
    tokio::net::lookup_host((host, 22)).await.ok()?.find(|a| a.is_ipv4()).map(|a| a.ip().to_string())
}

pub async fn publish(ctx: &Ctx, project: Uuid, env: &str, plan: &Value, remote: Option<&str>, log: &Log) -> Result<()> {
    let names = tessery_cloud::dns_names(plan);
    if names.is_empty() {
        return Ok(());
    }
    let org = tessery_db::servers::org_of_project(&ctx.db, project).await?;
    let accounts = cloudflare_accounts(ctx, org).await?;
    if accounts.is_empty() {
        return Ok(());
    }
    let Some(host) = remote.and_then(host_of) else {
        log.line("DNS: not managed, because this environment runs on the machine Tessery itself uses. Point the records at its public address by hand.");
        return Ok(());
    };
    let Some(ip) = ipv4(host).await else {
        log.line(format!("DNS: could not find an IPv4 address for {host}, so no records were created"));
        return Ok(());
    };
    let apis = tessery_cloud::endpoints_from_env();
    let tag = tessery_cloud::dns_tag(&project.to_string(), env);
    for name in names {
        let bare = name.trim_start_matches("*.");
        let Some((fields, zone)) = accounts.iter().find_map(|(f, zones)| tessery_cloud::zone_for(zones, bare).map(|z| (f, z))) else {
            log.line(format!("DNS: {name} is not in a connected Cloudflare zone; add its record by hand"));
            continue;
        };
        match tessery_cloud::ensure_a_record(fields, &apis, &zone.id, &name, &ip, &tag).await {
            Ok(DnsChange::Created) => log.line(format!("DNS: created {name} -> {ip} on Cloudflare")),
            Ok(DnsChange::Updated) => log.line(format!("DNS: pointed {name} at {ip} on Cloudflare")),
            Ok(DnsChange::Unchanged) => log.line(format!("DNS: {name} already points at {ip}")),
            Ok(DnsChange::Taken { content }) => log.line(format!("DNS: {name} already exists on Cloudflare pointing at {content} and was not made by Tessery, so it was left alone")),
            Err(e) => log.line(format!("DNS: could not set {name} on Cloudflare: {e}")),
        }
    }
    Ok(())
}

pub async fn unpublish(ctx: &Ctx, org: Uuid, project: Uuid, env: &str, log: &Log) -> Result<()> {
    let apis = tessery_cloud::endpoints_from_env();
    let tag = tessery_cloud::dns_tag(&project.to_string(), env);
    for (fields, zones) in cloudflare_accounts(ctx, org).await? {
        for zone in zones {
            match tessery_cloud::delete_tagged_records(&fields, &apis, &zone.id, &tag).await {
                Ok(removed) => removed.iter().for_each(|n| log.line(format!("DNS: removed {n} from Cloudflare"))),
                Err(e) => log.line(format!("DNS: could not clean up {}: {e}", zone.name)),
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::host_of;

    #[test]
    fn reads_the_host_of_an_ssh_address() {
        assert_eq!(host_of("ssh://deploy@203.0.113.7"), Some("203.0.113.7"));
        assert_eq!(host_of("ssh://root@vps.example.com:2222"), Some("vps.example.com"));
        assert_eq!(host_of("tcp://x"), None);
    }
}
