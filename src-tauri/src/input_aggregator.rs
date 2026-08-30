//! Aggregates global input events (same stream as the hook) for dashboard stats and live feed.
//! Only receives events when the Windows hook is running; get_stats/get_recent_events work on all platforms.

use chrono::{Local, NaiveDate, TimeZone};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

use crate::{
    input_monitor::InputMonitorEventDto,
    input_sequence::{self, SequenceState},
    models::{InputStatsDto, LiveFeedEventDto},
};

const MAX_RECENT_EVENTS: usize = 100;

struct Inner {
    date_today: NaiveDate,
    key_presses: u64,
    mouse_events: u64,
    scroll_events: u64,
    first_activity_ts_ms: Option<i64>,
    last_activity_ts_ms: Option<i64>,
    recent: VecDeque<LiveFeedEventDto>,
    last_sequence: Option<SequenceState>,
}

static AGGREGATOR: OnceLock<Mutex<Inner>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn ensure_today(inner: &mut Inner) {
    let today = Local::now().date_naive();
    if inner.date_today != today {
        inner.date_today = today;
        inner.key_presses = 0;
        inner.mouse_events = 0;
        inner.scroll_events = 0;
        inner.first_activity_ts_ms = None;
        inner.last_activity_ts_ms = None;
        inner.recent.clear();
        inner.last_sequence = None;
    }
}

fn push_recent(inner: &mut Inner, dto: LiveFeedEventDto) {
    inner.recent.push_front(dto);
    while inner.recent.len() > MAX_RECENT_EVENTS {
        inner.recent.pop_back();
    }
}

fn upsert_recent(inner: &mut Inner, dto: LiveFeedEventDto, replace_latest: bool) {
    if replace_latest {
        if let Some(existing) = inner.recent.front_mut() {
            existing.event_type = dto.event_type;
            existing.description = dto.description;
            existing.timestamp = dto.timestamp;
            existing.detail = dto.detail;
            return;
        }
    }

    push_recent(inner, dto);
}

fn feed_description(event: &InputMonitorEventDto) -> String {
    match (event.kind, event.action) {
        ("mouse", "move") => "Mouse Move".to_string(),
        ("scroll", "wheel") => event.label.clone(),
        _ => event.label.clone(),
    }
}

/// Record an event from the global hook (called from the input_monitor emitter thread on Windows).
pub fn record(event: &InputMonitorEventDto) {
    let Some(mutex) = AGGREGATOR.get() else {
        return;
    };
    let Ok(mut inner) = mutex.lock() else { return };

    ensure_today(&mut inner);

    let ts = event.timestamp;
    if inner.first_activity_ts_ms.is_none() {
        inner.first_activity_ts_ms = Some(ts);
    }
    inner.last_activity_ts_ms = Some(ts);
    let is_sequence_continuation = input_sequence::is_continuation(inner.last_sequence, event);

    let event_type = match event.kind {
        "keyboard" => "keyboard",
        "mouse" => "mouse",
        "scroll" => "scroll",
        _ => "mouse",
    };

    match event.kind {
        "keyboard" => {
            if event.action == "press" {
                inner.key_presses = inner.key_presses.saturating_add(1);
            }
        }
        "mouse" => {
            if event.action == "press" || (event.action == "move" && !is_sequence_continuation) {
                inner.mouse_events = inner.mouse_events.saturating_add(1);
            }
        }
        "scroll" => {
            if event.action == "press" || (event.action == "wheel" && !is_sequence_continuation) {
                inner.scroll_events = inner.scroll_events.saturating_add(1);
            }
        }
        _ => {}
    }

    let time_str = format_timestamp(ts);
    let detail = detail_string(event);
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    upsert_recent(
        &mut inner,
        LiveFeedEventDto {
            id,
            event_type: event_type.to_string(),
            description: feed_description(event),
            timestamp: time_str,
            detail: if detail.is_empty() {
                None
            } else {
                Some(detail)
            },
        },
        is_sequence_continuation,
    );
    inner.last_sequence = Some(SequenceState::from_event(event));
}

fn format_timestamp(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|dt| dt.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "00:00:00".to_string())
}

fn detail_string(e: &InputMonitorEventDto) -> String {
    let mut parts = Vec::new();
    if let (Some(x), Some(y)) = (e.x, e.y) {
        parts.push(format!("({}, {})", x, y));
    }
    if !matches!((e.kind, e.action), ("scroll", "wheel")) {
        if let Some(ref d) = e.direction {
            parts.push(format!("scroll {}", d));
        }
    }
    if !matches!((e.kind, e.action), ("mouse", "move")) {
        if let Some(ref b) = e.button {
            parts.push(b.to_string());
        }
    }
    parts.join(", ")
}

