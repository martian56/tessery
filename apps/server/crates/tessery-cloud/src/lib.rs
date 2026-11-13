use serde::Serialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::time::Duration;
use time::OffsetDateTime;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct FieldSpec {
    pub key: &'static str,
    pub label: &'static str,
    pub secret: bool,
    pub multiline: bool,
    pub optional: bool,
    pub placeholder: &'static str,
}

#[derive(Serialize, ToSchema, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSpec {
    pub id: &'static str,
    pub name: &'static str,
    /// Where to create the credential, shown next to the form.
    pub help: &'static str,
    #[schema(value_type = Vec<FieldSpec>)]
    pub fields: &'static [FieldSpec],
}

const fn field(key: &'static str, label: &'static str, secret: bool, placeholder: &'static str) -> FieldSpec {
    FieldSpec { key, label, secret, multiline: false, optional: false, placeholder }
}

pub const PROVIDERS: &[ProviderSpec] = &[
    ProviderSpec {
        id: "hetzner",
        name: "Hetzner Cloud",
        help: "In the Hetzner Cloud console, open the project, then Security, API tokens, and generate a Read & Write token.",
        fields: &[field("token", "API token", true, "")],
    },
    ProviderSpec {
        id: "digitalocean",
        name: "DigitalOcean",
        help: "In the DigitalOcean control panel, open API, Tokens, and generate a token with read and write scope.",
        fields: &[field("token", "API token", true, "dop_v1_...")],
    },
    ProviderSpec {
        id: "aws",
        name: "Amazon Web Services",
        help: "In IAM, create a user for Tessery with the permissions it should have, then create an access key for it.",
        fields: &[
            field("accessKeyId", "Access key ID", false, "AKIA..."),
            field("secretAccessKey", "Secret access key", true, ""),
            FieldSpec { key: "region", label: "Default region", secret: false, multiline: false, optional: true, placeholder: "us-east-1" },
        ],
    },
    ProviderSpec {
        id: "gcp",
        name: "Google Cloud",
        help: "In IAM & Admin, Service accounts, create a service account with the roles Tessery needs, then add a JSON key and paste the file.",
        fields: &[FieldSpec { key: "serviceAccount", label: "Service account key (JSON)", secret: true, multiline: true, optional: false, placeholder: "{\"type\": \"service_account\", ...}" }],
    },
    ProviderSpec {
        id: "azure",
        name: "Microsoft Azure",
        help: "Register an app in Microsoft Entra ID, add a client secret, and give it a role on the subscription.",
        fields: &[
            field("tenantId", "Tenant ID", false, "00000000-0000-0000-0000-000000000000"),
            field("clientId", "Client ID", false, "00000000-0000-0000-0000-000000000000"),
            field("clientSecret", "Client secret", true, ""),
            field("subscriptionId", "Subscription ID", false, "00000000-0000-0000-0000-000000000000"),
        ],
    },
];

pub fn provider(id: &str) -> Option<&'static ProviderSpec> {
    PROVIDERS.iter().find(|p| p.id == id)
}

pub fn clean(spec: &ProviderSpec, input: &Map<String, Value>) -> Result<Map<String, Value>, String> {
    let mut out = Map::new();
    for f in spec.fields {
        let v = input.get(f.key).and_then(Value::as_str).map(str::trim).unwrap_or_default();
        if v.is_empty() {
            if f.optional {
                continue;
            }
            return Err(format!("{} is required", f.label));
        }
        if !f.multiline && v.contains(char::is_whitespace) {
            return Err(format!("{} cannot contain spaces", f.label));
        }
        out.insert(f.key.to_owned(), Value::String(v.to_owned()));
    }
    Ok(out)
}

fn mask(v: &str) -> String {
    let n = v.chars().count();
    if n <= 8 { "••••".into() } else { format!("{}…{}", v.chars().take(4).collect::<String>(), v.chars().skip(n - 4).collect::<String>()) }
}

