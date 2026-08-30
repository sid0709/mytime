use axum::{body::Body, routing::get, Json, Router};
use http::{Request, StatusCode};
use mytime_lib::api_server::{
    config::ApiServerConfig,
    handlers,
    routes::{self, ApiState},
};
use tower::ServiceExt;

#[tokio::test]
async fn health_endpoint_returns_ok_json() {
    let router = Router::new().route(
        "/api/v1/health",
        get(|| async { Json(handlers::build_health()) }),
    );

    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn health_payload_has_expected_fields() {
    let health = handlers::build_health();
    assert!(health.ok);
    assert!(!health.version.is_empty());
}

#[tokio::test]
async fn removed_telemetry_routes_return_not_found() {
    let app = tauri::test::mock_app();
    let router = routes::build_router(ApiState {
        app: app.handle().clone(),
        config: ApiServerConfig {
            enabled: true,
            port: 18_765,
            bind: "0.0.0.0".to_string(),
            hostname: "test-machine".to_string(),
        },
    });

    for path in [
        "/api/v1/network/summary",
        "/api/v1/network/overview",
        "/api/v1/network/connections",
        "/api/v1/network/process-bandwidth",
        "/api/v1/network/speed-history",
        "/api/v1/network/usage-history",
        "/api/v1/network/daily-usage",
    ] {
        let response = router
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn remote_api_rejects_oversized_request_bodies() {
    let app = tauri::test::mock_app();
    let router = routes::build_router(ApiState {
        app: app.handle().clone(),
        config: ApiServerConfig {
            enabled: true,
            port: 18_765,
            bind: "0.0.0.0".to_string(),
            hostname: "test-machine".to_string(),
        },
    });
    let oversized = vec![b' '; 64 * 1024 + 1];

    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/activity/overview")
                .header("content-type", "application/json")
                .header("content-length", oversized.len())
                .body(Body::from(oversized))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}
