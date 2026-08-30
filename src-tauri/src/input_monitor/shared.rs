//! Shared event pipeline used by Windows and macOS platform hooks.
//!
//! Input events are recorded into bounded in-memory aggregates the instant they arrive, but the
//! push to the WebView is **coalesced into batches** (see [`start_emitter`]). Emitting one
//! IPC message per raw event floods the WebView bridge — on Windows this can crash WebView2,
//! on macOS it shows up as UI jank — so instead we drain accumulated events on a short timer
//! and emit them as a single array. Batches are dropped entirely while the window is hidden.

use super::InputMonitorEventDto;
use chrono::Utc;
use std::sync::{
    atomic::{AtomicI32, AtomicU64, Ordering},
    mpsc::{self, RecvTimeoutError, SyncSender, TrySendError},
    OnceLock,
};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tracing::{error, info, warn};

/// Batched input events delivered to the WebView (`InputMonitorEventDto[]`).
pub(crate) const INPUT_MONITOR_BATCH_EVENT: &str = "input-monitor://batch";

/// Max latency before a non-empty batch is flushed to the UI (~12 dispatches/sec).
const BATCH_FLUSH_MS: u64 = 80;
/// Flush early once a batch reaches this size, to bound per-message payloads.
const MAX_BATCH: usize = 64;
/// Absorbs short consumer stalls without allowing hook traffic to grow memory indefinitely.
pub(crate) const EVENT_CHANNEL_CAPACITY: usize = 2_048;

pub(crate) static EVENT_SENDER: OnceLock<SyncSender<InputMonitorEventDto>> = OnceLock::new();
static DROPPED_EVENTS: AtomicU64 = AtomicU64::new(0);
pub(crate) static LAST_MOVE_TICK: AtomicU64 = AtomicU64::new(0);
pub(crate) static LAST_MOVE_X: AtomicI32 = AtomicI32::new(i32::MIN);
pub(crate) static LAST_MOVE_Y: AtomicI32 = AtomicI32::new(i32::MIN);

/// Push a coalesced batch to the WebView, but only while the main window is visible.
///
/// Stats are already recorded by the time we get here, so when the window is hidden
/// (e.g. minimized to tray) we simply drop the batch instead of pressuring the bridge.
fn emit_batch_if_window_visible<R: Runtime>(app: &AppHandle<R>, batch: Vec<InputMonitorEventDto>) {
    if batch.is_empty() {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(false) = window.is_visible() {
            return;
        }
    }
    if let Err(error) = app.emit(INPUT_MONITOR_BATCH_EVENT, batch) {
        error!(?error, "failed to emit input monitor batch");
    }
}

pub(crate) fn emit_event(event: InputMonitorEventDto) {
    if let Some(sender) = EVENT_SENDER.get() {
        match sender.try_send(event) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                let dropped = DROPPED_EVENTS.fetch_add(1, Ordering::Relaxed) + 1;
                if dropped == 1 || dropped.is_power_of_two() {
                    warn!(
                        dropped,
                        "input pipeline saturated; dropping event to stay bounded"
                    );
                }
            }
            Err(TrySendError::Disconnected(_)) => {
                error!("input monitor event consumer disconnected");
            }
        }
    }
}

pub(crate) fn make_event(
    kind: &'static str,
    action: &'static str,
    label: String,
    state_key: Option<String>,
    button: Option<&'static str>,
    direction: Option<&'static str>,
    x: Option<i32>,
    y: Option<i32>,
) -> InputMonitorEventDto {
    InputMonitorEventDto {
        kind,
        action,
        label,
        state_key,
        button,
        direction,
        x,
        y,
        timestamp: Utc::now().timestamp_millis(),
    }
}

/// Wire the event channel and start the coalescing consumer thread.
///
/// The consumer records every event into aggregates the moment it arrives, then buffers
/// it and flushes batches to the WebView either every [`BATCH_FLUSH_MS`] or once [`MAX_BATCH`]
/// events accumulate. Both the in-process hook and the Windows helper feed this one channel.
pub(crate) fn start_emitter<R: Runtime>(app: AppHandle<R>) {
    let (tx, rx) = mpsc::sync_channel::<InputMonitorEventDto>(EVENT_CHANNEL_CAPACITY);

    if EVENT_SENDER.set(tx).is_err() {
        warn!("global input monitor already initialized");
        return;
    }

    info!("global input monitor: event channel ready");

    thread::spawn(move || {
        info!("global input monitor: emitter thread started");
        let mut batch: Vec<InputMonitorEventDto> = Vec::new();
        loop {
            match rx.recv_timeout(Duration::from_millis(BATCH_FLUSH_MS)) {
                Ok(event) => {
                    crate::quality_live::note_event(&event);
                    crate::input_aggregator::record(&event);
                    if !crate::quality_live::skip_activity_persist() {
                        crate::app_usage_monitor::record_input_event(&event);
                    }
                    batch.push(event);
                    if batch.len() >= MAX_BATCH {
                        emit_batch_if_window_visible(&app, std::mem::take(&mut batch));
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !batch.is_empty() {
                        emit_batch_if_window_visible(&app, std::mem::take(&mut batch));
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if !batch.is_empty() {
                        emit_batch_if_window_visible(&app, std::mem::take(&mut batch));
                    }
                    break;
                }
            }
        }
        info!("global input monitor: emitter thread exited");
    });
}

/// Wire the channel + coalescing consumer, then run `hook_loop` on a dedicated thread.
pub(crate) fn start_inprocess<R, F, E>(app: AppHandle<R>, hook_loop: F)
where
    R: Runtime,
    F: FnOnce() -> Result<(), E> + Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    start_emitter(app);

    thread::spawn(move || {
        info!("global input monitor: hook thread started");
        if let Err(error) = hook_loop() {
            error!(%error, "global input monitor stopped unexpectedly");
        }
        info!("global input monitor: hook thread exited");
    });
}

pub(crate) fn capitalize(value: &str) -> &'static str {
    match value {
        "press" => "Press",
        "release" => "Release",
        "move" => "Move",
        "wheel" => "Scroll",
        _ => "Event",
    }
}
