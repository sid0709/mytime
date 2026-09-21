use chrono::{Local, Timelike, Utc};
#[cfg(windows)]
use std::collections::HashMap;
use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    sync::{
        atomic::{AtomicI64, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Runtime};
use tracing::{info, warn};

use crate::{
    db,
    input_monitor::InputMonitorEventDto,
    input_sequence::{self, SequenceState},
    models::AppInputMinuteDto,
};

/// Inactivity interval: activity extends 30s past last input. Inactivity starts at last_activity + 30s.
pub const INACTIVITY_INTERVAL_MS: i64 = 30_000;
/// Accepted-hardware-event recency grace: sessions/minutes persist only while input has been
/// seen within this window (avoids writing sessions for a foreground app with no real user).
const HARDWARE_GRACE_MS: i64 = 30_000;

static LAST_HARDWARE_MS: AtomicI64 = AtomicI64::new(0);

fn hardware_recent() -> bool {
    let last = LAST_HARDWARE_MS.load(Ordering::Relaxed);
    if last <= 0 {
        return false;
    }
    let now = Utc::now().timestamp_millis();
    now.saturating_sub(last) <= HARDWARE_GRACE_MS
}

#[derive(Clone)]
struct WindowSnapshot {
    pid: u32,
    app_name: String,
    title: String,
    app_id: String,
}

struct ObservedWindow {
    snapshot: WindowSnapshot,
    icon_data_url: Option<String>,
}

#[derive(Clone)]
struct SessionRecord {
    id: u64,
    snapshot: WindowSnapshot,
    started_at_ms: i64,
    ended_at_ms: i64,
    key_presses: u32,
    mouse_clicks: u32,
    scroll_events: u32,
    persistable: bool,
}

#[derive(Default, Clone)]
struct InputMinuteRecord {
    key_presses: u32,
    mouse_clicks: u32,
    mouse_moves: u32,
    scroll_events: u32,
}

struct State {
    date_today: chrono::NaiveDate,
    next_id: u64,
    current: Option<SessionRecord>,
    input_minutes: BTreeMap<u32, InputMinuteRecord>,
    dirty_minutes: HashSet<u32>,
    pending_sessions: VecDeque<(String, SessionRecord)>,
    pending_day_minutes: VecDeque<(String, Vec<db::InputMinuteRow>)>,
    last_sequence: Option<SequenceState>,
}

static STATE: OnceLock<Mutex<State>> = OnceLock::new();
static KNOWN_APP_ICONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static CHECKPOINT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
#[cfg(windows)]
static ICON_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

/// Icon extraction can return fairly large base64 strings. Keep only a small working set in
/// memory; persisted icons live once in SQLite and do not need a permanent process-wide copy.
#[cfg(any(windows, target_os = "macos"))]
const MAX_ICON_CACHE_ENTRIES: usize = 256;
/// A corrupt or adversarial stream of ever-changing application names must not grow this set
/// forever. Once full, new apps simply omit icons; activity collection continues normally.
const MAX_KNOWN_APP_ICONS: usize = 4_096;

fn minute_row(minute: u32, record: &InputMinuteRecord) -> db::InputMinuteRow {
    db::InputMinuteRow {
        minute_of_day: minute,
        key_presses: record.key_presses,
        mouse_clicks: record.mouse_clicks,
        mouse_moves: record.mouse_moves,
        scroll_events: record.scroll_events,
    }
}

fn dto_from_record(minute_of_day: u32, value: &InputMinuteRecord) -> AppInputMinuteDto {
    AppInputMinuteDto {
        minute_of_day,
        key_presses: value.key_presses,
        mouse_clicks: value.mouse_clicks,
        mouse_moves: value.mouse_moves,
        scroll_events: value.scroll_events,
    }
}

fn state() -> &'static Mutex<State> {
    STATE.get_or_init(|| {
        let mut s = State {
            date_today: Local::now().date_naive(),
            next_id: 1,
            current: None,
            input_minutes: BTreeMap::new(),
            dirty_minutes: HashSet::new(),
            pending_sessions: VecDeque::new(),
            pending_day_minutes: VecDeque::new(),
            last_sequence: None,
        };
        load_from_db(&mut s);
        Mutex::new(s)
    })
}

