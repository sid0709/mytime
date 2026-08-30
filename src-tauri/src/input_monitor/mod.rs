//! Global keyboard and mouse monitoring for activity tracking.
//!
//! Platform-specific hooks live in separate modules, selected with `cfg(target_os = ...)`:
//! - [`windows`]: low-level `WH_KEYBOARD_LL` / `WH_MOUSE_LL` (optional out-of-process helper)
//! - [`macos`]: Quartz `CGEventTap` at HID level

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
#[cfg(target_os = "macos")]
use tracing::info;
#[cfg(not(any(windows, target_os = "macos")))]
use tracing::warn;

#[cfg(any(windows, target_os = "macos"))]
mod shared;

#[cfg(any(windows, target_os = "macos", test))]
mod origin;

mod remote;

#[cfg(windows)]
mod windows;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::diagnostics::InputMonitorDiagnosticsDto;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputMonitorEventDto {
    pub kind: &'static str,
    pub action: &'static str,
    pub label: String,
    pub state_key: Option<String>,
    pub button: Option<&'static str>,
    pub direction: Option<&'static str>,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperInputMonitorEventDto {
    kind: String,
    action: String,
    label: String,
    state_key: Option<String>,
    button: Option<String>,
    direction: Option<String>,
    x: Option<i32>,
    y: Option<i32>,
    timestamp: i64,
}

impl From<InputMonitorEventDto> for HelperInputMonitorEventDto {
    fn from(value: InputMonitorEventDto) -> Self {
        Self {
            kind: value.kind.to_string(),
            action: value.action.to_string(),
            label: value.label,
            state_key: value.state_key,
            button: value.button.map(str::to_string),
            direction: value.direction.map(str::to_string),
            x: value.x,
            y: value.y,
            timestamp: value.timestamp,
        }
    }
}

#[cfg(windows)]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperStatusDto {
    rejected_injected: u64,
    rejected_remote: u64,
    remote_session_active: bool,
}

#[cfg(windows)]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "packet", rename_all = "camelCase")]
enum HelperDatagram {
    Event {
        #[serde(flatten)]
        event: HelperInputMonitorEventDto,
    },
    Status {
        #[serde(flatten)]
        status: HelperStatusDto,
    },
}

impl TryFrom<HelperInputMonitorEventDto> for InputMonitorEventDto {
    type Error = String;

    fn try_from(value: HelperInputMonitorEventDto) -> Result<Self, Self::Error> {
        fn map_static(input: &str) -> Result<&'static str, String> {
            match input {
                "keyboard" => Ok("keyboard"),
                "mouse" => Ok("mouse"),
                "scroll" => Ok("scroll"),
                "press" => Ok("press"),
                "release" => Ok("release"),
                "move" => Ok("move"),
                "wheel" => Ok("wheel"),
                "left" => Ok("left"),
                "right" => Ok("right"),
                "middle" => Ok("middle"),
                "up" => Ok("up"),
                "down" => Ok("down"),
                other => Err(format!("unexpected helper input token: {other}")),
            }
        }

        Ok(Self {
            kind: map_static(&value.kind)?,
            action: map_static(&value.action)?,
            label: value.label,
            state_key: value.state_key,
            button: match value.button {
                Some(button) => Some(map_static(&button)?),
                None => None,
            },
            direction: match value.direction {
                Some(direction) => Some(map_static(&direction)?),
                None => None,
            },
            x: value.x,
            y: value.y,
            timestamp: value.timestamp,
        })
    }
}

#[cfg(windows)]
pub(crate) const INPUT_HOOK_HELPER_ARG: &str = "--mytime-input-hook-helper";

#[cfg(not(any(windows, target_os = "macos")))]
pub fn start_global_input_monitor<R: Runtime>(_app: AppHandle<R>) {
    warn!("global input monitor is only implemented on Windows and macOS");
}

#[cfg(windows)]
pub fn start_global_input_monitor<R: Runtime>(app: AppHandle<R>) {
    crate::input_aggregator::init();
    windows::start(app);
}

