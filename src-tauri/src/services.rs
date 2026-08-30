use chrono::{Datelike, Duration, Local, LocalResult, NaiveDate, TimeZone, Utc};

use crate::{
    activity_score, app_usage_monitor, db,
    models::{
        ActivityHeatmapDto, ActivityOverviewDto, ActivitySessionPageDto, ActivityTimelineDto,
        ActivityTimelinePointDto, AppInputMinuteDto, AppUsageSessionDto, DashboardMetricsDto,
        DashboardSummaryDto, InputStatsDto, LogEntryDto, MetricCardDto, MetricTrendDto,
    },
};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

fn format_count(value: usize) -> String {
    let digits = value.to_string();
    let reversed_chars: Vec<char> = digits.chars().rev().collect();
    let mut with_separators = String::with_capacity(digits.len() + digits.len() / 3);

    for (index, ch) in reversed_chars.iter().enumerate() {
        if index > 0 && index % 3 == 0 {
            with_separators.push(',');
        }
        with_separators.push(*ch);
    }

    with_separators.chars().rev().collect()
}

fn metric(
    title: &str,
    value: impl Into<String>,
    change: Option<&str>,
    trend: Option<MetricTrendDto>,
    subtitle: Option<&str>,
) -> MetricCardDto {
    MetricCardDto {
        title: title.to_string(),
        value: value.into(),
        change: change.map(str::to_string),
        trend,
        subtitle: subtitle.map(str::to_string),
    }
}

pub fn build_dashboard_summary(stats: Option<InputStatsDto>) -> DashboardSummaryDto {
    let today = Local::now().date_naive();
    let seed = today.ordinal() % 7;

    // Align with Activity timeline "active" minutes (per-minute input buckets), not first→last event span.
    let active_mins_from_buckets = {
        let minutes = app_usage_monitor::get_input_minutes();
        aggregate_today_input(&minutes).total_active_minutes as u64
    };

    let (active_time, mouse_events, keystrokes) = match stats {
        Some(s) => {
            let active_str = format!(
                "{}h {:02}m",
                active_mins_from_buckets / 60,
                active_mins_from_buckets % 60
            );
            (
                metric(
                    "Active Time Today",
                    active_str,
                    None,
                    None,
                    Some("minutes with keyboard/mouse activity"),
                ),
                metric(
                    "Mouse Events",
                    format_count(s.mouse_events_today as usize),
                    None,
                    None,
                    Some("clicks & movements"),
                ),
                metric(
                    "Keystrokes",
                    format_count(s.key_presses_today as usize),
                    None,
                    None,
                    Some("total today"),
                ),
            )
        }
        None => (
            metric(
                "Active Time Today",
                format!("{}h {:02}m", 6 + (seed / 3), 32 + seed * 3),
                Some("+12%"),
                Some(MetricTrendDto::Up),
                Some("vs yesterday"),
            ),
            metric(
                "Mouse Events",
                format_count(14_200 + seed as usize * 137),
                Some("+8%"),
                Some(MetricTrendDto::Up),
                Some("clicks & movements"),
            ),
            metric(
                "Keystrokes",
                format_count(22_900 + seed as usize * 211),
                Some("-3%"),
                Some(MetricTrendDto::Down),
                Some("total today"),
            ),
        ),
    };

    DashboardSummaryDto {
        generated_at: Utc::now().to_rfc3339(),
        metrics: DashboardMetricsDto {
            active_time_today: active_time,
            mouse_events,
            keystrokes,
        },
    }
}

fn local_day_start_ms(day: NaiveDate) -> Option<i64> {
    let start_naive = day.and_hms_opt(0, 0, 0)?;
    let start = match Local.from_local_datetime(&start_naive) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(_, dt) => dt,
        LocalResult::None => return None,
    };
    Some(start.timestamp_millis())
}

