//! Process-wide live work-quality collector.
//!
//! Accepted hardware events feed a 1 Hz mixed-quality ring. A 86_400-byte sidecar
//! (`quality-live/quality-YYYY-MM-DD.bin`) is flushed every 30s, on Refresh, and on quit.
//! Injected/remote events never reach this module.

use chrono::{Local, NaiveDate, Timelike, Utc};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicI64, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};
use tracing::{info, warn};

use crate::activity_score;
use crate::input_complexity::{self, ActionCategory, Symbol, SymbolRing};
use crate::input_monitor::InputMonitorEventDto;

pub const QUALITY_LIVE_EVENT: &str = "quality-live://tick";
const SECONDS_PER_DAY: usize = 86_400;
const SLOT_SECS: usize = 30;
const HARDWARE_GRACE_MS: i64 = 30_000;
const RETENTION_DAYS: i64 = 7;
const TICK_MS: u64 = 250;
/// Weekly heatmap column width. 3600s → 24 hour cells/day.
pub const HEATMAP_SLOT_SECS: usize = 3600;
const FILE_PREFIX: &str = "quality-";
const FILE_SUFFIX: &str = ".bin";

static SIDECAR_DIR: OnceLock<PathBuf> = OnceLock::new();
static LAST_HARDWARE_MS: AtomicI64 = AtomicI64::new(0);
/// True = do not write activity SQLite (minutes/sessions) for the current ingest window.
static SKIP_ACTIVITY_PERSIST: AtomicBool = AtomicBool::new(false);
static STATE: OnceLock<Mutex<Collector>> = OnceLock::new();

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityLiveDto {
    pub percent: u8,
    pub samples: Vec<u8>,
    pub window_ms: u32,
    pub skip_activity_persist: bool,
    pub second_of_day: u32,
}

#[derive(Default, Clone, Copy)]
struct SecondCounts {
    keys: u32,
    clicks: u32,
    scrolls: u32,
    moves: u32,
}

impl SecondCounts {
    fn add(&mut self, event: &InputMonitorEventDto) {
        match (event.kind, event.action) {
            ("keyboard", "press") => self.keys = self.keys.saturating_add(1),
            ("mouse", "press") => self.clicks = self.clicks.saturating_add(1),
            ("scroll", "wheel") => self.scrolls = self.scrolls.saturating_add(1),
            ("mouse", "move") => self.moves = self.moves.saturating_add(1),
            _ => {}
        }
    }

    fn is_empty(self) -> bool {
        self.keys == 0 && self.clicks == 0 && self.scrolls == 0 && self.moves == 0
    }
}

struct Collector {
    date: NaiveDate,
    day: Vec<u8>,
    dirty: bool,
    open_unix_sec: i64,
    counts: SecondCounts,
    symbols: SymbolRing,
    dir: PathBuf,
}

pub fn skip_activity_persist() -> bool {
    SKIP_ACTIVITY_PERSIST.load(Ordering::Relaxed)
}

pub fn last_accepted_hardware_ms() -> i64 {
    LAST_HARDWARE_MS.load(Ordering::Relaxed)
}

pub fn hardware_recent() -> bool {
    let last = last_accepted_hardware_ms();
    if last <= 0 {
        return false;
    }
    let now = Utc::now().timestamp_millis();
    now.saturating_sub(last) <= HARDWARE_GRACE_MS
}

/// Sessions and activity-minute ingest: recent accepted hardware and not in a skip slot.
pub fn should_persist_sessions() -> bool {
    hardware_recent() && !skip_activity_persist()
}

/// Start second of the still-open 30s ingest slot (local day).
pub fn open_slot_start_sec() -> usize {
    (second_of_day_now() / SLOT_SECS) * SLOT_SECS
}

pub fn start<R: Runtime>(app: AppHandle<R>, data_dir: &Path) {
    let dir = data_dir.join("quality-live");
    if fs::create_dir_all(&dir).is_err() {
        warn!(path = %dir.display(), "failed to create quality-live directory");
    }
    prune_old_sidecars(&dir);
    let _ = SIDECAR_DIR.set(dir.clone());

    let today = Local::now().date_naive();
    let mut day = vec![0u8; SECONDS_PER_DAY];
    load_sidecar(&dir, today, &mut day);

    let collector = Collector {
        date: today,
        day,
        dirty: false,
        open_unix_sec: Utc::now().timestamp(),
        counts: SecondCounts::default(),
        symbols: SymbolRing::new(),
        dir,
    };

    if STATE.set(Mutex::new(collector)).is_err() {
        warn!("quality_live already started");
        return;
    }

    let app_tick = app.clone();
    let _ = thread::Builder::new()
        .name("mytime-quality-live".to_string())
        .spawn(move || loop {
            thread::sleep(Duration::from_millis(TICK_MS));
            let closed = with_collector(|state| close_through_now(state)).unwrap_or(false);
            if closed {
                let dto = snapshot();
                let _ = app_tick.emit(QUALITY_LIVE_EVENT, &dto);
            }
        });

    info!("started quality_live collector");
}