fn load_from_db(state: &mut State) {
    let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
    state.next_id = db::load_max_activity_session_id().saturating_add(1).max(1);
    let minutes = db::load_input_minutes_for_date(&today);
    for row in minutes {
        let e = state.input_minutes.entry(row.minute_of_day).or_default();
        e.key_presses = row.key_presses;
        e.mouse_clicks = row.mouse_clicks;
        e.mouse_moves = row.mouse_moves;
        e.scroll_events = row.scroll_events;
    }

    KNOWN_APP_ICONS.get_or_init(|| {
        Mutex::new(
            db::load_app_icon_ids(MAX_KNOWN_APP_ICONS)
                .into_iter()
                .collect(),
        )
    });
}

fn persist_app_icon_if_new(app_id: &str, icon_data_url: Option<String>) {
    let Some(icon_data_url) = icon_data_url.filter(|value| !value.is_empty()) else {
        return;
    };
    let known = KNOWN_APP_ICONS.get_or_init(|| Mutex::new(HashSet::new()));
    if known.lock().map_or(true, |icons| {
        icons.contains(app_id) || icons.len() >= MAX_KNOWN_APP_ICONS
    }) {
        return;
    }

    let saved = db::with_atomic_tx(|tx| {
        db::insert_app_icon(tx, app_id, &icon_data_url, Utc::now().timestamp_millis())
    })
    .is_some();
    if saved {
        if let Ok(mut icons) = known.lock() {
            if icons.len() < MAX_KNOWN_APP_ICONS {
                icons.insert(app_id.to_string());
            }
        }
    }
}

fn app_icon_is_known(app_id: &str) -> bool {
    KNOWN_APP_ICONS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map(|icons| icons.contains(app_id) || icons.len() >= MAX_KNOWN_APP_ICONS)
        .unwrap_or(true)
}