fn build_timeline_sessions(
    day: NaiveDate,
    sessions: &[AppUsageSessionDto],
) -> Vec<AppUsageSessionDto> {
    const MAX_RAW_TIMELINE_SESSIONS: usize = 1_200;
    const MINUTES_PER_DAY: usize = 24 * 60;
    const MINUTE_MS: i64 = 60_000;

    if sessions.is_empty() {
        return Vec::new();
    }

    if sessions.len() <= MAX_RAW_TIMELINE_SESSIONS {
        let mut sorted = sessions.to_vec();
        sorted.sort_by(|a, b| a.started_at_ms.cmp(&b.started_at_ms));
        return sorted;
    }

    let Some(day_start_ms) = local_day_start_ms(day) else {
        return sessions
            .iter()
            .take(MAX_RAW_TIMELINE_SESSIONS)
            .cloned()
            .collect();
    };
    let day_end_ms = day_start_ms + MINUTES_PER_DAY as i64 * MINUTE_MS;

    let mut minute_slots: Vec<Option<(usize, i64)>> = vec![None; MINUTES_PER_DAY];

    for (session_index, session) in sessions.iter().enumerate() {
        let clamped_start = session.started_at_ms.max(day_start_ms);
        let clamped_end = session.ended_at_ms.min(day_end_ms);
        if clamped_end <= clamped_start {
            continue;
        }

        let start_minute = ((clamped_start - day_start_ms) / MINUTE_MS)
            .clamp(0, (MINUTES_PER_DAY - 1) as i64) as usize;
        let end_minute = (((clamped_end - 1) - day_start_ms) / MINUTE_MS)
            .clamp(0, (MINUTES_PER_DAY - 1) as i64) as usize;

        for minute in start_minute..=end_minute {
            let bucket_start_ms = day_start_ms + minute as i64 * MINUTE_MS;
            let bucket_end_ms = bucket_start_ms + MINUTE_MS;
            let overlap_ms =
                (clamped_end.min(bucket_end_ms) - clamped_start.max(bucket_start_ms)).max(0);

            if overlap_ms == 0 {
                continue;
            }

            let should_replace = match minute_slots[minute] {
                Some((_, current_overlap_ms)) => overlap_ms > current_overlap_ms,
                None => true,
            };

            if should_replace {
                minute_slots[minute] = Some((session_index, overlap_ms));
            }
        }
    }

    let mut result = Vec::new();
    let mut minute = 0usize;

    while minute < MINUTES_PER_DAY {
        let Some((session_index, _)) = minute_slots[minute] else {
            minute += 1;
            continue;
        };

        let mut end_minute = minute + 1;
        while end_minute < MINUTES_PER_DAY {
            match minute_slots[end_minute] {
                Some((next_session_index, _)) if next_session_index == session_index => {
                    end_minute += 1;
                }
                _ => break,
            }
        }

        let session = &sessions[session_index];
        let block_start_ms = day_start_ms + minute as i64 * MINUTE_MS;
        let block_end_ms = day_start_ms + end_minute as i64 * MINUTE_MS;
        let block_duration_ms = (block_end_ms - block_start_ms).max(MINUTE_MS);
        let session_duration_ms = (session.ended_at_ms - session.started_at_ms).max(1);
        let ratio = (block_duration_ms as f64 / session_duration_ms as f64).clamp(0.0, 1.0);

        result.push(AppUsageSessionDto {
            id: session.id,
            app_id: session.app_id.clone(),
            app_name: session.app_name.clone(),
            icon_data_url: session.icon_data_url.clone(),
            title: session.title.clone(),
            pid: session.pid,
            started_at_ms: block_start_ms,
            ended_at_ms: block_end_ms,
            duration_ms: block_duration_ms as u64,
            key_presses: (session.key_presses as f64 * ratio).round() as u32,
            mouse_clicks: (session.mouse_clicks as f64 * ratio).round() as u32,
            scroll_events: (session.scroll_events as f64 * ratio).round() as u32,
        });

        minute = end_minute;
    }

    result.sort_by(|a, b| a.started_at_ms.cmp(&b.started_at_ms));
    result
}

pub fn build_activity_overview(include_icons: bool) -> ActivityOverviewDto {
    build_activity_overview_for_date(None, include_icons).unwrap_or_else(|_| ActivityOverviewDto {
        generated_at: Utc::now().to_rfc3339(),
        total_sessions: 0,
        apps: Vec::new(),
        input_minutes: Vec::new(),
        timeline_sessions: Vec::new(),
    })
}

