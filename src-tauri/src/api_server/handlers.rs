use crate::{
    app_state::AppState,
    input_aggregator,
    models::{
        ActivityAppUsageDto, ActivityHeatmapDto, ActivityOverviewDto, ActivitySessionPageDto,
        ActivityTimelineDto, AppInputMinuteDto, DashboardSummaryDto, HealthResponseDto,
        InputStatsDto, LiveFeedEventDto, MetadataResponseDto,
    },
    services,
};

use super::config::{self, ApiServerConfig};

pub fn build_metadata(state: &AppState, api_config: &ApiServerConfig) -> MetadataResponseDto {
    let paths = state.paths();
    let hostname = config::resolve_hostname(api_config);
    let api_base_url = config::build_api_base_url(api_config.port);

    MetadataResponseDto {
        app_name: "MyTime".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        hostname,
        started_at: state.started_at_rfc3339(),
        backend_mode: state.backend_mode().to_string(),
        collectors_running: state.collectors_running(),
        data_dir: paths.data_dir.display().to_string(),
        log_dir: paths.log_dir.display().to_string(),
        db_path: paths.db_path.display().to_string(),
        db_exists: paths.db_path.exists(),
        api_server_port: api_config.port,
        api_base_url,
    }
}

pub fn build_health() -> HealthResponseDto {
    HealthResponseDto {
        ok: true,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

pub fn build_dashboard() -> DashboardSummaryDto {
    let stats = input_aggregator::get_stats();
    services::build_dashboard_summary(stats)
}

pub fn build_input_stats() -> InputStatsDto {
    input_aggregator::get_stats().unwrap_or(InputStatsDto {
        key_presses_today: 0,
        mouse_events_today: 0,
        scroll_events_today: 0,
        first_activity_ts_ms: None,
        last_activity_ts_ms: None,
    })
}

pub fn build_input_events(limit: Option<u32>) -> Vec<LiveFeedEventDto> {
    input_aggregator::get_recent_events(limit)
}

pub fn build_activity_overview(
    date: Option<String>,
    include_icons: bool,
) -> Result<ActivityOverviewDto, String> {
    services::build_activity_overview_for_date(date, include_icons)
}

pub fn build_activity_app_usage(
    date: Option<String>,
    limit: Option<u32>,
    include_icons: bool,
) -> Result<ActivityAppUsageDto, String> {
    services::build_activity_app_usage_for_date(date, limit, include_icons)
}

pub fn build_activity_sessions(
    date: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
    filter_text: Option<String>,
    app_id: Option<String>,
    sort_field: Option<String>,
    sort_dir: Option<String>,
) -> Result<ActivitySessionPageDto, String> {
    services::build_activity_session_page_for_date(
        date,
        offset,
        limit,
        filter_text,
        app_id,
        sort_field,
        sort_dir,
    )
}

pub fn build_activity_input_minutes(
    date: Option<String>,
) -> Result<Vec<AppInputMinuteDto>, String> {
    services::build_activity_input_minutes_for_date(date)
}

pub fn build_activity_timeline(
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<ActivityTimelineDto, String> {
    services::build_activity_timeline(start_date, end_date)
}

pub fn build_activity_heatmap() -> ActivityHeatmapDto {
    services::build_activity_heatmap()
}

pub fn strip_session_icons(page: &mut ActivitySessionPageDto) {
    for session in &mut page.sessions {
        session.icon_data_url = None;
    }
}

#[cfg(test)]
mod tests {
    use super::{build_dashboard, build_metadata};
    use crate::{app_state::AppState, config::AppPaths};

    use crate::api_server::config::ApiServerConfig;

    #[test]
    fn dashboard_contract_contains_only_activity_metrics() {
        let value = serde_json::to_value(build_dashboard()).expect("serialize dashboard");
        let metrics = value["metrics"]
            .as_object()
            .expect("dashboard metrics object");

        assert_eq!(metrics.len(), 3);
        assert!(metrics.contains_key("activeTimeToday"));
        assert!(metrics.contains_key("mouseEvents"));
        assert!(metrics.contains_key("keystrokes"));
    }

    #[test]
    fn metadata_contract_omits_connectivity_telemetry() {
        let temp = tempfile::tempdir().expect("create temporary directory");
        let paths = AppPaths {
            data_dir: temp.path().to_path_buf(),
            log_dir: temp.path().join("logs"),
            db_path: temp.path().join("mytime.sqlite3"),
        };
        let state = AppState::new(paths);
        let config = ApiServerConfig {
            enabled: true,
            port: 18_765,
            bind: "0.0.0.0".to_string(),
            hostname: "test-machine".to_string(),
        };

        let value =
            serde_json::to_value(build_metadata(&state, &config)).expect("serialize metadata");
        let metadata = value.as_object().expect("metadata object");

        assert!(!metadata.contains_key("ipAddress"));
        assert!(!metadata.contains_key("online"));
        assert!(!metadata.contains_key("latencyMs"));
        assert_eq!(metadata["apiServerPort"], 18_765);
        assert!(metadata["apiBaseUrl"].as_str().is_some());
    }
}
