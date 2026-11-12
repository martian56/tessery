use tessery_db::telemetry::Span;
use prost::Message;
use serde_json::{Map, Value};
use time::OffsetDateTime;

#[derive(Clone, PartialEq, Message)]
pub struct ExportTraceServiceRequest {
    #[prost(message, repeated, tag = "1")]
    pub resource_spans: Vec<ResourceSpans>,
}

#[derive(Clone, PartialEq, Message)]
pub struct ResourceSpans {
    #[prost(message, optional, tag = "1")]
    pub resource: Option<Resource>,
    #[prost(message, repeated, tag = "2")]
    pub scope_spans: Vec<ScopeSpans>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Resource {
    #[prost(message, repeated, tag = "1")]
    pub attributes: Vec<KeyValue>,
}

#[derive(Clone, PartialEq, Message)]
pub struct ScopeSpans {
    #[prost(message, repeated, tag = "2")]
    pub spans: Vec<OtlpSpan>,
}

#[derive(Clone, PartialEq, Message)]
pub struct OtlpSpan {
    #[prost(bytes = "vec", tag = "1")]
    pub trace_id: Vec<u8>,
    #[prost(bytes = "vec", tag = "2")]
    pub span_id: Vec<u8>,
    #[prost(bytes = "vec", tag = "4")]
    pub parent_span_id: Vec<u8>,
    #[prost(string, tag = "5")]
    pub name: String,
    #[prost(int32, tag = "6")]
    pub kind: i32,
    #[prost(fixed64, tag = "7")]
    pub start_time_unix_nano: u64,
    #[prost(fixed64, tag = "8")]
    pub end_time_unix_nano: u64,
    #[prost(message, repeated, tag = "9")]
    pub attributes: Vec<KeyValue>,
    #[prost(message, optional, tag = "15")]
    pub status: Option<Status>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Status {
    #[prost(string, tag = "2")]
    pub message: String,
    #[prost(int32, tag = "3")]
    pub code: i32,
}

#[derive(Clone, PartialEq, Message)]
pub struct KeyValue {
    #[prost(string, tag = "1")]
    pub key: String,
    #[prost(message, optional, tag = "2")]
    pub value: Option<AnyValue>,
}

#[derive(Clone, PartialEq, Message)]
pub struct AnyValue {
    #[prost(oneof = "any_value::Value", tags = "1, 2, 3, 4")]
    pub value: Option<any_value::Value>,
}

pub mod any_value {
    #[derive(Clone, PartialEq, prost::Oneof)]
    pub enum Value {
        #[prost(string, tag = "1")]
        String(String),
        #[prost(bool, tag = "2")]
        Bool(bool),
        #[prost(int64, tag = "3")]
        Int(i64),
        #[prost(double, tag = "4")]
        Double(f64),
    }
}

const STATUS_ERROR: i32 = 2;
const MAX_SPANS: usize = 5000;
const MAX_ATTRIBUTES: usize = 40;
const MAX_VALUE: usize = 512;

fn json(v: &Option<AnyValue>) -> Value {
    match v.as_ref().and_then(|v| v.value.as_ref()) {
        Some(any_value::Value::String(s)) => Value::String(s.chars().take(MAX_VALUE).collect()),
        Some(any_value::Value::Bool(b)) => Value::Bool(*b),
        Some(any_value::Value::Int(i)) => Value::from(*i),
        Some(any_value::Value::Double(d)) => Value::from(*d),
        None => Value::Null,
    }
}

pub fn decode(body: &[u8]) -> Result<Vec<Span>, prost::DecodeError> {
    let req = ExportTraceServiceRequest::decode(body)?;
    let mut out = Vec::new();
    for rs in req.resource_spans {
        let resource = rs.resource.unwrap_or_default().attributes;
        let service = resource.iter().find(|kv| kv.key == "service.name").and_then(|kv| match json(&kv.value) {
            Value::String(s) => Some(s),
            _ => None,
        });
        let service = service.unwrap_or_else(|| "unknown".into());
        for span in rs.scope_spans.into_iter().flat_map(|s| s.spans) {
            if out.len() >= MAX_SPANS || span.trace_id.len() != 16 || span.span_id.len() != 8 {
                continue;
            }
            let mut attributes = Map::new();
            for kv in span.attributes.iter().take(MAX_ATTRIBUTES) {
                attributes.insert(kv.key.clone(), json(&kv.value));
            }
            let status = span.status.unwrap_or_default();
            if !status.message.is_empty() {
                attributes.insert("status.message".into(), Value::String(status.message.chars().take(MAX_VALUE).collect()));
            }
            let start = OffsetDateTime::from_unix_timestamp_nanos(i128::from(span.start_time_unix_nano)).unwrap_or(OffsetDateTime::UNIX_EPOCH);
            let mut name: String = span.name.chars().take(200).collect();
            if ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].contains(&name.as_str()) {
                let path = ["http.route", "url.path", "http.target"].iter().find_map(|k| attributes.get(*k).and_then(Value::as_str));
                if let Some(p) = path {
                    name = format!("{name} {}", p.split('?').next().unwrap_or(p));
                }
            }
            let http_error =attributes.get("http.response.status_code").or_else(|| attributes.get("http.status_code")).and_then(Value::as_i64).is_some_and(|c| c >= 500);
            out.push(Span {
                trace_id: hex::encode(&span.trace_id),
                span_id: hex::encode(&span.span_id),
                parent_id: (span.parent_span_id.len() == 8).then(|| hex::encode(&span.parent_span_id)),
                service: service.clone(),
                name,
                kind: span.kind.clamp(0, 5) as i16,
                start_at: start,
                duration_us: (span.end_time_unix_nano.saturating_sub(span.start_time_unix_nano) / 1000) as i64,
                error: status.code == STATUS_ERROR || http_error,
                attributes: Value::Object(attributes),
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_what_an_sdk_sends() {
        let kv = |k: &str, v: any_value::Value| KeyValue { key: k.into(), value: Some(AnyValue { value: Some(v) }) };
        let req = ExportTraceServiceRequest {
            resource_spans: vec![ResourceSpans {
                resource: Some(Resource { attributes: vec![kv("service.name", any_value::Value::String("orders".into()))] }),
                scope_spans: vec![ScopeSpans {
                    spans: vec![
                        OtlpSpan { trace_id: vec![1; 16], span_id: vec![2; 8], name: "GET".into(), kind: 2, start_time_unix_nano: 1_700_000_000_000_000_000, end_time_unix_nano: 1_700_000_000_012_000_000, attributes: vec![kv("http.response.status_code", any_value::Value::Int(503)), kv("url.path", any_value::Value::String("/orders?page=2".into()))], ..Default::default() },
                        OtlpSpan { trace_id: vec![1; 16], span_id: vec![3; 8], parent_span_id: vec![2; 8], name: "SELECT".into(), start_time_unix_nano: 1, end_time_unix_nano: 2, ..Default::default() },
                        OtlpSpan { trace_id: vec![1; 3], span_id: vec![4; 8], ..Default::default() },
                    ],
                }],
            }],
        };
        let spans = decode(&req.encode_to_vec()).unwrap();
        assert_eq!(spans.len(), 2, "spans with malformed ids are skipped");
        assert_eq!(spans[0].service, "orders");
        assert_eq!(spans[0].name, "GET /orders", "bare method names get the path, without the query");
        assert_eq!(spans[0].trace_id, "01".repeat(16));
        assert_eq!(spans[0].duration_us, 12_000);
        assert!(spans[0].error, "a 5xx response marks the span as an error");
        assert_eq!(spans[0].parent_id, None);
        assert_eq!(spans[1].parent_id.as_deref(), Some("0202020202020202"));
    }
}
