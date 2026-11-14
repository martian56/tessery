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
        if !tessery_cloud::allows(i.last_check.as_ref(), "dns") {
            tracing::info!(integration = %i.id, "skipping a Cloudflare account that may not manage DNS");
            continue;
        }
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

/// The host in Tessery's public URL, which is where environments on Tessery's own machine are reached.
fn public_host(url: &str) -> Option<String> {
    let rest = url.trim().split_once("://").map_or(url.trim(), |(_, r)| r);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let host = host.rsplit_once(':').map_or(host, |(h, _)| h).trim().to_ascii_lowercase();
    (!host.is_empty() && host != "localhost" && !host.ends_with(".localhost")).then_some(host)
}

/// Records must lead somewhere people can reach, so loopback, private and link-local addresses are never published.
fn reachable(ip: &str) -> bool {
    ip.parse::<std::net::Ipv4Addr>().is_ok_and(|a| !(a.is_loopback() || a.is_private() || a.is_link_local() || a.is_unspecified() || a.is_broadcast() || (a.octets()[0] == 100 && (a.octets()[1] & 0xc0) == 64)))
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
    let host = match remote.and_then(host_of) {
        Some(h) => h.to_owned(),
        None => match ctx.runner.public_url.as_deref().and_then(public_host) {
            Some(h) => h,
            None => {
                log.line("DNS: not managed, because this environment runs on the machine Tessery itself uses and TESSERY_PUBLIC_URL does not name a public host. Point the records at its public address by hand.");
                return Ok(());
            }
        },
    };
    let Some(ip) = ipv4(&host).await else {
        log.line(format!("DNS: could not find an IPv4 address for {host}, so no records were created"));
        return Ok(());
    };
    if !reachable(&ip) {
        log.line(format!("DNS: {host} is at {ip}, which the internet cannot reach, so no records were created"));
        return Ok(());
    }
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
    use super::{host_of, public_host, reachable};

    #[test]
    fn environments_on_tessery_itself_use_its_public_host() {
        assert_eq!(public_host("https://tessery.example.com").as_deref(), Some("tessery.example.com"));
        assert_eq!(public_host("https://Tessery.Example.com:8443/app?x=1").as_deref(), Some("tessery.example.com"));
        assert_eq!(public_host("http://localhost:5173"), None);
        assert_eq!(public_host("http://app.localhost"), None);
    }

    #[test]
    fn only_public_addresses_get_records() {
        assert!(reachable("167.233.46.141"));
        for ip in ["127.0.0.1", "10.0.0.5", "192.168.1.9", "172.17.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "nope"] {
            assert!(!reachable(ip), "{ip}");
        }
    }

    #[test]
    fn reads_the_host_of_an_ssh_address() {
        assert_eq!(host_of("ssh://deploy@203.0.113.7"), Some("203.0.113.7"));
        assert_eq!(host_of("ssh://root@vps.example.com:2222"), Some("vps.example.com"));
        assert_eq!(host_of("tcp://x"), None);
    }
}