pub fn build_activity_overview_for_date(
    date: Option<String>,
    include_icons: bool,
) -> Result<ActivityOverviewDto, String> {
    let date_str = resolve_query_date(date)?;
    let query_date = parse_date(&date_str)?;
    const MAX_TIMELINE_SOURCE_SESSIONS: usize = 10_000;
    let sessions = activity_sessions_for_date(&date_str, MAX_TIMELINE_SOURCE_SESSIONS);
    let apps = activity_app_summaries_for_date(&date_str, include_icons);
    let input_minutes = input_minutes_for_date(&date_str);
    let total_sessions = apps
        .iter()
        .fold(0_u32, |total, app| total.saturating_add(app.session_count));

    Ok(ActivityOverviewDto {
        generated_at: Utc::now().to_rfc3339(),
        total_sessions,
        apps,
        input_minutes,
        timeline_sessions: build_timeline_sessions(query_date, &sessions),
    })
}

pub fn build_activity_app_usage_for_date(
    date: Option<String>,
    limit: Option<u32>,
    include_icons: bool,
) -> Result<crate::models::ActivityAppUsageDto, String> {
    let date_str = resolve_query_date(date)?;
    // Large full-day payloads are available through the paged `/activity/sessions` endpoint.
    // Keep this convenience endpoint bounded even when a caller omits `limit`.
    const DEFAULT_SESSION_LIMIT: usize = 500;
    const MAX_SESSION_LIMIT: usize = 2_000;
    let resolved_limit = limit
        .filter(|value| *value > 0)
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_SESSION_LIMIT)
        .min(MAX_SESSION_LIMIT);
    let session_dtos = activity_sessions_for_date(&date_str, resolved_limit);

    Ok(crate::models::ActivityAppUsageDto {
        generated_at: Utc::now().to_rfc3339(),
        sessions: session_dtos,
        apps: activity_app_summaries_for_date(&date_str, include_icons),
        input_minutes: input_minutes_for_date(&date_str),
    })
}

pub fn build_activity_input_minutes_for_date(
    date: Option<String>,
) -> Result<Vec<AppInputMinuteDto>, String> {
    let date_str = resolve_query_date(date)?;
    Ok(input_minutes_for_date(&date_str))
}

pub fn build_activity_session_page(
    offset: Option<u32>,
    limit: Option<u32>,
    filter_text: Option<String>,
    app_id: Option<String>,
    sort_field: Option<String>,
    sort_dir: Option<String>,
) -> ActivitySessionPageDto {
    build_activity_session_page_for_date(
        None,
        offset,
        limit,
        filter_text,
        app_id,
        sort_field,
        sort_dir,
    )
    .unwrap_or_else(|_| ActivitySessionPageDto {
        generated_at: Utc::now().to_rfc3339(),
        total: 0,
        offset: 0,
        limit: 0,
        has_more: false,
        sessions: Vec::new(),
    })
}

pub fn build_activity_session_page_for_date(
    date: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
    filter_text: Option<String>,
    app_id: Option<String>,
    sort_field: Option<String>,
    sort_dir: Option<String>,
) -> Result<ActivitySessionPageDto, String> {
    let resolved_limit = limit.unwrap_or(150).clamp(1, 500);
    let resolved_offset = offset.unwrap_or(0);
    let resolved_sort_field = sort_field.unwrap_or_else(|| "start".to_string());
    let resolved_sort_dir = sort_dir.unwrap_or_else(|| "desc".to_string());
    let date_str = resolve_query_date(date)?;
    let (total, rows) = db::load_activity_sessions_page_for_date(
        &date_str,
        filter_text.as_deref(),
        app_id.as_deref(),
        &resolved_sort_field,
        &resolved_sort_dir,
        resolved_limit,
        resolved_offset,
    );
    let sessions: Vec<AppUsageSessionDto> = rows
        .into_iter()
        .map(|row| AppUsageSessionDto {
            id: row.id,
            app_id: row.app_id,
            app_name: row.app_name,
            icon_data_url: None,
            title: row.title,
            pid: row.pid,
            started_at_ms: row.started_at_ms,
            ended_at_ms: row.ended_at_ms,
            duration_ms: (row.ended_at_ms - row.started_at_ms).max(0) as u64,
            key_presses: row.key_presses,
            mouse_clicks: row.mouse_clicks,
            scroll_events: row.scroll_events,
        })
        .collect();
    let has_more = resolved_offset.saturating_add(sessions.len() as u32) < total;

    Ok(ActivitySessionPageDto {
        generated_at: Utc::now().to_rfc3339(),
        total,
        offset: resolved_offset,
        limit: resolved_limit,
        has_more,
        sessions,
    })
}