pub fn summary(provider: &str, f: &Map<String, Value>) -> Value {
    let s = |k: &str| f.get(k).and_then(Value::as_str).unwrap_or_default();
    match provider {
        "aws" => json!({ "accessKeyId": mask(s("accessKeyId")), "region": f.get("region").and_then(Value::as_str).unwrap_or("us-east-1") }),
        "azure" => json!({ "tenantId": s("tenantId"), "clientId": s("clientId"), "subscriptionId": s("subscriptionId") }),
        "gcp" => serde_json::from_str::<Value>(s("serviceAccount")).map(|j| json!({ "clientEmail": j["client_email"], "projectId": j["project_id"] })).unwrap_or(json!({})),
        _ => json!({ "token": mask(s("token")) }),
    }
}

pub type Endpoints = std::collections::BTreeMap<String, String>;

pub fn endpoints_from_env() -> Endpoints {
    ["hetzner", "digitalocean", "aws", "azure", "azure_login"]
        .iter()
        .filter_map(|p| std::env::var(format!("TESSERY_{}_API", p.to_uppercase())).ok().map(|v| ((*p).to_owned(), v)))
        .collect()
}

fn endpoint(apis: &Endpoints, provider: &str, default: &str) -> String {
    apis.get(provider).cloned().unwrap_or_else(|| default.to_owned())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(15)).user_agent("tessery").build().expect("an HTTP client")
}

fn status_error(name: &str, status: reqwest::StatusCode, body: &str) -> String {
    let detail: String = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").or(v.get("message")).or(v.get("error_description")).and_then(Value::as_str).map(str::to_owned))
        .or_else(|| between(body, "<Message>", "</Message>"))
        .unwrap_or_else(|| status.canonical_reason().unwrap_or("error").to_owned());
    match status.as_u16() {
        401 | 403 => format!("{name} rejected the credentials: {detail}"),
        _ => format!("{name} answered {}: {detail}", status.as_u16()),
    }
}

fn form_body(pairs: &[(&str, &str)]) -> String {
    let enc = |v: &str| v.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<_>>().join("&")
}

fn between(s: &str, a: &str, b: &str) -> Option<String> {
    let start = s.find(a)? + a.len();
    let end = s[start..].find(b)? + start;
    Some(s[start..end].to_owned())
}

async fn send(name: &str, req: reqwest::RequestBuilder) -> Result<String, String> {
    let r = req.send().await.map_err(|e| format!("could not reach {name}: {e}"))?;
    let status = r.status();
    let body = r.text().await.unwrap_or_default();
    if status.is_success() { Ok(body) } else { Err(status_error(name, status, &body)) }
}

