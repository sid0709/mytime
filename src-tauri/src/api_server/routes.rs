use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use tauri::Manager;
use tauri::Runtime;
use tower::limit::ConcurrencyLimitLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;

use crate::{
    app_state::AppState,
    models::{ApiErrorDto, SetApiServerSettingsDto},
};

use super::{
    config::ApiServerConfig,
    handlers,
    query::{
        include_icons_default_false, DateLimitQuery, DateQuery, LimitQuery, SessionPageQuery,
        TimelineQuery,
    },
};

#[derive(Clone)]
pub struct ApiState<R: Runtime> {
    pub app: tauri::AppHandle<R>,
    pub config: ApiServerConfig,
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ApiErrorDto {
                error: self.message,
            }),
        )
            .into_response()
    }
}

async fn blocking<T, F>(operation: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|error| ApiError::internal(format!("background operation failed: {error}")))?
        .map_err(ApiError::bad_request)
}

pub fn build_router<R: Runtime>(state: ApiState<R>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api/v1/health", get(health).post(health))
        .route("/api/v1/metadata", get(metadata::<R>).post(metadata::<R>))
        .route("/api/v1/dashboard", get(dashboard).post(dashboard))
        .route("/api/v1/input/stats", get(input_stats).post(input_stats))
        .route(
            "/api/v1/input/events",
            get(input_events).post(input_events_post),
        )
        .route(
            "/api/v1/activity/overview",
            get(activity_overview).post(activity_overview_post),
        )
        .route(
            "/api/v1/activity/app-usage",
            get(activity_app_usage).post(activity_app_usage_post),
        )
        .route(
            "/api/v1/activity/sessions",
            get(activity_sessions).post(activity_sessions_post),
        )
        .route(
            "/api/v1/activity/input-minutes",
            get(activity_input_minutes).post(activity_input_minutes_post),
        )
        .route(
            "/api/v1/activity/timeline",
            get(activity_timeline).post(activity_timeline_post),
        )
        .route(
            "/api/v1/activity/heatmap",
            get(activity_heatmap).post(activity_heatmap),
        )
        .with_state(Arc::new(state))
        .layer(RequestBodyLimitLayer::new(64 * 1024))
        .layer(ConcurrencyLimitLayer::new(8))
        .layer(cors)
}

fn with_app_state<R: Runtime, F, T>(handle: &tauri::AppHandle<R>, f: F) -> Result<T, ApiError>
where
    F: FnOnce(&AppState) -> T,
{
    let state = handle
        .try_state::<AppState>()
        .ok_or_else(|| ApiError::internal("application state unavailable"))?;
    Ok(f(state.inner()))
}

async fn health() -> Json<crate::models::HealthResponseDto> {
    Json(handlers::build_health())
}

async fn metadata<R: Runtime>(
    State(state): State<Arc<ApiState<R>>>,
) -> Result<Json<crate::models::MetadataResponseDto>, ApiError> {
    let payload = with_app_state(&state.app, |app_state| {
        handlers::build_metadata(app_state, &state.config)
    })?;
    Ok(Json(payload))
}

async fn dashboard() -> Json<crate::models::DashboardSummaryDto> {
    Json(handlers::build_dashboard())
}

async fn input_stats() -> Json<crate::models::InputStatsDto> {
    Json(handlers::build_input_stats())
}

async fn input_events(
    Query(query): Query<LimitQuery>,
) -> Json<Vec<crate::models::LiveFeedEventDto>> {
    Json(handlers::build_input_events(query.limit))
}

async fn input_events_post(
    Json(query): Json<LimitQuery>,
) -> Json<Vec<crate::models::LiveFeedEventDto>> {
    Json(handlers::build_input_events(query.limit))
}

async fn activity_overview(
    Query(query): Query<DateQuery>,
) -> Result<Json<crate::models::ActivityOverviewDto>, ApiError> {
    let overview = blocking(move || handlers::build_activity_overview(query.date, false)).await?;
    Ok(Json(overview))
}

async fn activity_overview_post(
    Json(query): Json<DateLimitQuery>,
) -> Result<Json<crate::models::ActivityOverviewDto>, ApiError> {
    let include_icons = include_icons_default_false(query.include_icons);
    let overview =
        blocking(move || handlers::build_activity_overview(query.date, include_icons)).await?;
    Ok(Json(overview))
}

async fn activity_app_usage(
    Query(query): Query<DateLimitQuery>,
) -> Result<Json<crate::models::ActivityAppUsageDto>, ApiError> {
    let include_icons = include_icons_default_false(query.include_icons);
    let usage = blocking(move || {
        handlers::build_activity_app_usage(query.date, query.limit, include_icons)
    })
    .await?;
    Ok(Json(usage))
}

async fn activity_app_usage_post(
    Json(query): Json<DateLimitQuery>,
) -> Result<Json<crate::models::ActivityAppUsageDto>, ApiError> {
    activity_app_usage(Query(query)).await
}

async fn activity_sessions(
    Query(query): Query<SessionPageQuery>,
) -> Result<Json<crate::models::ActivitySessionPageDto>, ApiError> {
    let include_icons = query.include_icons;
    let mut page = blocking(move || {
        handlers::build_activity_sessions(
            query.date,
            query.offset,
            query.limit,
            query.filter_text,
            query.app_id,
            query.sort_field,
            query.sort_dir,
        )
    })
    .await?;
    if !include_icons_default_false(include_icons) {
        handlers::strip_session_icons(&mut page);
    }
    Ok(Json(page))
}

async fn activity_sessions_post(
    Json(query): Json<SessionPageQuery>,
) -> Result<Json<crate::models::ActivitySessionPageDto>, ApiError> {
    activity_sessions(Query(query)).await
}

async fn activity_input_minutes(
    Query(query): Query<DateQuery>,
) -> Result<Json<Vec<crate::models::AppInputMinuteDto>>, ApiError> {
    let minutes = blocking(move || handlers::build_activity_input_minutes(query.date)).await?;
    Ok(Json(minutes))
}

async fn activity_input_minutes_post(
    Json(query): Json<DateQuery>,
) -> Result<Json<Vec<crate::models::AppInputMinuteDto>>, ApiError> {
    activity_input_minutes(Query(query)).await
}

async fn activity_timeline(
    Query(query): Query<TimelineQuery>,
) -> Result<Json<crate::models::ActivityTimelineDto>, ApiError> {
    let timeline =
        blocking(move || handlers::build_activity_timeline(query.start_date, query.end_date))
            .await?;
    Ok(Json(timeline))
}

async fn activity_timeline_post(
    Json(query): Json<TimelineQuery>,
) -> Result<Json<crate::models::ActivityTimelineDto>, ApiError> {
    activity_timeline(Query(query)).await
}

async fn activity_heatmap() -> Result<Json<crate::models::ActivityHeatmapDto>, ApiError> {
    let heatmap = blocking(|| Ok(handlers::build_activity_heatmap())).await?;
    Ok(Json(heatmap))
}

#[allow(dead_code)]
pub fn apply_settings_patch(
    current: &ApiServerConfig,
    patch: &SetApiServerSettingsDto,
) -> ApiServerConfig {
    ApiServerConfig {
        enabled: patch.enabled.unwrap_or(current.enabled),
        port: patch.port.unwrap_or(current.port).clamp(1024, 65535),
        bind: patch.bind.clone().unwrap_or_else(|| current.bind.clone()),
        hostname: patch
            .hostname
            .clone()
            .unwrap_or_else(|| current.hostname.clone()),
    }
}