pub fn build_activity_timeline(
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<ActivityTimelineDto, String> {
    let today = Local::now().date_naive();
    let start = match start_date {
        Some(value) => parse_date(&value)?,
        None => today - Duration::days(6),
    };
    let end = match end_date {
        Some(value) => parse_date(&value)?,
        None => today,
    };

    if end < start {
        return Err("end_date must be on or after start_date".to_string());
    }

    // Live in-memory minutes for today (may be ahead of SQLite by a few seconds).
    let today_live_minutes: Vec<AppInputMinuteDto> = app_usage_monitor::get_input_minutes();

    let day_count = (end - start).num_days() + 1;
    let is_hourly = day_count <= 1;
    let mut points = Vec::new();

    if is_hourly {
        let mins = input_minutes_for_timeline_date(start, today, &today_live_minutes);
        let day_agg = aggregate_today_input(&mins);
        for hour in 0..24 {
            let active = day_agg.hourly_active_minutes[hour as usize] as f32;

            points.push(ActivityTimelinePointDto {
                label: format!("{hour:02}:00"),
                active,
                inactive: 60.0 - active,
                full_date: format!("{} {hour:02}:00", start.format("%Y-%m-%d")),
            });
        }
    } else if day_count <= 31 {
        for offset in 0..day_count {
            let date = start + Duration::days(offset);
            let mins = input_minutes_for_timeline_date(date, today, &today_live_minutes);
            let agg = aggregate_today_input(&mins);
            let active = agg.total_active_minutes as f32 / 60.0;
            let label = if day_count <= 14 {
                format!("{}/{}", date.month(), date.day())
            } else {
                date.day().to_string()
            };

            points.push(ActivityTimelinePointDto {
                label,
                active,
                inactive: 24.0 - active,
                full_date: date.format("%Y-%m-%d").to_string(),
            });
        }
    } else {
        let week_count = ((day_count + 6) / 7) as usize;
        for week_index in 0..week_count {
            let week_start = start + Duration::days((week_index * 7) as i64);
            let week_end = std::cmp::min(week_start + Duration::days(6), end);
            let days_in_week = (week_end - week_start).num_days() + 1;
            let mut total_active_hours = 0.0_f32;
            for d in 0i64..days_in_week {
                let date = week_start + Duration::days(d);
                let mins = input_minutes_for_timeline_date(date, today, &today_live_minutes);
                let agg = aggregate_today_input(&mins);
                total_active_hours += agg.total_active_minutes as f32 / 60.0;
            }
            let active = total_active_hours / days_in_week as f32;

            points.push(ActivityTimelinePointDto {
                label: format!("W{}", week_index + 1),
                active,
                inactive: 24.0 - active,
                full_date: format!("Week of {}/{}", week_start.month(), week_start.day()),
            });
        }
    }

    let max_value = if is_hourly { 60.0 } else { 24.0 };
    let avg_active = if points.is_empty() {
        0.0
    } else {
        let total: f32 = points.iter().map(|point| point.active).sum();
        ((total / points.len() as f32) * 10.0).round() / 10.0
    };

    Ok(ActivityTimelineDto {
        generated_at: Utc::now().to_rfc3339(),
        start_date: start.format("%Y-%m-%d").to_string(),
        end_date: end.format("%Y-%m-%d").to_string(),
        is_hourly,
        y_label: if is_hourly {
            "Minutes".to_string()
        } else {
            "Hours".to_string()
        },
        max_value,
        avg_active,
        points,
    })
}

/// Returns an 8-row grid of sidecar intensity 0–100.
/// Rows are chronological: `today-6` … today, then tomorrow (always empty).
/// Each column is `HEATMAP_SLOT_SECS` (1 hour). Seconds below `QUALITY_PERSIST_MIN` do not count.
pub fn build_activity_heatmap() -> ActivityHeatmapDto {
    let today = Local::now().date_naive();
    let start = today - Duration::days(6);
    let today_live_minutes: Vec<AppInputMinuteDto> = app_usage_monitor::get_input_minutes();
    let threshold = crate::quality_live::persist_threshold_pct();
    let slot_secs = crate::quality_live::HEATMAP_SLOT_SECS;
    let slots = 86_400 / slot_secs;
    let mut grid = vec![vec![0u8; slots]; 8];
    for offset in 0..8 {
        let date = start + Duration::days(offset as i64);
        if date > today {
            continue;
        }
        let sidecar = crate::quality_live::samples_for_date(date);
        let mut row = crate::quality_live::heatmap_slots(&sidecar, threshold, slot_secs);
        let mins = input_minutes_for_timeline_date(date, today, &today_live_minutes);
        fill_empty_heatmap_slots(&mut row, &sidecar, &mins, slot_secs);
        grid[offset] = row;
    }
    ActivityHeatmapDto {
        grid,
        slot_seconds: slot_secs as u32,
    }
}

fn fill_empty_heatmap_slots(
    row: &mut [u8],
    sidecar: &[u8],
    minutes: &[AppInputMinuteDto],
    slot_secs: usize,
) {
    if slot_secs == 0 {
        return;
    }
    let mut active_minutes = std::collections::HashSet::new();
    for bucket in minutes {
        if bucket.key_presses > 0
            || bucket.mouse_clicks > 0
            || bucket.mouse_moves > 0
            || bucket.scroll_events > 0
        {
            active_minutes.insert(bucket.minute_of_day);
        }
    }
    let minutes_per_slot = (slot_secs / 60).max(1) as u32;
    for (slot, cell) in row.iter_mut().enumerate() {
        if *cell > 0 {
            continue;
        }
        let start_sec = slot * slot_secs;
        let end_sec = (start_sec + slot_secs).min(sidecar.len());
        let has_sidecar = sidecar
            .get(start_sec..end_sec)
            .is_some_and(|slice| slice.iter().any(|sample| *sample > 0));
        if has_sidecar {
            continue;
        }
        let start_min = (start_sec / 60) as u32;
        let counted = (0..minutes_per_slot)
            .filter(|offset| active_minutes.contains(&(start_min + offset)))
            .count() as u32;
        *cell = ((counted * 100) / minutes_per_slot) as u8;
    }
}

#[derive(Default)]
struct TodayInputAggregate {
    total_active_minutes: u32,
    hourly_active_minutes: [u32; 24],
    hourly_intensity: [u8; 24],
}

/// Same formula as the frontend `bucketIntensity`; cap matches standard APM scale (250).
fn bucket_activity_score(
    bucket: &AppInputMinuteDto,
    qualities: &std::collections::BTreeMap<u32, f64>,
) -> u32 {
    activity_score::bucket_activity_score_smoothed(bucket, qualities)
}

fn dto_from_minute_row(row: db::InputMinuteRow) -> AppInputMinuteDto {
    AppInputMinuteDto {
        minute_of_day: row.minute_of_day,
        key_presses: row.key_presses,
        mouse_clicks: row.mouse_clicks,
        mouse_moves: row.mouse_moves,
        scroll_events: row.scroll_events,
        diversity: activity_score::quality_from_centi(row.diversity_centi),
        timing: activity_score::quality_from_centi(row.timing_centi),
        quality: activity_score::quality_from_centi(row.quality_centi),
    }
}

fn input_minutes_for_date_from_db(date: &str) -> Vec<AppInputMinuteDto> {
    db::load_input_minutes_for_date(date)
        .into_iter()
        .map(dto_from_minute_row)
        .collect()
}

/// For timeline/heatmap: use live in-memory minutes for `today`, otherwise load from SQLite.
fn input_minutes_for_timeline_date(
    date: NaiveDate,
    today: NaiveDate,
    today_live: &[AppInputMinuteDto],
) -> Vec<AppInputMinuteDto> {
    if date == today {
        today_live.to_vec()
    } else {
        let date_str = date.format("%Y-%m-%d").to_string();
        input_minutes_for_date_from_db(&date_str)
    }
}

fn aggregate_today_input(input_minutes: &[AppInputMinuteDto]) -> TodayInputAggregate {
    let mut aggregate = TodayInputAggregate::default();
    let mut hourly_scores = [0u32; 24];
    let qualities = activity_score::qualities_by_minute(input_minutes);

    for bucket in input_minutes {
        let hour = (bucket.minute_of_day / 60).min(23) as usize;
        let is_active = bucket.key_presses > 0
            || bucket.mouse_clicks > 0
            || bucket.mouse_moves > 0
            || bucket.scroll_events > 0;

        if is_active {
            aggregate.total_active_minutes = aggregate.total_active_minutes.saturating_add(1);
            aggregate.hourly_active_minutes[hour] =
                aggregate.hourly_active_minutes[hour].saturating_add(1);
        }

        hourly_scores[hour] =
            hourly_scores[hour].saturating_add(bucket_activity_score(bucket, &qualities));
    }

    for (hour, score) in hourly_scores.into_iter().enumerate() {
        let active_pct = aggregate.hourly_active_minutes[hour].saturating_mul(100) / 60;
        // Map summed per-minute scores (each capped at STANDARD_APM_MAX) to 0–100% of a full hour.
        let denom = activity_score::STANDARD_APM_MAX.saturating_mul(60);
        let intensity_from_volume = score
            .saturating_mul(100)
            .checked_div(denom)
            .unwrap_or(0)
            .min(100) as u8;
        aggregate.hourly_intensity[hour] = active_pct.max(intensity_from_volume as u32) as u8;
    }

    aggregate
}

fn parse_date(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|error| format!("invalid date '{value}': {error}"))
}