/// Initialize the aggregator (call once when starting the global input monitor).
pub fn init() {
    let today = Local::now().date_naive();
    let date_str = today.format("%Y-%m-%d").to_string();

    // Hydrate from the bounded minute aggregates. Raw hook events are intentionally ephemeral.
    let minutes = crate::db::load_input_minutes_for_date(&date_str);
    let mut key_presses = 0_u64;
    let mut mouse_events = 0_u64;
    let mut scroll_events = 0_u64;
    let mut first_minute: Option<u32> = None;
    let mut last_minute: Option<u32> = None;

    for row in minutes {
        key_presses = key_presses.saturating_add(row.key_presses as u64);
        mouse_events =
            mouse_events.saturating_add(row.mouse_clicks as u64 + row.mouse_moves as u64);
        scroll_events = scroll_events.saturating_add(row.scroll_events as u64);
        if row.key_presses > 0
            || row.mouse_clicks > 0
            || row.mouse_moves > 0
            || row.scroll_events > 0
        {
            first_minute =
                Some(first_minute.map_or(row.minute_of_day, |value| value.min(row.minute_of_day)));
            last_minute =
                Some(last_minute.map_or(row.minute_of_day, |value| value.max(row.minute_of_day)));
        }
    }

    let day_start_ms = today
        .and_hms_opt(0, 0, 0)
        .and_then(|value| Local.from_local_datetime(&value).earliest())
        .map(|value| value.timestamp_millis());
    let first_ts = day_start_ms
        .zip(first_minute)
        .map(|(start, minute)| start.saturating_add(minute as i64 * 60_000));
    let last_ts = day_start_ms.zip(last_minute).map(|(start, minute)| {
        start
            .saturating_add((minute as i64 + 1) * 60_000)
            .saturating_sub(1)
    });

    let _ = AGGREGATOR.set(Mutex::new(Inner {
        date_today: today,
        key_presses,
        mouse_events,
        scroll_events,
        first_activity_ts_ms: first_ts,
        last_activity_ts_ms: last_ts,
        recent: VecDeque::new(),
        last_sequence: None,
    }));
}

/// Returns current input stats for today, or None if aggregator not initialized.
/// If the stored date is not today (e.g. past midnight, no events yet), returns zeroed stats.
pub fn get_stats() -> Option<InputStatsDto> {
    let guard = AGGREGATOR.get()?.lock().ok()?;
    let inner = guard;
    let today = Local::now().date_naive();
    if inner.date_today != today {
        return Some(InputStatsDto {
            key_presses_today: 0,
            mouse_events_today: 0,
            scroll_events_today: 0,
            first_activity_ts_ms: None,
            last_activity_ts_ms: None,
        });
    }
    Some(InputStatsDto {
        key_presses_today: inner.key_presses,
        mouse_events_today: inner.mouse_events,
        scroll_events_today: inner.scroll_events,
        first_activity_ts_ms: inner.first_activity_ts_ms,
        last_activity_ts_ms: inner.last_activity_ts_ms,
    })
}

/// Returns the most recent events for the live feed (newest first).
pub fn get_recent_events(limit: Option<u32>) -> Vec<LiveFeedEventDto> {
    let Some(mutex) = AGGREGATOR.get() else {
        return Vec::new();
    };
    let Ok(inner) = mutex.lock() else {
        return Vec::new();
    };

    let cap = limit.unwrap_or(50).min(MAX_RECENT_EVENTS as u32) as usize;
    inner.recent.iter().take(cap).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_feed_stays_bounded_under_sustained_activity() {
        let mut inner = Inner {
            date_today: NaiveDate::from_ymd_opt(2026, 8, 3).unwrap(),
            key_presses: 0,
            mouse_events: 0,
            scroll_events: 0,
            first_activity_ts_ms: None,
            last_activity_ts_ms: None,
            recent: VecDeque::new(),
            last_sequence: None,
        };

        for id in 0..100_000_u64 {
            push_recent(
                &mut inner,
                LiveFeedEventDto {
                    id,
                    event_type: "keyboard".to_string(),
                    description: "Press A".to_string(),
                    timestamp: "12:00:00".to_string(),
                    detail: None,
                },
            );
        }

        assert_eq!(inner.recent.len(), MAX_RECENT_EVENTS);
        assert_eq!(inner.recent.front().map(|event| event.id), Some(99_999));
        assert_eq!(inner.recent.back().map(|event| event.id), Some(99_900));
    }
}