fn sanitize_app_id(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_dash = false;
    for ch in name.chars().flat_map(|c| c.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn same_window(a: &WindowSnapshot, b: &WindowSnapshot) -> bool {
    a.pid == b.pid && a.app_name == b.app_name && a.title == b.title
}

#[cfg(windows)]
fn get_cached_icon_data_url(path: &str) -> Option<String> {
    let cache = ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if let Ok(cache) = cache.lock() {
        if let Some(value) = cache.get(path) {
            return value.clone();
        }
    }

    let resolved = windows_icons::get_icon_base64_by_path(path)
        .ok()
        .map(|base64| format!("data:image/png;base64,{base64}"));

    if let Ok(mut cache) = cache.lock() {
        if cache.len() >= MAX_ICON_CACHE_ENTRIES && !cache.contains_key(path) {
            if let Some(oldest) = cache.keys().next().cloned() {
                cache.remove(&oldest);
            }
        }
        cache.insert(path.to_string(), resolved.clone());
    }

    resolved
}

fn is_today(ts_ms: i64) -> bool {
    chrono::DateTime::from_timestamp_millis(ts_ms)
        .map(|dt| dt.with_timezone(&Local).date_naive() == Local::now().date_naive())
        .unwrap_or(false)
}

fn minute_of_day(ts_ms: i64) -> Option<u32> {
    chrono::DateTime::from_timestamp_millis(ts_ms).map(|dt| {
        let local = dt.with_timezone(&Local);
        (local.hour() * 60 + local.minute()) as u32
    })
}

/// Returns the minute that contains (ts_ms + INACTIVITY_INTERVAL_MS).
/// Used to extend "active" into the 30s window after last activity.
fn extended_minute_of_day(ts_ms: i64) -> Option<u32> {
    minute_of_day(ts_ms.saturating_add(INACTIVITY_INTERVAL_MS))
}

const MAX_PENDING_SESSIONS: usize = 4_096;
const MAX_PENDING_DAYS: usize = 7;

fn queue_session_for_persistence(state: &mut State, date: String, session: SessionRecord) {
    if state.pending_sessions.len() >= MAX_PENDING_SESSIONS {
        state.pending_sessions.pop_front();
        warn!("activity persistence backlog full; dropping oldest completed session");
    }
    state.pending_sessions.push_back((date, session));
}

fn ensure_today(state: &mut State) {
    let today = Local::now().date_naive();
    if state.date_today != today {
        let previous_date = state.date_today.format("%Y-%m-%d").to_string();
        if let Some(mut current) = state.current.take() {
            if current.persistable {
                current.ended_at_ms = Utc::now().timestamp_millis();
                queue_session_for_persistence(state, previous_date.clone(), current);
            }
        }
        let minutes: Vec<db::InputMinuteRow> = state
            .input_minutes
            .iter()
            .map(|(minute, record)| minute_row(*minute, record))
            .collect();
        if !minutes.is_empty() {
            if state.pending_day_minutes.len() >= MAX_PENDING_DAYS {
                state.pending_day_minutes.pop_front();
                warn!("activity persistence backlog full; dropping oldest day checkpoint");
            }
            state
                .pending_day_minutes
                .push_back((previous_date, minutes));
        }
        state.date_today = today;
        state.input_minutes.clear();
        state.dirty_minutes.clear();
        state.last_sequence = None;
    }
}

fn start_session(
    state: &mut State,
    snapshot: WindowSnapshot,
    now: i64,
    persistable: bool,
) -> SessionRecord {
    let id = state.next_id;
    state.next_id += 1;
    SessionRecord {
        id,
        snapshot,
        started_at_ms: now,
        ended_at_ms: now,
        key_presses: 0,
        mouse_clicks: 0,
        scroll_events: 0,
        persistable,
    }
}

fn queue_if_persistable(
    state: &mut State,
    date: String,
    mut session: SessionRecord,
    ended_at_ms: i64,
) {
    if !session.persistable {
        return;
    }
    session.ended_at_ms = ended_at_ms.max(session.started_at_ms);
    queue_session_for_persistence(state, date, session);
}

fn hardware_end_ms(now: i64) -> i64 {
    let last = LAST_HARDWARE_MS.load(Ordering::Relaxed);
    if last > 0 {
        last.min(now)
    } else {
        now
    }
}

fn transition_snapshot(
    state: &mut State,
    now: i64,
    snapshot: Option<WindowSnapshot>,
    persist_sessions: bool,
) {
    let date = state.date_today.format("%Y-%m-%d").to_string();
    let close_at = if persist_sessions {
        now
    } else {
        hardware_end_ms(now)
    };
    match (state.current.clone(), snapshot) {
        (Some(mut current), Some(next)) if same_window(&current.snapshot, &next) => {
            if persist_sessions && !current.persistable {
                state.current = Some(start_session(state, next, now, true));
            } else if !persist_sessions && current.persistable {
                queue_if_persistable(state, date, current, close_at);
                state.current = Some(start_session(state, next, now, false));
            } else {
                current.ended_at_ms = now;
                state.current = Some(current);
            }
        }
        (Some(current), Some(next)) => {
            queue_if_persistable(state, date, current, close_at);
            state.current = Some(start_session(state, next, now, persist_sessions));
        }
        (Some(current), None) => {
            queue_if_persistable(state, date, current, close_at);
            state.current = None;
        }
        (None, Some(next)) => {
            state.current = Some(start_session(state, next, now, persist_sessions));
        }
        (None, None) => {}
    }
}

fn record_snapshot(observed: Option<ObservedWindow>) {
    let now = Utc::now().timestamp_millis();
    let persist_sessions = hardware_recent();
    let snapshot = observed.map(|observed| {
        persist_app_icon_if_new(&observed.snapshot.app_id, observed.icon_data_url);
        observed.snapshot
    });
    let Ok(mut state) = state().lock() else {
        return;
    };
    ensure_today(&mut state);
    transition_snapshot(&mut state, now, snapshot, persist_sessions);
}

/// Record an accepted hardware event. Never called for injected/remote events.
pub fn record_input_event(event: &InputMonitorEventDto) {
    LAST_HARDWARE_MS.store(event.timestamp, Ordering::Relaxed);
    let now = event.timestamp;
    let Ok(mut state) = state().lock() else {
        return;
    };
    ensure_today(&mut state);

    let minute = minute_of_day(now);
    let has_current = state.current.is_some();
    let is_sequence_continuation = input_sequence::is_continuation(state.last_sequence, event);
    if !has_current {
        return;
    }

    match (event.kind, event.action) {
        ("keyboard", "press") => {
            if let Some(current) = state.current.as_mut() {
                current.ended_at_ms = now;
                current.key_presses = current.key_presses.saturating_add(1);
            }
            if let Some(minute) = minute {
                let bucket = state.input_minutes.entry(minute).or_default();
                bucket.key_presses = bucket.key_presses.saturating_add(1);
                state.dirty_minutes.insert(minute);
            }
        }
        ("mouse", "press") => {
            if let Some(current) = state.current.as_mut() {
                current.ended_at_ms = now;
                current.mouse_clicks = current.mouse_clicks.saturating_add(1);
            }
            if let Some(minute) = minute {
                let bucket = state.input_minutes.entry(minute).or_default();
                bucket.mouse_clicks = bucket.mouse_clicks.saturating_add(1);
                state.dirty_minutes.insert(minute);
            }
        }
        ("mouse", "move") => {
            if let Some(current) = state.current.as_mut() {
                current.ended_at_ms = now;
            }
            if !is_sequence_continuation {
                if let Some(minute) = minute {
                    let bucket = state.input_minutes.entry(minute).or_default();
                    bucket.mouse_moves = bucket.mouse_moves.saturating_add(1);
                    state.dirty_minutes.insert(minute);
                }
            }
        }
        ("scroll", "wheel") => {
            if let Some(current) = state.current.as_mut() {
                current.ended_at_ms = now;
                if !is_sequence_continuation {
                    current.scroll_events = current.scroll_events.saturating_add(1);
                }
            }
            if !is_sequence_continuation {
                if let Some(minute) = minute {
                    let bucket = state.input_minutes.entry(minute).or_default();
                    bucket.scroll_events = bucket.scroll_events.saturating_add(1);
                    state.dirty_minutes.insert(minute);
                }
            }
        }
        ("scroll", _) => {
            if let Some(current) = state.current.as_mut() {
                current.ended_at_ms = now;
                current.scroll_events = current.scroll_events.saturating_add(1);
            }
            if let Some(minute) = minute {
                let bucket = state.input_minutes.entry(minute).or_default();
                bucket.scroll_events = bucket.scroll_events.saturating_add(1);
                state.dirty_minutes.insert(minute);
            }
        }
        _ => {}
    }

    // Extend "active" 30s past last activity: inactivity starts at last_activity + 30s.
    if let (Some(minute), Some(ext)) = (minute, extended_minute_of_day(now)) {
        if ext != minute && is_today(now.saturating_add(INACTIVITY_INTERVAL_MS)) {
            let bucket = state.input_minutes.entry(ext).or_default();
            bucket.mouse_moves = bucket.mouse_moves.saturating_add(1);
            state.dirty_minutes.insert(ext);
        }
    }

    state.last_sequence = Some(SequenceState::from_event(event));
}

pub fn get_input_minutes() -> Vec<AppInputMinuteDto> {
    let Ok(mut state) = state().lock() else {
        return Vec::new();
    };

    ensure_today(&mut state);

    state
        .input_minutes
        .iter()
        .map(|(minute_of_day, value)| dto_from_record(*minute_of_day, value))
        .collect()
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn start_global_app_usage_monitor<R: Runtime>(_app: AppHandle<R>) {
    warn!("global app usage monitor is only implemented on Windows and macOS");
}

#[cfg(target_os = "macos")]
pub fn start_global_app_usage_monitor<R: Runtime>(_app: AppHandle<R>) {
    let _ = state();

    // Foreground-window discovery is deliberately isolated from the input hook pipeline.
    thread::spawn(move || loop {
        let snapshot = macos_impl::get_foreground_snapshot();
        record_snapshot(snapshot);
        thread::sleep(Duration::from_millis(2000));
    });

    thread::spawn(|| loop {
        thread::sleep(Duration::from_secs(10));
        persist_checkpoint();
    });

    info!("started global app usage monitor (macOS CGWindowList)");
}

#[cfg(windows)]
pub fn start_global_app_usage_monitor<R: Runtime>(_app: AppHandle<R>) {
    let _ = state();

    thread::spawn(move || loop {
        let snapshot = unsafe { windows_impl::get_foreground_snapshot() };
        record_snapshot(snapshot);
        thread::sleep(Duration::from_millis(2000));
    });

    thread::spawn(|| loop {
        thread::sleep(Duration::from_secs(10));
        persist_checkpoint();
    });

    info!("started global app usage monitor");
}

pub(crate) fn persist_checkpoint() {
    let Ok(_checkpoint_guard) = CHECKPOINT_LOCK.get_or_init(|| Mutex::new(())).lock() else {
        return;
    };
    let persist_current = hardware_recent();
    let (current, changed_minutes, dirty_keys, date, mut pending_sessions, mut pending_day_minutes) = {
        let Ok(mut state) = state().lock() else {
            return;
        };
        ensure_today(&mut state);
        let date = state.date_today.format("%Y-%m-%d").to_string();
        let ready_keys: Vec<u32> = state.dirty_minutes.drain().collect();
        let changed_minutes: Vec<db::InputMinuteRow> = ready_keys
            .iter()
            .filter_map(|minute| {
                state
                    .input_minutes
                    .get(minute)
                    .map(|record| minute_row(*minute, record))
            })
            .collect();
        let current = state
            .current
            .clone()
            .filter(|record| record.persistable && persist_current);
        (
            current,
            changed_minutes,
            ready_keys,
            date,
            std::mem::take(&mut state.pending_sessions),
            std::mem::take(&mut state.pending_day_minutes),
        )
    };

    let saved = db::with_atomic_tx(|tx| {
        for (session_date, record) in &pending_sessions {
            db::upsert_activity_session(
                tx,
                record.id,
                session_date,
                &record.snapshot.app_id,
                &record.snapshot.app_name,
                &record.snapshot.title,
                record.snapshot.pid,
                record.started_at_ms,
                record.ended_at_ms,
                record.key_presses,
                record.mouse_clicks,
                record.scroll_events,
            )?;
        }
        for (day, minutes) in &pending_day_minutes {
            db::replace_input_minutes_for_date(tx, day, minutes)?;
        }
        if let Some(record) = &current {
            db::upsert_activity_session(
                tx,
                record.id,
                &date,
                &record.snapshot.app_id,
                &record.snapshot.app_name,
                &record.snapshot.title,
                record.snapshot.pid,
                record.started_at_ms,
                record.ended_at_ms,
                record.key_presses,
                record.mouse_clicks,
                record.scroll_events,
            )?;
        }
        db::upsert_input_minutes_for_date(tx, &date, &changed_minutes)?;
        Ok(())
    })
    .is_some();

    if !saved {
        if let Ok(mut state) = state().lock() {
            state.dirty_minutes.extend(dirty_keys);
            pending_sessions.append(&mut state.pending_sessions);
            if pending_sessions.len() > MAX_PENDING_SESSIONS {
                let excess = pending_sessions.len() - MAX_PENDING_SESSIONS;
                pending_sessions.drain(0..excess);
            }
            state.pending_sessions = pending_sessions;
            pending_day_minutes.append(&mut state.pending_day_minutes);
            if pending_day_minutes.len() > MAX_PENDING_DAYS {
                let excess = pending_day_minutes.len() - MAX_PENDING_DAYS;
                pending_day_minutes.drain(0..excess);
            }
            state.pending_day_minutes = pending_day_minutes;
        }
        warn!("failed to persist activity checkpoint");
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{sanitize_app_id, ObservedWindow, WindowSnapshot};
    use std::path::Path;
    use windows::{
        core::PWSTR,
        Win32::{
            Foundation::CloseHandle,
            System::Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
            UI::WindowsAndMessaging::{
                GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
            },
        },
    };

    fn read_window_title(hwnd: windows::Win32::Foundation::HWND) -> Option<String> {
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return None;
        }
        let mut buffer = vec![0u16; len as usize + 1];
        let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
        if copied <= 0 {
            return None;
        }
        let title = String::from_utf16_lossy(&buffer[..copied as usize]);
        let title = title.trim().to_string();
        if title.is_empty() {
            None
        } else {
            Some(title)
        }
    }

    fn read_process_info(pid: u32) -> Option<(String, String)> {
        read_process_info_public(pid)
    }

    pub fn read_process_info_public(pid: u32) -> Option<(String, String)> {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()? };
        let mut buffer = vec![0u16; 260];
        let mut size = buffer.len() as u32;
        let result = unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut size,
            )
        };
        let _ = unsafe { CloseHandle(process) };
        result.ok()?;
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        let path = path.trim().to_string();
        let stem = Path::new(&path)
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Unknown App")
            .trim()
            .to_string();
        if stem.is_empty() {
            None
        } else {
            Some((stem, path))
        }
    }

    pub unsafe fn get_foreground_snapshot() -> Option<ObservedWindow> {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }

        let (app_name, executable_path) =
            read_process_info(pid).unwrap_or_else(|| ("Unknown App".to_string(), String::new()));
        let title = read_window_title(hwnd).unwrap_or_else(|| app_name.clone());
        let app_id = sanitize_app_id(&app_name);
        let icon_data_url = if executable_path.is_empty() || super::app_icon_is_known(&app_id) {
            None
        } else {
            super::get_cached_icon_data_url(&executable_path)
        };

        Some(ObservedWindow {
            snapshot: WindowSnapshot {
                pid,
                app_name,
                title,
                app_id,
            },
            icon_data_url,
        })
    }
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::{sanitize_app_id, ObservedWindow, WindowSnapshot, MAX_ICON_CACHE_ENTRIES};
    use base64::Engine;
    use core_foundation::{
        base::{CFType, TCFType},
        dictionary::{CFDictionary, CFDictionaryRef},
        number::CFNumber,
        string::{CFString, CFStringRef},
    };
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowLayer, kCGWindowListExcludeDesktopElements,
        kCGWindowListOptionOnScreenOnly, kCGWindowName, kCGWindowOwnerName, kCGWindowOwnerPID,
    };
    use std::collections::HashMap;
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};

    /// App icons are expensive to extract (plutil + sips), so cache by bundle path.
    static ICON_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    /// Disambiguates concurrent `sips` temp files from overlapping app-usage refreshes.
    static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// Resolve a process's executable path from its PID via libproc.
    fn exe_path_for_pid(pid: u32) -> Option<PathBuf> {
        if pid == 0 {
            return None;
        }
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let ret = unsafe {
            libc::proc_pidpath(
                pid as libc::c_int,
                buf.as_mut_ptr() as *mut libc::c_void,
                buf.len() as u32,
            )
        };
        if ret <= 0 {
            return None;
        }
        buf.truncate(ret as usize);
        Some(PathBuf::from(OsStr::from_bytes(&buf)))
    }

    /// Walk up an executable path to the enclosing `.app` bundle, if any.
    fn find_app_bundle(exe: &Path) -> Option<PathBuf> {
        exe.ancestors()
            .find(|p| p.extension().and_then(|e| e.to_str()) == Some("app"))
            .map(|p| p.to_path_buf())
    }

    /// Read the icon file name declared in the bundle's Info.plist (handles both
    /// binary and XML plists via `plutil`).
    fn plist_icon_file(info_plist: &Path) -> Option<String> {
        for key in ["CFBundleIconFile", "CFBundleIconName"] {
            if let Ok(out) = Command::new("plutil")
                .args(["-extract", key, "raw", "-o", "-"])
                .arg(info_plist)
                .output()
            {
                if out.status.success() {
                    let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !value.is_empty() {
                        return Some(value);
                    }
                }
            }
        }
        None
    }

    /// Largest `.icns` in a Resources directory — fallback when Info.plist has no
    /// usable icon reference (e.g. asset-catalog-only icons).
    fn largest_icns(resources: &Path) -> Option<PathBuf> {
        let mut best: Option<(u64, PathBuf)> = None;
        for entry in std::fs::read_dir(resources).ok()?.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("icns") {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                if best.as_ref().map(|(s, _)| size > *s).unwrap_or(true) {
                    best = Some((size, path));
                }
            }
        }
        best.map(|(_, p)| p)
    }

    fn icns_path_for_bundle(bundle: &Path) -> Option<PathBuf> {
        let resources = bundle.join("Contents/Resources");
        let info_plist = bundle.join("Contents/Info.plist");
        if let Some(name) = plist_icon_file(&info_plist) {
            let direct = resources.join(&name);
            if direct.exists() {
                return Some(direct);
            }
            let with_ext = resources.join(format!("{name}.icns"));
            if with_ext.exists() {
                return Some(with_ext);
            }
        }
        largest_icns(&resources)
    }

    /// Convert an `.icns` to a 128px PNG data URL using the system `sips` tool.
    fn icns_to_png_data_url(icns: &Path) -> Option<String> {
        let tmp = std::env::temp_dir().join(format!(
            "mytime-icon-{}-{}.png",
            std::process::id(),
            TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let result = Command::new("sips")
            .args(["-s", "format", "png", "-Z", "128"])
            .arg(icns)
            .arg("--out")
            .arg(&tmp)
            .output();
        let success = matches!(result, Ok(ref o) if o.status.success());
        if !success {
            let _ = std::fs::remove_file(&tmp);
            return None;
        }
        let bytes = std::fs::read(&tmp).ok();
        let _ = std::fs::remove_file(&tmp);
        let bytes = bytes?;
        if bytes.is_empty() {
            return None;
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        Some(format!("data:image/png;base64,{encoded}"))
    }

    /// Extract an app icon for an executable path as a PNG data URL, cached by bundle.
    pub fn icon_for_exe_path(path: &str) -> Option<String> {
        let bundle = find_app_bundle(Path::new(path))?;
        let key = bundle.to_string_lossy().into_owned();

        let cache = ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(cache) = cache.lock() {
            if let Some(value) = cache.get(&key) {
                return value.clone();
            }
        }

        let resolved = icns_path_for_bundle(&bundle).and_then(|p| icns_to_png_data_url(&p));
        if let Ok(mut cache) = cache.lock() {
            if cache.len() >= MAX_ICON_CACHE_ENTRIES && !cache.contains_key(&key) {
                if let Some(oldest) = cache.keys().next().cloned() {
                    cache.remove(&oldest);
                }
            }
            cache.insert(key, resolved.clone());
        }
        resolved
    }

    fn icon_for_pid(pid: u32) -> Option<String> {
        let exe = exe_path_for_pid(pid)?;
        icon_for_exe_path(&exe.to_string_lossy())
    }

    fn dict_string(dict: &CFDictionary<CFString, CFType>, key: CFStringRef) -> Option<String> {
        let key = unsafe { CFString::wrap_under_get_rule(key) };
        let value = dict.find(&key)?;
        value.downcast::<CFString>().map(|s| s.to_string())
    }

    fn dict_i64(dict: &CFDictionary<CFString, CFType>, key: CFStringRef) -> Option<i64> {
        let key = unsafe { CFString::wrap_under_get_rule(key) };
        let value = dict.find(&key)?;
        value.downcast::<CFNumber>().and_then(|n| n.to_i64())
    }

    /// Frontmost on-screen application via the Quartz window list.
    ///
    /// The on-screen list is ordered front-to-back, so the first window on the
    /// normal application layer (layer 0) belongs to the active app. The window
    /// title (`kCGWindowName`) needs Screen Recording permission; when it is not
    /// granted we fall back to the owner (app) name, which is always available.
    pub fn get_foreground_snapshot() -> Option<ObservedWindow> {
        let info = copy_window_info(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        )?;

        for item in info.iter() {
            let dict = unsafe {
                CFDictionary::<CFString, CFType>::wrap_under_get_rule(*item as CFDictionaryRef)
            };

            if dict_i64(&dict, unsafe { kCGWindowLayer }) != Some(0) {
                continue;
            }

            let app_name = match dict_string(&dict, unsafe { kCGWindowOwnerName }) {
                Some(name) if !name.trim().is_empty() => name.trim().to_string(),
                _ => continue,
            };
            let pid = dict_i64(&dict, unsafe { kCGWindowOwnerPID }).unwrap_or(0) as u32;
            let title = dict_string(&dict, unsafe { kCGWindowName })
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| app_name.clone());
            let app_id = sanitize_app_id(&app_name);
            let icon_data_url = if super::app_icon_is_known(&app_id) {
                None
            } else {
                icon_for_pid(pid)
            };

            return Some(ObservedWindow {
                snapshot: WindowSnapshot {
                    pid,
                    app_name,
                    title,
                    app_id,
                },
                icon_data_url,
            });
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: u64) -> SessionRecord {
        SessionRecord {
            id,
            snapshot: WindowSnapshot {
                pid: 1,
                app_name: "Editor".to_string(),
                title: "Document".to_string(),
                app_id: "editor".to_string(),
            },
            started_at_ms: id as i64,
            ended_at_ms: id as i64 + 1,
            key_presses: 0,
            mouse_clicks: 0,
            scroll_events: 0,
            persistable: true,
        }
    }

    #[test]
    fn persistence_backlog_discards_oldest_instead_of_growing_forever() {
        let mut state = State {
            date_today: chrono::NaiveDate::from_ymd_opt(2026, 8, 3).unwrap(),
            next_id: 1,
            current: None,
            input_minutes: BTreeMap::new(),
            dirty_minutes: HashSet::new(),
            pending_sessions: VecDeque::new(),
            pending_day_minutes: VecDeque::new(),
            last_sequence: None,
        };

        for id in 0..(MAX_PENDING_SESSIONS as u64 + 10) {
            queue_session_for_persistence(&mut state, "2026-08-03".to_string(), session(id));
        }

        assert_eq!(state.pending_sessions.len(), MAX_PENDING_SESSIONS);
        assert_eq!(
            state.pending_sessions.front().map(|(_, value)| value.id),
            Some(10)
        );
    }
}