pub fn resolve_query_date(date: Option<String>) -> Result<String, String> {
    match date {
        Some(value) => {
            parse_date(value.trim())?;
            Ok(value.trim().to_string())
        }
        None => Ok(Local::now().date_naive().format("%Y-%m-%d").to_string()),
    }
}

fn activity_sessions_for_date(date: &str, limit: usize) -> Vec<AppUsageSessionDto> {
    db::load_activity_session_rows_for_date(date, limit)
        .into_iter()
        .map(|row| AppUsageSessionDto {
            id: row.id,
            app_id: row.app_id,
            app_name: row.app_name,
            icon_data_url: None,
            title: row.title,
            pid: row.pid,
            started_at_ms: row.started_at_ms,
            ended_at_ms: row.ended_at_ms,
            duration_ms: (row.ended_at_ms - row.started_at_ms).max(0) as u64,
            key_presses: row.key_presses,
            mouse_clicks: row.mouse_clicks,
            scroll_events: row.scroll_events,
        })
        .collect()
}

fn activity_app_summaries_for_date(
    date: &str,
    include_icons: bool,
) -> Vec<crate::models::AppUsageSummaryDto> {
    db::load_activity_app_summaries_for_date(date, include_icons)
        .into_iter()
        .map(|row| crate::models::AppUsageSummaryDto {
            app_id: row.app_id,
            app_name: row.app_name,
            icon_data_url: row.icon_data_url,
            session_count: row.session_count,
            total_duration_ms: row.total_duration_ms,
            key_presses: row.key_presses,
            mouse_clicks: row.mouse_clicks,
            scroll_events: row.scroll_events,
        })
        .collect()
}