/// Record an accepted hardware event into the current second. Never called for injected/remote.
pub fn note_event(event: &InputMonitorEventDto) {
    LAST_HARDWARE_MS.store(event.timestamp, Ordering::Relaxed);
    let unix_sec = event.timestamp.div_euclid(1000);
    with_collector(|state| {
        close_through(state, unix_sec);
        if state.open_unix_sec == unix_sec {
            state.counts.add(event);
            if let Some(category) = ActionCategory::from_event(event.kind, event.action) {
                let symbol = match (category, event.x, event.y) {
                    (ActionCategory::Move, Some(x), Some(y)) => {
                        Symbol::moved(event.timestamp, x, y)
                    }
                    _ => Symbol::new(category, event.timestamp),
                };
                state.symbols.push(symbol);
            }
        }
    });
}

pub fn snapshot() -> QualityLiveDto {
    let window_ms = activity_score::live_window_ms();
    let slots = ((window_ms / 1000).max(1) as usize).min(SECONDS_PER_DAY);
    with_collector(|state| {
        close_through_now(state);
        let second = last_closed_second(state);
        let samples = last_samples(&state.day, second, slots);
        QualityLiveDto {
            percent: mean_u8(&samples),
            samples,
            window_ms,
            skip_activity_persist: skip_activity_persist(),
            second_of_day: second as u32,
        }
    })
    .unwrap_or_else(|| QualityLiveDto {
        percent: 0,
        samples: vec![0; slots],
        window_ms,
        skip_activity_persist: skip_activity_persist(),
        second_of_day: second_of_day_now() as u32,
    })
}

pub fn day_samples() -> Vec<u8> {
    with_collector(|state| {
        close_through_now(state);
        state.day.clone()
    })
    .unwrap_or_else(|| vec![0u8; SECONDS_PER_DAY])
}

pub fn persist_threshold_pct() -> u8 {
    (activity_score::persist_min() * 100.0)
        .round()
        .clamp(1.0, 100.0) as u8
}

pub fn samples_for_date(date: NaiveDate) -> Vec<u8> {
    if date == Local::now().date_naive() {
        return day_samples();
    }
    let mut day = vec![0u8; SECONDS_PER_DAY];
    if let Some(dir) = SIDECAR_DIR.get() {
        load_sidecar(dir, date, &mut day);
    }
    day
}

/// 0–100: share of seconds in each slot whose percent is at least `threshold`.
pub fn heatmap_slots(day: &[u8], threshold: u8, slot_secs: usize) -> Vec<u8> {
    if slot_secs == 0 {
        return Vec::new();
    }
    let n = SECONDS_PER_DAY / slot_secs;
    let mut out = vec![0u8; n];
    for slot in 0..n {
        let start = slot * slot_secs;
        let end = (start + slot_secs).min(day.len());
        if start >= end {
            continue;
        }
        let mut counted = 0u32;
        for sample in &day[start..end] {
            if *sample >= threshold {
                counted = counted.saturating_add(1);
            }
        }
        let len = (end - start) as u32;
        out[slot] = ((counted * 100) / len.max(1)) as u8;
    }
    out
}

pub fn refresh() -> QualityLiveDto {
    flush();
    with_collector(|state| {
        load_sidecar(&state.dir, state.date, &mut state.day);
        state.dirty = false;
    });
    snapshot()
}

pub fn flush() {
    with_collector(|state| {
        close_through_now(state);
        if state.dirty {
            write_sidecar(&state.dir, state.date, &state.day);
            state.dirty = false;
        }
    });
}

fn with_collector<T>(f: impl FnOnce(&mut Collector) -> T) -> Option<T> {
    let lock = STATE.get()?;
    let Ok(mut state) = lock.lock() else {
        return None;
    };
    Some(f(&mut state))
}

fn close_through_now(state: &mut Collector) -> bool {
    let now_sec = Utc::now().timestamp();
    let before = state.open_unix_sec;
    close_through(state, now_sec);
    before < now_sec
}

fn close_through(state: &mut Collector, unix_sec: i64) {
    if state.open_unix_sec <= 0 {
        state.open_unix_sec = unix_sec;
        return;
    }
    while state.open_unix_sec < unix_sec {
        close_open_second(state);
    }
}

