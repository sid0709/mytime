use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MetricTrendDto {
    Up,
    Down,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricCardDto {
    pub title: String,
    pub value: String,
    pub change: Option<String>,
    pub trend: Option<MetricTrendDto>,
    pub subtitle: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMetricsDto {
    pub active_time_today: MetricCardDto,
    pub mouse_events: MetricCardDto,
    pub keystrokes: MetricCardDto,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummaryDto {
    pub generated_at: String,
    pub metrics: DashboardMetricsDto,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityTimelinePointDto {
    pub label: String,
    pub active: f32,
    pub inactive: f32,
    pub full_date: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityTimelineDto {
    pub generated_at: String,
    pub start_date: String,
    pub end_date: String,
    pub is_hourly: bool,
    pub y_label: String,
    pub max_value: f32,
    pub avg_active: f32,
    pub points: Vec<ActivityTimelinePointDto>,
}

/// Real-time input stats from the global hook aggregator (same source as dashboard + live feed).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputStatsDto {
    pub key_presses_today: u64,
    pub mouse_events_today: u64,
    pub scroll_events_today: u64,
    pub first_activity_ts_ms: Option<i64>,
    pub last_activity_ts_ms: Option<i64>,
}

/// macOS / Windows global hook health (permissions + whether events are flowing).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputMonitorStatusDto {
    pub listen_event_access: bool,
    pub tap_installed: bool,
    pub events_received: u64,
    pub executable_path: String,
    pub message: String,
    pub remote_session_active: bool,
    pub rejected_injected: u64,
    pub rejected_remote: u64,
}

/// Single event for the live activity feed (from the same global input stream).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveFeedEventDto {
    pub id: u64,
    pub event_type: String,
    pub description: String,
    pub timestamp: String,
    pub detail: Option<String>,
}

/// 8 chronological rows (today-6 … today, tomorrow) × N hour slots.
/// Intensity 0–100 = share of 1s samples ≥ persist min. Last row is always empty.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityHeatmapDto {
    /// Row 0 = six days ago, row 6 = today, row 7 = tomorrow. Column count = 86400 / slot_seconds.
    pub grid: Vec<Vec<u8>>,
    /// Seconds per heatmap column. `24` columns/day when this is `3600` (1 hour).
    pub slot_seconds: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUsageSessionDto {
    pub id: u64,
    pub app_id: String,
    pub app_name: String,
    pub icon_data_url: Option<String>,
    pub title: String,
    pub pid: u32,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    pub duration_ms: u64,
    pub key_presses: u32,
    pub mouse_clicks: u32,
    pub scroll_events: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUsageSummaryDto {
    pub app_id: String,
    pub app_name: String,
    pub icon_data_url: Option<String>,
    pub session_count: u32,
    pub total_duration_ms: u64,
    pub key_presses: u32,
    pub mouse_clicks: u32,
    pub scroll_events: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInputMinuteDto {
    pub minute_of_day: u32,
    pub key_presses: u32,
    pub mouse_clicks: u32,
    pub mouse_moves: u32,
    pub scroll_events: u32,
    pub diversity: Option<f32>,
    pub timing: Option<f32>,
    pub quality: Option<f32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityAppUsageDto {
    pub generated_at: String,
    pub sessions: Vec<AppUsageSessionDto>,
    pub apps: Vec<AppUsageSummaryDto>,
    pub input_minutes: Vec<AppInputMinuteDto>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityOverviewDto {
    pub generated_at: String,
    pub total_sessions: u32,
    pub apps: Vec<AppUsageSummaryDto>,
    pub input_minutes: Vec<AppInputMinuteDto>,
    pub timeline_sessions: Vec<AppUsageSessionDto>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySessionPageDto {
    pub generated_at: String,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
    pub has_more: bool,
    pub sessions: Vec<AppUsageSessionDto>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogEntryDto {
    /// Monotonic id (newest = highest) for stable React keys.
    pub id: u64,
    /// ISO-8601 timestamp as written by the tracing layer, when parseable.
    pub timestamp: Option<String>,
    /// Normalized level: TRACE | DEBUG | INFO | WARN | ERROR | UNKNOWN.
    pub level: String,
    /// Emitting module/target (e.g. `mytime_lib::db`).
    pub target: Option<String>,
    /// The log message (and any trailing fields).
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponseDto {
    pub ok: bool,
    pub version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataResponseDto {
    pub app_name: String,
    pub version: String,
    pub platform: String,
    pub hostname: String,
    pub started_at: String,
    pub backend_mode: String,
    pub collectors_running: bool,
    pub data_dir: String,
    pub log_dir: String,
    pub db_path: String,
    pub db_exists: bool,
    pub api_server_port: u16,
    pub api_base_url: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiServerSettingsDto {
    pub enabled: bool,
    pub port: u16,
    pub bind: String,
    pub hostname: String,
    pub running: bool,
    pub listen_addr: Option<String>,
    pub api_base_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetApiServerSettingsDto {
    pub enabled: Option<bool>,
    pub port: Option<u16>,
    pub bind: Option<String>,
    pub hostname: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorDto {
    pub error: String,
}