fn input_minutes_for_date(date: &str) -> Vec<AppInputMinuteDto> {
    let today_str = Local::now().date_naive().format("%Y-%m-%d").to_string();
    if date == today_str {
        return app_usage_monitor::get_input_minutes();
    }

    db::load_input_minutes_for_date(date)
        .into_iter()
        .map(dto_from_minute_row)
        .collect()
}

const LOG_LEVELS: [&str; 5] = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];
const MAX_LOG_FILES_TO_SCAN: usize = 32;
const MAX_LOG_TAIL_BYTES_PER_FILE: u64 = 2 * 1024 * 1024;

/// Read only a bounded suffix of a log file. A whole-day log can be very large after a fault;
/// loading it in full on every UI refresh would turn the diagnostics page into a memory spike.
fn tail_log_lines(path: &Path, limit: usize) -> Vec<String> {
    if limit == 0 {
        return Vec::new();
    }

    let Ok(mut file) = File::open(path) else {
        return Vec::new();
    };
    let Ok(length) = file.metadata().map(|metadata| metadata.len()) else {
        return Vec::new();
    };
    let start = length.saturating_sub(MAX_LOG_TAIL_BYTES_PER_FILE);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }

    let mut bytes = Vec::with_capacity((length - start) as usize);
    if file.read_to_end(&mut bytes).is_err() {
        return Vec::new();
    }

    // When reading from the middle, discard the first partial line rather than displaying a
    // misleading truncated entry. The newest complete lines remain available.
    if start > 0 {
        let Some(first_newline) = bytes.iter().position(|byte| *byte == b'\n') else {
            return Vec::new();
        };
        bytes.drain(..=first_newline);
    }

    let content = String::from_utf8_lossy(&bytes);
    let mut lines: Vec<String> = content
        .lines()
        .rev()
        .take(limit)
        .map(str::to_string)
        .collect();
    lines.reverse();
    lines
}