pub async fn verify(provider: &str, f: &Map<String, Value>, apis: &Endpoints) -> Result<String, String> {
    let s = |k: &str| f.get(k).and_then(Value::as_str).unwrap_or_default().to_owned();
    let http = client();
    match provider {
        "hetzner" => {
            let base = endpoint(apis, "hetzner", "https://api.hetzner.cloud/v1");
            send("Hetzner", http.get(format!("{base}/locations")).bearer_auth(s("token"))).await?;
            Ok("Hetzner Cloud project".into())
        }
        "digitalocean" => {
            let base = endpoint(apis, "digitalocean", "https://api.digitalocean.com/v2");
            let body = send("DigitalOcean", http.get(format!("{base}/account")).bearer_auth(s("token"))).await?;
            let v: Value = serde_json::from_str(&body).unwrap_or_default();
            let team = v.pointer("/account/team/name").and_then(Value::as_str);
            let email = v.pointer("/account/email").and_then(Value::as_str).unwrap_or("DigitalOcean account");
            Ok(team.map_or(email.to_owned(), |t| format!("{email} ({t})")))
        }
        "aws" => {
            let base = endpoint(apis, "aws", "https://sts.amazonaws.com");
            let host = base.trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/').to_owned();
            let body = "Action=GetCallerIdentity&Version=2011-06-15";
            let now = OffsetDateTime::now_utc();
            let amz = format!("{:04}{:02}{:02}T{:02}{:02}{:02}Z", now.year(), now.month() as u8, now.day(), now.hour(), now.minute(), now.second());
            let headers = [("content-type", "application/x-www-form-urlencoded; charset=utf-8"), ("host", host.as_str()), ("x-amz-date", amz.as_str())];
            let auth = sigv4(&SigV4 { method: "POST", path: "/", query: "", headers: &headers, payload: body.as_bytes(), region: "us-east-1", service: "sts", access_key: &s("accessKeyId"), secret: &s("secretAccessKey"), amz_date: &amz });
            let resp = send("AWS", http.post(format!("{base}/")).header("content-type", headers[0].1).header("x-amz-date", &amz).header("authorization", auth).body(body)).await?;
            let arn = between(&resp, "<Arn>", "</Arn>").unwrap_or_default();
            let account = between(&resp, "<Account>", "</Account>").unwrap_or_default();
            Ok(if arn.is_empty() { format!("AWS account {account}") } else { arn })
        }
        "gcp" => {
            let j: Value = serde_json::from_str(&s("serviceAccount")).map_err(|_| "the service account key is not valid JSON".to_owned())?;
            if j["type"] != "service_account" {
                return Err("this is not a service account key; download a JSON key from IAM & Admin, Service accounts".into());
            }
            let email = j["client_email"].as_str().ok_or("the key has no client_email")?;
            if !j["private_key"].as_str().is_some_and(|k| k.contains("BEGIN PRIVATE KEY")) {
                return Err("the key has no private_key".into());
            }
            Ok(format!("{email} in {}", j["project_id"].as_str().unwrap_or("an unknown project")))
        }
        "azure" => {
            let login = endpoint(apis, "azure_login", "https://login.microsoftonline.com");
            let mgmt = endpoint(apis, "azure", "https://management.azure.com");
            let form = [("grant_type", "client_credentials"), ("client_id", &s("clientId")), ("client_secret", &s("clientSecret")), ("scope", "https://management.azure.com/.default")];
            let token = send("Microsoft Entra ID", http.post(format!("{login}/{}/oauth2/v2.0/token", s("tenantId"))).header("content-type", "application/x-www-form-urlencoded").body(form_body(&form))).await?;
            let token = serde_json::from_str::<Value>(&token).ok().and_then(|v| v["access_token"].as_str().map(str::to_owned)).ok_or("Microsoft Entra ID returned no token")?;
            let sub = send("Azure", http.get(format!("{mgmt}/subscriptions/{}?api-version=2022-12-01", s("subscriptionId"))).bearer_auth(token)).await?;
            let v: Value = serde_json::from_str(&sub).unwrap_or_default();
            Ok(v["displayName"].as_str().map_or_else(|| format!("subscription {}", s("subscriptionId")), str::to_owned))
        }
        other => Err(format!("unknown provider {other}")),
    }
}

pub struct SigV4<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub headers: &'a [(&'a str, &'a str)],
    pub payload: &'a [u8],
    pub region: &'a str,
    pub service: &'a str,
    pub access_key: &'a str,
    pub secret: &'a str,
    pub amz_date: &'a str,
}

fn hmac(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut k = if key.len() > 64 { Sha256::digest(key).to_vec() } else { key.to_vec() };
    k.resize(64, 0);
    let inner: Vec<u8> = k.iter().map(|b| b ^ 0x36).chain(msg.iter().copied()).collect();
    let outer: Vec<u8> = k.iter().map(|b| b ^ 0x5c).chain(Sha256::digest(&inner)).collect();
    Sha256::digest(&outer).to_vec()
}

