mod common;

#[tokio::test]
async fn every_response_carries_the_security_headers() {
    let app = common::spawn().await;
    let r = app.session().get("/api/health").await;
    let h = r.headers();
    let csp = h.get("content-security-policy").and_then(|v| v.to_str().ok()).unwrap_or_default();
    assert!(csp.contains("default-src 'self'") && csp.contains("frame-ancestors 'none'"), "{csp}");
    assert_eq!(h.get("x-content-type-options").unwrap(), "nosniff");
    assert_eq!(h.get("x-frame-options").unwrap(), "DENY");
    assert_eq!(h.get("referrer-policy").unwrap(), "strict-origin-when-cross-origin");
    assert!(h.get("permissions-policy").is_some());
    assert!(h.get("strict-transport-security").is_none(), "no HSTS while cookies are not marked secure");
}