/// Read the most recent application log entries, newest first.
///
/// Reads from the newest rolling log files in `log_dir` (which roll daily and are named
/// `mytime.log.<date>` in UTC), tailing enough lines to satisfy `limit`. Lines are parsed
/// from the tracing fmt layout `TIMESTAMP  LEVEL target: message`; unparseable lines are
/// still surfaced verbatim so nothing is hidden.
pub fn read_recent_logs(log_dir: &Path, limit: usize) -> Vec<LogEntryDto> {
    let limit = limit.clamp(1, 2000);

    // Collect rolling log files, newest-modified first.
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> =
        match std::fs::read_dir(log_dir) {
            Ok(entries) => entries
                .flatten()
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("mytime.log")
                })
                .filter_map(|entry| {
                    let modified = entry.metadata().and_then(|m| m.modified()).ok()?;
                    Some((modified, entry.path()))
                })
                .collect(),
            Err(_) => return Vec::new(),
        };
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.truncate(MAX_LOG_FILES_TO_SCAN);

    // Tail lines from newest files until we have enough.
    let mut raw_lines: Vec<String> = Vec::new();
    for (_, path) in &files {
        if raw_lines.len() >= limit {
            break;
        }
        let take = limit.saturating_sub(raw_lines.len());
        let lines = tail_log_lines(path, take);
        if !lines.is_empty() {
            // Prepend older-file lines so overall order stays chronological.
            let mut combined = lines;
            combined.append(&mut raw_lines);
            raw_lines = combined;
        }
    }

    // raw_lines is chronological (oldest first); assign ids 1..=N so the newest line has the
    // highest id, then reverse so the result is newest-first.
    raw_lines
        .iter()
        .enumerate()
        .map(|(index, line)| parse_log_line(index as u64 + 1, line))
        .rev()
        .collect()
}

fn parse_log_line(id: u64, line: &str) -> LogEntryDto {
    let mut parts = line.splitn(2, "  "); // tracing separates timestamp/level with two spaces
    let timestamp_token = parts.next().unwrap_or("").trim();
    let rest = parts.next().unwrap_or("").trim();

    let looks_like_timestamp = timestamp_token.len() >= 20
        && timestamp_token.contains('T')
        && timestamp_token.ends_with('Z');

    if !looks_like_timestamp || rest.is_empty() {
        return LogEntryDto {
            id,
            timestamp: None,
            level: "UNKNOWN".to_string(),
            target: None,
            message: line.trim().to_string(),
        };
    }

    // rest is "LEVEL target: message"
    let mut rest_parts = rest.splitn(2, ' ');
    let level_token = rest_parts.next().unwrap_or("").trim();
    let after_level = rest_parts.next().unwrap_or("").trim();

    let level = if LOG_LEVELS.contains(&level_token) {
        level_token.to_string()
    } else {
        "UNKNOWN".to_string()
    };

    let (target, message) = match after_level.split_once(": ") {
        Some((target, message)) if !target.contains(' ') => {
            (Some(target.to_string()), message.to_string())
        }
        _ => (None, after_level.to_string()),
    };

    LogEntryDto {
        id,
        timestamp: Some(timestamp_token.to_string()),
        level,
        target,
        message,
    }
}

#[cfg(test)]
mod log_tests {
    use super::*;

    #[test]
    fn log_tail_returns_only_the_requested_newest_lines() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("mytime.log.test");
        std::fs::write(&path, "one\ntwo\nthree\nfour\n").expect("write log");

        assert_eq!(tail_log_lines(&path, 2), vec!["three", "four"]);
    }

    #[test]
    fn log_tail_discards_a_partial_oversized_line() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join("mytime.log.test");
        let mut content = "x".repeat(MAX_LOG_TAIL_BYTES_PER_FILE as usize + 128);
        content.push_str("\nkept-one\nkept-two\n");
        std::fs::write(&path, content).expect("write oversized log");

        assert_eq!(tail_log_lines(&path, 2), vec!["kept-one", "kept-two"]);
    }
}