pub fn sigv4(r: &SigV4) -> String {
    let mut headers: Vec<(String, String)> = r.headers.iter().map(|(k, v)| (k.to_lowercase(), v.trim().to_owned())).collect();
    headers.sort();
    let canonical_headers: String = headers.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let signed: Vec<&str> = headers.iter().map(|(k, _)| k.as_str()).collect();
    let signed = signed.join(";");
    let canonical = format!("{}\n{}\n{}\n{canonical_headers}\n{signed}\n{}", r.method, r.path, r.query, hex::encode(Sha256::digest(r.payload)));
    let date = &r.amz_date[..8];
    let scope = format!("{date}/{}/{}/aws4_request", r.region, r.service);
    let to_sign = format!("AWS4-HMAC-SHA256\n{}\n{scope}\n{}", r.amz_date, hex::encode(Sha256::digest(canonical.as_bytes())));
    let k = hmac(format!("AWS4{}", r.secret).as_bytes(), date.as_bytes());
    let k = hmac(&k, r.region.as_bytes());
    let k = hmac(&k, r.service.as_bytes());
    let k = hmac(&k, b"aws4_request");
    let signature = hex::encode(hmac(&k, to_sign.as_bytes()));
    format!("AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed}, Signature={signature}", r.access_key)
}

pub const CAN_CREATE: &[&str] = &["hetzner", "digitalocean"];

#[derive(Serialize, ToSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, ToSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Size {
    pub id: String,
    pub name: String,
    pub cpus: u32,
    pub memory_gb: f64,
    pub disk_gb: u32,
    /// Price in `currency`, as the provider bills it, including any tax it adds.
    pub monthly: f64,
    pub hourly: f64,
    /// `USD` or `EUR`.
    pub currency: &'static str,
    /// Regions that offer this size.
    pub regions: Vec<String>,
    /// Prices that differ by region, when the provider has them. `monthly` and `hourly` are the lowest.
    pub region_prices: Vec<RegionPrice>,
}

#[derive(Serialize, ToSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegionPrice {
    pub region: String,
    pub monthly: f64,
    pub hourly: f64,
}

#[derive(Serialize, ToSchema, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub regions: Vec<Region>,
    pub sizes: Vec<Size>,
}

pub struct NewMachine<'a> {
    pub name: &'a str,
    pub region: &'a str,
    pub size: &'a str,
    pub public_key: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MachineState {
    Starting,
    Running { ip: String },
    Gone,
}

pub fn cloud_init(public_key: &str) -> String {
    format!(
        "#cloud-config\nusers:\n  - name: deploy\n    shell: /bin/bash\n    ssh_authorized_keys:\n      - {}\nruncmd:\n  - curl -fsSL https://get.docker.com | sh\n  - usermod -aG docker deploy\n  - ufw allow 22/tcp\n  - ufw allow 80/tcp\n  - ufw allow 443/tcp\n  - ufw allow 443/udp\n  - ufw --force enable\n",
        public_key.trim()
    )
}

pub fn machine_name(name: &str) -> String {
    let s: String = name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let s = s.trim_matches('-').to_owned();
    if s.is_empty() { "tessery".into() } else { s.chars().take(60).collect() }
}

fn json(body: &str) -> Value {
    serde_json::from_str(body).unwrap_or_default()
}

fn f64_of(v: &Value) -> f64 {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or_default()
}

fn token(f: &Map<String, Value>) -> String {
    f.get("token").and_then(Value::as_str).unwrap_or_default().to_owned()
}

