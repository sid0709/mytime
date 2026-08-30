use tauri::State;

use crate::{
    api_server,
    app_state::AppState,
    app_usage_monitor, input_aggregator,
    models::{
        ActivityAppUsageDto, ActivityOverviewDto, ActivitySessionPageDto, ActivityTimelineDto,
        ApiServerSettingsDto, AppInputMinuteDto, DashboardSummaryDto, InputMonitorStatusDto,
        LiveFeedEventDto, LogEntryDto, SetApiServerSettingsDto,
    },
    quality_live::{self, QualityLiveDto},
    services,
};

async fn blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("background operation failed: {error}"))?
}

#[tauri::command]
pub async fn get_recent_logs(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<LogEntryDto>, String> {
    let log_dir = state.paths().log_dir.clone();
    blocking(move || {
        Ok(services::read_recent_logs(
            &log_dir,
            limit.unwrap_or(300) as usize,
        ))
    })
    .await
}

#[tauri::command]
pub fn get_dashboard_summary() -> Result<DashboardSummaryDto, String> {
    let stats = input_aggregator::get_stats();
    Ok(services::build_dashboard_summary(stats))
}

#[tauri::command]
pub fn get_input_stats() -> Result<crate::models::InputStatsDto, String> {
    Ok(
        input_aggregator::get_stats().unwrap_or_else(|| crate::models::InputStatsDto {
            key_presses_today: 0,
            mouse_events_today: 0,
            scroll_events_today: 0,
            first_activity_ts_ms: None,
            last_activity_ts_ms: None,
        }),
    )
}

#[tauri::command]
pub fn get_recent_input_events(limit: Option<u32>) -> Result<Vec<LiveFeedEventDto>, String> {
    Ok(input_aggregator::get_recent_events(limit))
}

#[tauri::command]
pub fn get_input_monitor_status() -> InputMonitorStatusDto {
    crate::input_monitor::get_monitor_status()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn get_input_monitor_diagnostics(
    state: State<'_, AppState>,
) -> crate::input_monitor::InputMonitorDiagnosticsDto {
    let log_dir = state.paths().log_dir.to_string_lossy();
    crate::input_monitor::get_monitor_diagnostics(log_dir.as_ref())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn get_input_monitor_diagnostics() -> serde_json::Value {
    serde_json::json!({ "message": "macOS only" })
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn request_input_monitor_permission(app: tauri::AppHandle) -> bool {
    let (tx, rx) = std::sync::mpsc::channel();
    if app
        .run_on_main_thread(move || {
            let result = crate::input_monitor::request_input_monitor_permission();
            let _ = tx.send(result);
        })
        .is_err()
    {
        return crate::input_monitor::request_input_monitor_permission();
    }
    rx.recv().unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn request_input_monitor_permission() -> bool {
    crate::input_monitor::request_input_monitor_permission()
}

#[tauri::command]
pub fn open_input_monitor_settings() {
    crate::input_monitor::open_input_monitor_settings();
}

#[tauri::command]
pub async fn get_activity_heatmap() -> Result<crate::models::ActivityHeatmapDto, String> {
    blocking(|| Ok(services::build_activity_heatmap())).await
}

#[tauri::command]
pub async fn get_activity_app_usage(limit: Option<u32>) -> Result<ActivityAppUsageDto, String> {
    blocking(move || services::build_activity_app_usage_for_date(None, limit, true)).await
}

#[tauri::command]
pub async fn get_activity_overview(
    include_icons: Option<bool>,
) -> Result<ActivityOverviewDto, String> {
    blocking(move || {
        Ok(services::build_activity_overview(
            include_icons.unwrap_or(true),
        ))
    })
    .await
}

#[tauri::command]
pub async fn get_activity_session_page(
    offset: Option<u32>,
    limit: Option<u32>,
    filter_text: Option<String>,
    app_id: Option<String>,
    sort_field: Option<String>,
    sort_dir: Option<String>,
) -> Result<ActivitySessionPageDto, String> {
    blocking(move || {
        Ok(services::build_activity_session_page(
            offset,
            limit,
            filter_text,
            app_id,
            sort_field,
            sort_dir,
        ))
    })
    .await
}

#[tauri::command]
pub fn get_activity_input_minutes() -> Result<Vec<AppInputMinuteDto>, String> {
    Ok(app_usage_monitor::get_input_minutes())
}

#[tauri::command]
pub async fn get_activity_timeline(
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<ActivityTimelineDto, String> {
    blocking(move || services::build_activity_timeline(start_date, end_date)).await
}

/// Persisted App Usage Breakdown (sunburst) category + assignment JSON for `CategoryManagerModal`.
#[tauri::command]
pub fn get_sunburst_settings() -> Result<String, String> {
    Ok(crate::db::get_config("sunburst_settings").unwrap_or_default())
}

#[tauri::command]
pub fn save_sunburst_settings(json: String) -> Result<(), String> {
    crate::db::set_config_result("sunburst_settings", &json)
        .map_err(|error| format!("failed to save sunburst settings: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_api_server_settings() -> ApiServerSettingsDto {
    api_server::get_settings()
}

#[tauri::command]
pub fn set_api_server_settings(
    app: tauri::AppHandle,
    settings: SetApiServerSettingsDto,
) -> Result<ApiServerSettingsDto, String> {
    api_server::set_settings(app, settings)
}

#[tauri::command]
pub fn get_quality_live() -> QualityLiveDto {
    quality_live::snapshot()
}

#[tauri::command]
pub fn get_quality_day() -> Vec<u8> {
    quality_live::day_samples()
}

#[tauri::command]
pub fn refresh_quality_live() -> QualityLiveDto {
    quality_live::refresh()
}

/// Strip Gatekeeper quarantine after an in-app update replaces the macOS bundle.
#[tauri::command]
pub fn clear_app_quarantine() -> Result<(), String> {
    crate::macos_quarantine::clear_current_app_quarantine()
}