#[cfg(target_os = "macos")]
pub fn prompt_macos_permissions_at_launch() -> bool {
    macos::prompt_permissions_at_launch()
}

#[cfg(target_os = "macos")]
pub fn set_macos_log_dir(log_dir: std::path::PathBuf) {
    macos::set_log_dir(log_dir);
}

#[cfg(not(target_os = "macos"))]
pub fn set_macos_log_dir(_log_dir: std::path::PathBuf) {}

#[cfg(target_os = "macos")]
pub fn get_monitor_diagnostics(log_dir: &str) -> InputMonitorDiagnosticsDto {
    macos::diagnostics_snapshot(log_dir)
}

#[cfg(target_os = "macos")]
pub fn start_global_input_monitor<R: Runtime>(app: AppHandle<R>) {
    remote::ensure_poller();
    crate::input_aggregator::init();
    shared::start_inprocess(app, macos::run_global_hook_loop);
    info!("started global input monitor thread (macOS CGEventTap)");
}

#[cfg(not(target_os = "macos"))]
pub fn prompt_macos_permissions_at_launch() -> bool {
    true
}

#[cfg(target_os = "macos")]
pub fn get_monitor_status() -> crate::models::InputMonitorStatusDto {
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "unknown".into());
    let listen = macos::has_listen_permission();
    let tap = macos::tap_installed();
    let events = macos::events_received();
    let message = if !listen {
        "Click Request permission to show the macOS Input Monitoring dialog, or enable this app under System Settings > Privacy & Security > Input Monitoring, then restart MyTime.".into()
    } else if !tap && events == 0 {
        format!("Waiting for events. If nothing appears, toggle Input Monitoring for:\n{exe}")
    } else {
        "Global input monitoring is active.".into()
    };
    crate::models::InputMonitorStatusDto {
        listen_event_access: listen,
        tap_installed: tap,
        events_received: events,
        executable_path: exe,
        message: if remote::is_blocked() {
            "Remote or virtual-HID session detected; input is not counted until the local console is active.".into()
        } else {
            message
        },
        remote_session_active: remote::is_blocked(),
        rejected_injected: remote::rejected_injected(),
        rejected_remote: remote::rejected_remote(),
    }
}

#[cfg(windows)]
pub fn get_monitor_status() -> crate::models::InputMonitorStatusDto {
    let (blocked, rejected_injected, rejected_remote) = windows::monitor_gate_status();
    crate::models::InputMonitorStatusDto {
        listen_event_access: true,
        tap_installed: true,
        events_received: 0,
        executable_path: String::new(),
        message: if blocked {
            "Remote or virtual-HID session detected; input is not counted until the local console is active.".into()
        } else {
            "Input monitoring is active.".into()
        },
        remote_session_active: blocked,
        rejected_injected,
        rejected_remote,
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn get_monitor_status() -> crate::models::InputMonitorStatusDto {
    crate::models::InputMonitorStatusDto {
        listen_event_access: true,
        tap_installed: true,
        events_received: 0,
        executable_path: String::new(),
        message: if remote::is_blocked() {
            "Remote or virtual-HID session detected; input is not counted until the local console is active.".into()
        } else {
            "Input monitoring is active.".into()
        },
        remote_session_active: remote::is_blocked(),
        rejected_injected: remote::rejected_injected(),
        rejected_remote: remote::rejected_remote(),
    }
}

#[cfg(target_os = "macos")]
pub fn open_input_monitor_settings() {
    macos::open_privacy_settings();
}

#[cfg(not(target_os = "macos"))]
pub fn open_input_monitor_settings() {}

#[cfg(target_os = "macos")]
pub fn request_input_monitor_permission() -> bool {
    macos::request_listen_permission()
}

#[cfg(not(target_os = "macos"))]
pub fn request_input_monitor_permission() -> bool {
    true
}

#[cfg(windows)]
pub fn run_input_hook_helper(port: u16) -> Result<(), String> {
    windows::run_input_hook_helper(port)
}

#[cfg(not(windows))]
pub fn run_input_hook_helper(_port: u16) -> Result<(), String> {
    Err("input hook helper is only implemented on Windows".to_string())
}