pub fn digitalocean_catalog(regions: &Value, sizes: &Value) -> Catalog {
    let regions: Vec<Region> = regions["regions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["available"].as_bool().unwrap_or(true))
        .map(|r| Region { id: r["slug"].as_str().unwrap_or_default().to_owned(), name: r["name"].as_str().unwrap_or_default().to_owned() })
        .collect();
    let mut sizes: Vec<Size> = sizes["sizes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|s| s["available"].as_bool().unwrap_or(true) && s["memory"].as_u64().unwrap_or(0) >= 1024)
        .map(|s| Size {
            id: s["slug"].as_str().unwrap_or_default().to_owned(),
            name: s["description"].as_str().filter(|d| !d.is_empty()).unwrap_or_else(|| s["slug"].as_str().unwrap_or_default()).to_owned(),
            cpus: s["vcpus"].as_u64().unwrap_or(0) as u32,
            memory_gb: s["memory"].as_f64().unwrap_or(0.0) / 1024.0,
            disk_gb: s["disk"].as_u64().unwrap_or(0) as u32,
            monthly: f64_of(&s["price_monthly"]),
            hourly: f64_of(&s["price_hourly"]),
            currency: "USD",
            region_prices: Vec::new(),
            regions: s["regions"].as_array().into_iter().flatten().filter_map(|r| r.as_str().map(str::to_owned)).collect(),
        })
        .collect();
    sizes.sort_by(|a, b| a.monthly.total_cmp(&b.monthly));
    Catalog { regions, sizes }
}

pub fn hetzner_catalog(locations: &Value, types: &Value) -> Catalog {
    let regions: Vec<Region> = locations["locations"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|l| Region { id: l["name"].as_str().unwrap_or_default().to_owned(), name: l["city"].as_str().unwrap_or_default().to_owned() })
        .collect();
    let mut sizes: Vec<Size> = types["server_types"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|t| t["deprecation"].is_null() && !t["deprecated"].as_bool().unwrap_or(false))
        .filter_map(|t| {
            let prices = t["prices"].as_array()?;
            let monthly = prices.iter().map(|p| f64_of(&p["price_monthly"]["gross"])).fold(f64::INFINITY, f64::min);
            let hourly = prices.iter().map(|p| f64_of(&p["price_hourly"]["gross"])).fold(f64::INFINITY, f64::min);
            Some(Size {
                id: t["name"].as_str()?.to_owned(),
                name: format!("{} ({})", t["name"].as_str()?.to_uppercase(), t["architecture"].as_str().unwrap_or("x86")),
                cpus: t["cores"].as_u64().unwrap_or(0) as u32,
                memory_gb: f64_of(&t["memory"]),
                disk_gb: t["disk"].as_u64().unwrap_or(0) as u32,
                monthly: if monthly.is_finite() { monthly } else { 0.0 },
                hourly: if hourly.is_finite() { hourly } else { 0.0 },
                currency: "EUR",
                regions: prices.iter().filter_map(|p| p["location"].as_str().map(str::to_owned)).collect(),
                region_prices: prices
                    .iter()
                    .filter_map(|p| Some(RegionPrice { region: p["location"].as_str()?.to_owned(), monthly: f64_of(&p["price_monthly"]["gross"]), hourly: f64_of(&p["price_hourly"]["gross"]) }))
                    .collect(),
            })
        })
        .collect();
    sizes.sort_by(|a, b| a.monthly.total_cmp(&b.monthly));
    Catalog { regions, sizes }
}

pub async fn catalog(provider: &str, f: &Map<String, Value>, apis: &Endpoints) -> Result<Catalog, String> {
    let http = client();
    match provider {
        "digitalocean" => {
            let base = endpoint(apis, "digitalocean", "https://api.digitalocean.com/v2");
            let regions = send("DigitalOcean", http.get(format!("{base}/regions?per_page=200")).bearer_auth(token(f))).await?;
            let sizes = send("DigitalOcean", http.get(format!("{base}/sizes?per_page=200")).bearer_auth(token(f))).await?;
            Ok(digitalocean_catalog(&json(&regions), &json(&sizes)))
        }
        "hetzner" => {
            let base = endpoint(apis, "hetzner", "https://api.hetzner.cloud/v1");
            let locations = send("Hetzner", http.get(format!("{base}/locations")).bearer_auth(token(f))).await?;
            let types = send("Hetzner", http.get(format!("{base}/server_types?per_page=50")).bearer_auth(token(f))).await?;
            Ok(hetzner_catalog(&json(&locations), &json(&types)))
        }
        other => Err(format!("Tessery cannot create servers on {other} yet")),
    }
}

pub async fn create_machine(provider: &str, f: &Map<String, Value>, apis: &Endpoints, m: &NewMachine<'_>) -> Result<String, String> {
    let http = client();
    let user_data = cloud_init(m.public_key);
    let name = machine_name(m.name);
    match provider {
        "digitalocean" => {
            let base = endpoint(apis, "digitalocean", "https://api.digitalocean.com/v2");
            let body = json!({ "name": name, "region": m.region, "size": m.size, "image": "ubuntu-24-04-x64", "user_data": user_data, "tags": ["tessery"] });
            let r = send("DigitalOcean", http.post(format!("{base}/droplets")).bearer_auth(token(f)).json(&body)).await?;
            json(&r).pointer("/droplet/id").map(|id| id.to_string()).ok_or_else(|| "DigitalOcean did not return the new Droplet".into())
        }
        "hetzner" => {
            let base = endpoint(apis, "hetzner", "https://api.hetzner.cloud/v1");
            let body = json!({ "name": name, "location": m.region, "server_type": m.size, "image": "ubuntu-24.04", "user_data": user_data, "labels": { "tessery": "true" } });
            let r = send("Hetzner", http.post(format!("{base}/servers")).bearer_auth(token(f)).json(&body)).await?;
            json(&r).pointer("/server/id").map(|id| id.to_string()).ok_or_else(|| "Hetzner did not return the new server".into())
        }
        other => Err(format!("Tessery cannot create servers on {other} yet")),
    }
}

pub async fn machine_state(provider: &str, f: &Map<String, Value>, apis: &Endpoints, id: &str) -> Result<MachineState, String> {
    let http = client();
    let (name, url) = match provider {
        "digitalocean" => ("DigitalOcean", format!("{}/droplets/{id}", endpoint(apis, "digitalocean", "https://api.digitalocean.com/v2"))),
        "hetzner" => ("Hetzner", format!("{}/servers/{id}", endpoint(apis, "hetzner", "https://api.hetzner.cloud/v1"))),
        other => return Err(format!("Tessery cannot manage servers on {other} yet")),
    };
    let r = http.get(url).bearer_auth(token(f)).send().await.map_err(|e| format!("could not reach {name}: {e}"))?;
    if r.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(MachineState::Gone);
    }
    let status = r.status();
    let body = r.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(status_error(name, status, &body));
    }
    let v = json(&body);
    let (running, ip) = match provider {
        "digitalocean" => (
            v.pointer("/droplet/status").and_then(Value::as_str) == Some("active"),
            v.pointer("/droplet/networks/v4").and_then(Value::as_array).and_then(|n| n.iter().find(|x| x["type"] == "public")).and_then(|x| x["ip_address"].as_str()).map(str::to_owned),
        ),
        _ => (
            v.pointer("/server/status").and_then(Value::as_str) == Some("running"),
            v.pointer("/server/public_net/ipv4/ip").and_then(Value::as_str).map(str::to_owned),
        ),
    };
    Ok(match (running, ip) {
        (true, Some(ip)) => MachineState::Running { ip },
        _ => MachineState::Starting,
    })
}