fn close_open_second(state: &mut Collector) {
    let unix_sec = state.open_unix_sec;
    let (date, index) = date_and_index(unix_sec);
    if date != state.date {
        if state.dirty {
            write_sidecar(&state.dir, state.date, &state.day);
        }
        state.date = date;
        state.day = vec![0u8; SECONDS_PER_DAY];
        load_sidecar(&state.dir, date, &mut state.day);
        state.dirty = false;
    }

    let percent = second_percent(state.counts, &window_symbols(state));
    if index < SECONDS_PER_DAY {
        state.day[index] = percent;
        state.dirty = true;
        if (index + 1) % SLOT_SECS == 0 {
            apply_persist_gate(&state.day, index);
            write_sidecar(&state.dir, state.date, &state.day);
            state.dirty = false;
        }
    }
    state.counts = SecondCounts::default();
    state.open_unix_sec = unix_sec.saturating_add(1);
}

fn apply_persist_gate(day: &[u8], closed_index: usize) {
    let start = closed_index + 1 - SLOT_SECS;
    let mean = mean_u8(&day[start..=closed_index]) as f64 / 100.0;
    let skip = mean < activity_score::persist_min() as f64;
    SKIP_ACTIVITY_PERSIST.store(skip, Ordering::Relaxed);
    if skip {
        crate::app_usage_monitor::drop_seconds(start, closed_index + 1);
    }
}

fn last_closed_second(state: &Collector) -> usize {
    if state.open_unix_sec > 0 {
        date_and_index(state.open_unix_sec.saturating_sub(1)).1
    } else {
        second_of_day_now()
    }
}

fn window_symbols(state: &Collector) -> Vec<Symbol> {
    let window_ms = activity_score::live_window_ms() as i64;
    let end_ms = state.open_unix_sec.saturating_add(1).saturating_mul(1000);
    let start_ms = end_ms.saturating_sub(window_ms);
    state.symbols.in_range(start_ms, end_ms)
}

/// Idle second → 0. Active second → LZ76 + permutation entropy of the last
/// `QUALITY_LIVE_WINDOW_MS` of action symbols (not the 0 / 45 / 100 mix).
fn second_percent(counts: SecondCounts, symbols: &[Symbol]) -> u8 {
    if counts.is_empty() {
        return 0;
    }
    let score = input_complexity::score_symbols(symbols);
    let quality = score.continuous(symbols.len());
    (quality.clamp(0.0, 1.0) * 100.0).round() as u8
}

fn second_of_day_now() -> usize {
    let now = Local::now();
    ((now.hour() * 3600 + now.minute() * 60 + now.second()) as usize).min(SECONDS_PER_DAY - 1)
}

fn date_and_index(unix_sec: i64) -> (NaiveDate, usize) {
    let Some(utc) = chrono::DateTime::from_timestamp(unix_sec, 0) else {
        return (Local::now().date_naive(), 0);
    };
    let local = utc.with_timezone(&Local);
    let index = (local.hour() * 3600 + local.minute() * 60 + local.second()) as usize;
    (local.date_naive(), index.min(SECONDS_PER_DAY - 1))
}

fn last_samples(day: &[u8], current_index: usize, slots: usize) -> Vec<u8> {
    let mut samples = vec![0u8; slots];
    for i in 0..slots {
        let offset = slots - 1 - i;
        if current_index >= offset {
            samples[i] = day[current_index - offset];
        }
    }
    samples
}

fn mean_u8(samples: &[u8]) -> u8 {
    if samples.is_empty() {
        return 0;
    }
    let sum: u32 = samples.iter().map(|v| *v as u32).sum();
    (sum / samples.len() as u32) as u8
}

fn sidecar_path(dir: &Path, date: NaiveDate) -> PathBuf {
    dir.join(format!(
        "{FILE_PREFIX}{}{FILE_SUFFIX}",
        date.format("%Y-%m-%d")
    ))
}

fn load_sidecar(dir: &Path, date: NaiveDate, day: &mut [u8]) {
    let path = sidecar_path(dir, date);
    let Ok(bytes) = fs::read(&path) else {
        return;
    };
    let n = bytes.len().min(day.len());
    day[..n].copy_from_slice(&bytes[..n]);
}

fn write_sidecar(dir: &Path, date: NaiveDate, day: &[u8]) {
    let path = sidecar_path(dir, date);
    if let Err(error) = fs::write(&path, day) {
        warn!(path = %path.display(), %error, "failed to flush quality-live sidecar");
    }
}

fn prune_old_sidecars(dir: &Path) {
    let cutoff = Local::now().date_naive() - chrono::Duration::days(RETENTION_DAYS);
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut removed = 0_u32;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(date) = parse_sidecar_name(&name) else {
            continue;
        };
        if date < cutoff && fs::remove_file(entry.path()).is_ok() {
            removed = removed.saturating_add(1);
        }
    }
    if removed > 0 {
        info!(removed, "pruned old quality-live sidecars");
    }
}

fn parse_sidecar_name(name: &str) -> Option<NaiveDate> {
    let rest = name.strip_prefix(FILE_PREFIX)?;
    let stamp = rest.strip_suffix(FILE_SUFFIX)?;
    NaiveDate::parse_from_str(stamp, "%Y-%m-%d").ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seq(category: ActionCategory, n: usize, dt: i64) -> Vec<Symbol> {
        (0..n)
            .map(|i| Symbol::new(category, i as i64 * dt))
            .collect()
    }

    fn mixed(n: usize) -> Vec<Symbol> {
        let cats = [
            ActionCategory::Key,
            ActionCategory::Click,
            ActionCategory::Move,
            ActionCategory::Scroll,
            ActionCategory::FocusSwitch,
        ];
        (0..n)
            .map(|i| {
                let mut x = (i as u32).wrapping_mul(0x9E37_79B9);
                x ^= x >> 16;
                Symbol::new(
                    cats[(x as usize) % cats.len()],
                    i as i64 * (17 + (i as i64 % 11) * 3),
                )
            })
            .collect()
    }

    fn active() -> SecondCounts {
        SecondCounts {
            keys: 1,
            ..SecondCounts::default()
        }
    }

    #[test]
    fn idle_second_is_zero() {
        assert_eq!(second_percent(SecondCounts::default(), &[]), 0);
    }

    #[test]
    fn mixed_work_is_high_but_not_browsing_floor() {
        let percent = second_percent(active(), &mixed(80));
        assert!(percent >= 55, "mixed percent={percent}");
        assert_ne!(percent, 45);
    }

    #[test]
    fn one_channel_irregular_is_not_snapped_to_100() {
        let symbols: Vec<Symbol> = (0..40)
            .map(|i| {
                Symbol::new(
                    ActionCategory::Key,
                    (0..i).map(|j| 20 + (j * 13) % 97).sum::<i64>(),
                )
            })
            .collect();
        let percent = second_percent(active(), &symbols);
        assert!(percent > 0 && percent < 90, "one-channel percent={percent}");
        assert_ne!(percent, 45);
        assert_ne!(percent, 100);
    }

    #[test]
    fn monotone_scroll_is_entropy_not_browsing_floor() {
        let percent = second_percent(
            SecondCounts {
                keys: 0,
                clicks: 0,
                scrolls: 20,
                moves: 0,
            },
            &seq(ActionCategory::Scroll, 80, 40),
        );
        assert!(percent < 40, "monotone percent={percent}");
        assert_ne!(percent, 45);
    }

    #[test]
    fn mixed_scores_above_monotone() {
        let mixed_p = second_percent(active(), &mixed(80));
        let mono_p = second_percent(active(), &seq(ActionCategory::Scroll, 80, 40));
        assert!(mixed_p > mono_p, "mixed={mixed_p} monotone={mono_p}");
    }

    #[test]
    fn persist_gate_skips_idle_heavy_slot() {
        SKIP_ACTIVITY_PERSIST.store(false, Ordering::Relaxed);
        let mut day = vec![0u8; SLOT_SECS];
        apply_persist_gate(&day, SLOT_SECS - 1);
        assert!(skip_activity_persist());
        for sample in day.iter_mut() {
            *sample = 50;
        }
        apply_persist_gate(&day, SLOT_SECS - 1);
        assert!(!skip_activity_persist());
    }

    #[test]
    fn sidecar_name_roundtrip() {
        let date = NaiveDate::from_ymd_opt(2026, 8, 29).unwrap();
        let name = format!("{FILE_PREFIX}{}{FILE_SUFFIX}", date.format("%Y-%m-%d"));
        assert_eq!(parse_sidecar_name(&name), Some(date));
        assert!(parse_sidecar_name("mytime.sqlite3").is_none());
    }

    #[test]
    fn last_samples_does_not_repeat_midnight() {
        let mut day = vec![0u8; 10];
        day[0] = 10;
        day[4] = 40;
        assert_eq!(last_samples(&day, 4, 5), vec![10, 0, 0, 0, 40]);
        assert_eq!(last_samples(&day, 1, 5), vec![0, 0, 0, 10, 0]);
    }

    #[test]
    fn heatmap_slots_count_only_high_quality_seconds() {
        let mut day = vec![0u8; SECONDS_PER_DAY];
        for sample in day.iter_mut().take(300) {
            *sample = 10;
        }
        for sample in day.iter_mut().skip(300).take(150) {
            *sample = 80;
        }
        let row = heatmap_slots(&day, 25, 300);
        assert_eq!(row[0], 0);
        assert_eq!(row[1], 50);
        assert_eq!(row[2], 0);
        assert_eq!(heatmap_slots(&day, 25, 3600).len(), 24);
    }
}