pub async fn delete_machine(provider: &str, f: &Map<String, Value>, apis: &Endpoints, id: &str) -> Result<(), String> {
    let http = client();
    let (name, url) = match provider {
        "digitalocean" => ("DigitalOcean", format!("{}/droplets/{id}", endpoint(apis, "digitalocean", "https://api.digitalocean.com/v2"))),
        "hetzner" => ("Hetzner", format!("{}/servers/{id}", endpoint(apis, "hetzner", "https://api.hetzner.cloud/v1"))),
        other => return Err(format!("Tessery cannot manage servers on {other} yet")),
    };
    let r = http.delete(url).bearer_auth(token(f)).send().await.map_err(|e| format!("could not reach {name}: {e}"))?;
    let status = r.status();
    if status.is_success() || status == reqwest::StatusCode::NOT_FOUND {
        return Ok(());
    }
    Err(status_error(name, status, &r.text().await.unwrap_or_default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_like_the_aws_test_suite() {
        let auth = sigv4(&SigV4 {
            method: "GET",
            path: "/",
            query: "",
            headers: &[("Host", "example.amazonaws.com"), ("X-Amz-Date", "20150830T123600Z")],
            payload: b"",
            region: "us-east-1",
            service: "service",
            access_key: "AKIDEXAMPLE",
            secret: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            amz_date: "20150830T123600Z",
        });
        assert_eq!(auth, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
    }

    #[test]
    fn hmac_matches_rfc_4231() {
        assert_eq!(hex::encode(hmac(&[0x0b; 20], b"Hi There")), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
    }

    #[test]
    fn requires_fields_and_hides_secrets_in_summaries() {
        let aws = provider("aws").unwrap();
        let input: Map<String, Value> = serde_json::from_value(json!({ "accessKeyId": "AKIAIOSFODNN7EXAMPLE", "secretAccessKey": "" })).unwrap();
        assert_eq!(clean(aws, &input).unwrap_err(), "Secret access key is required");
        let input: Map<String, Value> = serde_json::from_value(json!({ "accessKeyId": "AKIAIOSFODNN7EXAMPLE", "secretAccessKey": "s3cr3t-value-here" })).unwrap();
        let f = clean(aws, &input).unwrap();
        let shown = summary("aws", &f).to_string();
        assert!(shown.contains("AKIA…MPLE") && !shown.contains("s3cr3t"));
    }

    #[test]
    fn reads_provider_catalogs_cheapest_first() {
        let regions = json!({ "regions": [{ "slug": "fra1", "name": "Frankfurt 1", "available": true }, { "slug": "old1", "name": "Old", "available": false }] });
        let sizes = json!({ "sizes": [
            { "slug": "s-2vcpu-4gb", "description": "Basic", "memory": 4096, "vcpus": 2, "disk": 80, "price_monthly": 24.0, "price_hourly": 0.0357, "regions": ["fra1"], "available": true },
            { "slug": "s-1vcpu-1gb", "description": "Basic", "memory": 1024, "vcpus": 1, "disk": 25, "price_monthly": 6.0, "price_hourly": 0.00893, "regions": ["fra1"], "available": true },
            { "slug": "s-1vcpu-512mb", "memory": 512, "vcpus": 1, "disk": 10, "price_monthly": 4.0, "price_hourly": 0.006, "regions": ["fra1"], "available": true }
        ] });
        let c = digitalocean_catalog(&regions, &sizes);
        assert_eq!(c.regions.len(), 1);
        assert_eq!(c.sizes.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["s-1vcpu-1gb", "s-2vcpu-4gb"], "too small for Docker builds is left out");
        let types = json!({ "server_types": [
            { "name": "cx23", "cores": 2, "memory": 4.0, "disk": 40, "architecture": "x86", "deprecation": null, "prices": [{ "location": "fsn1", "price_monthly": { "gross": "4.1400" }, "price_hourly": { "gross": "0.0066" } }] },
            { "name": "cx22", "cores": 2, "memory": 4.0, "disk": 40, "architecture": "x86", "deprecation": { "announced": "2025" }, "prices": [] }
        ] });
        let h = hetzner_catalog(&json!({ "locations": [{ "name": "fsn1", "city": "Falkenstein" }] }), &types);
        assert_eq!(h.sizes.len(), 1);
        assert!((h.sizes[0].monthly - 4.14).abs() < 1e-9);
        assert_eq!(h.sizes[0].regions, ["fsn1"]);
        assert_eq!(h.sizes[0].currency, "EUR");
        assert_eq!(h.sizes[0].region_prices[0].region, "fsn1");
    }

    #[test]
    fn cloud_init_sets_up_docker_for_the_deploy_user() {
        let c = cloud_init("ssh-ed25519 AAAA tessery vps
");
        assert!(c.starts_with("#cloud-config
"));
        assert!(c.contains("      - ssh-ed25519 AAAA tessery vps
"));
        assert!(c.contains("usermod -aG docker deploy"));
        assert_eq!(machine_name("My VPS #1"), "my-vps--1");
    }
}
