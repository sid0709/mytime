//! macOS global input monitoring via Quartz CGEventTap.

pub mod diagnostics;
mod permissions;

use super::origin::{is_hardware_input, NativeInputOrigin};
use super::shared::{capitalize, emit_event, make_event, LAST_MOVE_TICK, LAST_MOVE_X, LAST_MOVE_Y};
use core_foundation::runloop::CFRunLoop;
use core_graphics::event::{
    CGEvent, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventTapProxy, CGEventType, CallbackResult, EventField,
};
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{error, info, warn};

static EVENTS_RECEIVED: AtomicU64 = AtomicU64::new(0);
static TAP_INSTALLED: AtomicBool = AtomicBool::new(false);
static HOOK_THREAD_ALIVE: AtomicBool = AtomicBool::new(false);
static LOG_DIR: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn set_log_dir(path: std::path::PathBuf) {
    let _ = LOG_DIR.set(path.display().to_string());
}

pub fn hook_thread_is_alive() -> bool {
    HOOK_THREAD_ALIVE.load(Ordering::Relaxed)
}

pub fn diagnostics_snapshot(log_dir: &str) -> diagnostics::InputMonitorDiagnosticsDto {
    diagnostics::collect(
        hook_thread_is_alive(),
        tap_installed(),
        events_received(),
        log_dir,
    )
}

pub fn events_received() -> u64 {
    EVENTS_RECEIVED.load(Ordering::Relaxed)
}

pub fn tap_installed() -> bool {
    TAP_INSTALLED.load(Ordering::Relaxed)
}

pub fn has_listen_permission() -> bool {
    permissions::has_input_monitoring_permission()
}

pub fn request_listen_permission() -> bool {
    permissions::request_input_monitoring_permission()
}

pub fn prompt_permissions_at_launch() -> bool {
    permissions::prompt_all_at_launch()
}

pub fn open_privacy_settings() {
    const URLS: &[&str] = &[
        "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent",
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
    ];
    for url in URLS {
        if std::process::Command::new("open").arg(url).spawn().is_ok() {
            return;
        }
    }
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapEnable(tap: CGEventTapProxy, enable: bool);
}

/// Block until the event tap exits. Retries when Input Monitoring is missing or the tap fails.
pub fn run_global_hook_loop() -> Result<(), HookInstallError> {
    super::remote::ensure_poller();
    HOOK_THREAD_ALIVE.store(true, Ordering::Relaxed);
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "MyTime".into());
    let log_dir = LOG_DIR
        .get()
        .map(String::as_str)
        .unwrap_or("(log dir not set)");

    TAP_INSTALLED.store(false, Ordering::Relaxed);
    diagnostics::log_snapshot(log_dir);
    let mut wait_cycles: u32 = 0;

    loop {
        if !permissions::has_listen_event_access() {
            TAP_INSTALLED.store(false, Ordering::Relaxed);
            wait_cycles += 1;
            if wait_cycles == 1 || wait_cycles % 10 == 0 {
                diagnostics::log_snapshot(log_dir);
            }
            warn!(
                %exe,
                wait_cycles,
                iokit = ?permissions::iokit_listen_status(),
                iokit_raw = permissions::iokit_listen_raw(),
                cg_preflight = permissions::cg_preflight_listen_access(),
                ax = permissions::is_accessibility_trusted(),
                "Input Monitoring not granted for CGEventTap — enable this executable in System Settings"
            );
            std::thread::sleep(Duration::from_secs(3));
            continue;
        }

        wait_cycles = 0;
        diagnostics::log_snapshot(log_dir);
        info!(%exe, "installing CGEventTap (CGPreflightListenEventAccess=true)");
        match run_event_tap_once() {
            Ok(()) => {
                TAP_INSTALLED.store(false, Ordering::Relaxed);
                return Ok(());
            }
            Err(error) => {
                TAP_INSTALLED.store(false, Ordering::Relaxed);
                error!(%error, %exe, "CGEventTap failed; retrying in 5s");
                std::thread::sleep(Duration::from_secs(5));
            }
        }
    }
}

fn run_event_tap_once() -> Result<(), HookInstallError> {
    // Do NOT include TapDisabledBy* here — their discriminants are ~0xFFFF_FFFF and
    // break CGEventMask construction (shift overflow). macOS still delivers them to the callback.
    let event_types = vec![
        CGEventType::KeyDown,
        CGEventType::KeyUp,
        CGEventType::LeftMouseDown,
        CGEventType::LeftMouseUp,
        CGEventType::RightMouseDown,
        CGEventType::RightMouseUp,
        CGEventType::OtherMouseDown,
        CGEventType::OtherMouseUp,
        CGEventType::MouseMoved,
        CGEventType::ScrollWheel,
    ];

    for location in [CGEventTapLocation::HID, CGEventTapLocation::Session] {
        diagnostics::log_tap_install_attempt(location);
        let result = CGEventTap::with_enabled(
            location,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            event_types.clone(),
            |proxy, event_type, event| {
                handle_event(proxy, event_type, event);
                CallbackResult::Keep
            },
            CFRunLoop::run_current,
        );

        match result {
            Ok(()) => {
                info!(?location, "CGEventTap run loop exited normally");
                return Ok(());
            }
            Err(()) => {
                warn!(
                    ?location,
                    tap_probe = diagnostics::probe_result_label(location),
                    "CGEventTap::with_enabled failed for location"
                );
            }
        }
    }

    Err(HookInstallError::EventTap)
}

fn handle_event(proxy: CGEventTapProxy, event_type: CGEventType, event: &CGEvent) {
    match event_type {
        CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput => {
            unsafe {
                CGEventTapEnable(proxy, true);
            }
            return;
        }
        _ => {}
    }

    if !TAP_INSTALLED.load(Ordering::Relaxed) {
        TAP_INSTALLED.store(true, Ordering::Relaxed);
        let n = EVENTS_RECEIVED.load(Ordering::Relaxed);
        info!(
            events = n,
            ?event_type,
            "CGEventTap first callback — tap is live"
        );
    }

    if !super::remote::accept_hardware_event(event_has_hardware_origin(event)) {
        return;
    }

    let total = EVENTS_RECEIVED.load(Ordering::Relaxed);
    if total > 0 && total % 500 == 0 {
        info!(total, "CGEventTap event count milestone");
    }

    match event_type {
        CGEventType::KeyDown => emit_keyboard("press", event),
        CGEventType::KeyUp => emit_keyboard("release", event),
        CGEventType::LeftMouseDown => emit_mouse_button("press", "left", "Left Click", event),
        CGEventType::LeftMouseUp => emit_mouse_button("release", "left", "Left Release", event),
        CGEventType::RightMouseDown => emit_mouse_button("press", "right", "Right Click", event),
        CGEventType::RightMouseUp => emit_mouse_button("release", "right", "Right Release", event),
        CGEventType::OtherMouseDown => emit_mouse_button("press", "middle", "Middle Click", event),
        CGEventType::OtherMouseUp => {
            emit_mouse_button("release", "middle", "Middle Release", event)
        }
        CGEventType::MouseMoved => emit_mouse_move(event),
        CGEventType::ScrollWheel => emit_scroll(event),
        _ => {}
    }
}

fn event_has_hardware_origin(event: &CGEvent) -> bool {
    let source_state_id = event.get_integer_value_field(EventField::EVENT_SOURCE_STATE_ID);
    let source_pid = event.get_integer_value_field(EventField::EVENT_SOURCE_UNIX_PROCESS_ID);
    is_hardware_input(NativeInputOrigin::MacosQuartz {
        source_state_id,
        source_pid,
    })
}

fn record_event() {
    EVENTS_RECEIVED.fetch_add(1, Ordering::Relaxed);
}

fn emit_keyboard(action: &'static str, event: &CGEvent) {
    if event.get_integer_value_field(EventField::KEYBOARD_EVENT_AUTOREPEAT) != 0 {
        return;
    }

    let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;
    if let Some((state_key, key_name)) = map_keyboard_key(keycode) {
        record_event();
        emit_event(make_event(
            "keyboard",
            action,
            format!("{} {}", capitalize(action), key_name),
            Some(state_key.to_string()),
            None,
            None,
            None,
            None,
        ));
    }
}

fn emit_mouse_button(action: &'static str, button: &'static str, label: &str, event: &CGEvent) {
    record_event();
    let loc = event.location();
    let kind = if button == "middle" {
        "scroll"
    } else {
        "mouse"
    };
    emit_event(make_event(
        kind,
        action,
        label.to_string(),
        None,
        Some(button),
        None,
        Some(loc.x as i32),
        Some(loc.y as i32),
    ));
}

fn emit_mouse_move(event: &CGEvent) {
    let loc = event.location();
    let x = loc.x as i32;
    let y = loc.y as i32;
    let tick = now_millis();
    let last_tick = LAST_MOVE_TICK.load(Ordering::Relaxed);
    let last_x = LAST_MOVE_X.load(Ordering::Relaxed);
    let last_y = LAST_MOVE_Y.load(Ordering::Relaxed);
    let moved_enough = last_x == i32::MIN || (x - last_x).abs() + (y - last_y).abs() >= 18;

    if moved_enough && tick.saturating_sub(last_tick) >= 180 {
        LAST_MOVE_TICK.store(tick, Ordering::Relaxed);
        LAST_MOVE_X.store(x, Ordering::Relaxed);
        LAST_MOVE_Y.store(y, Ordering::Relaxed);

        record_event();
        emit_event(make_event(
            "mouse",
            "move",
            format!("Move {x}, {y}"),
            None,
            None,
            None,
            Some(x),
            Some(y),
        ));
    }
}

fn emit_scroll(event: &CGEvent) {
    let loc = event.location();
    let line_delta =
        event.get_integer_value_field(EventField::SCROLL_WHEEL_EVENT_POINT_DELTA_AXIS_1);
    let pixel_delta = event.get_integer_value_field(EventField::SCROLL_WHEEL_EVENT_DELTA_AXIS_1);
    let delta = if line_delta != 0 {
        line_delta
    } else {
        pixel_delta
    };
    if delta == 0 {
        return;
    }

    let direction = if delta > 0 { "up" } else { "down" };
    record_event();
    emit_event(make_event(
        "scroll",
        "wheel",
        if direction == "up" {
            "Scroll Up".to_string()
        } else {
            "Scroll Down".to_string()
        },
        None,
        None,
        Some(direction),
        Some(loc.x as i32),
        Some(loc.y as i32),
    ));
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Map macOS virtual key codes (HIToolbox kVK_*) to UI state keys.
fn map_keyboard_key(keycode: u16) -> Option<(&'static str, &'static str)> {
    match keycode {
        0x00 => Some(("A", "A")),
        0x01 => Some(("S", "S")),
        0x02 => Some(("D", "D")),
        0x03 => Some(("F", "F")),
        0x04 => Some(("H", "H")),
        0x05 => Some(("G", "G")),
        0x06 => Some(("Z", "Z")),
        0x07 => Some(("X", "X")),
        0x08 => Some(("C", "C")),
        0x09 => Some(("V", "V")),
        0x0A => Some(("B", "B")),
        0x0B => Some(("Q", "Q")),
        0x0C => Some(("W", "W")),
        0x0D => Some(("E", "E")),
        0x0E => Some(("R", "R")),
        0x0F => Some(("Y", "Y")),
        0x10 => Some(("T", "T")),
        0x11 => Some(("1", "1")),
        0x12 => Some(("2", "2")),
        0x13 => Some(("3", "3")),
        0x14 => Some(("4", "4")),
        0x15 => Some(("6", "6")),
        0x16 => Some(("5", "5")),
        0x17 => Some(("=", "=")),
        0x18 => Some(("9", "9")),
        0x19 => Some(("7", "7")),
        0x1A => Some(("-", "-")),
        0x1B => Some(("8", "8")),
        0x1C => Some(("0", "0")),
        0x1D => Some(("]", "]")),
        0x1E => Some(("O", "O")),
        0x1F => Some(("U", "U")),
        0x20 => Some(("[", "[")),
        0x21 => Some(("I", "I")),
        0x22 => Some(("P", "P")),
        0x23 => Some(("L", "L")),
        0x25 => Some(("J", "J")),
        0x26 => Some(("'", "'")),
        0x27 => Some(("K", "K")),
        0x28 => Some((";", ";")),
        0x29 => Some(("\\", "\\")),
        0x2A => Some((",", ",")),
        0x2B => Some(("/", "/")),
        0x2C => Some(("N", "N")),
        0x2D => Some(("M", "M")),
        0x2E => Some((".", ".")),
        0x2F => Some(("`", "`")),
        0x24 => Some(("return", "Return")),
        0x30 => Some(("tab", "Tab")),
        0x31 => Some(("space", "Space")),
        0x33 => Some(("nav_del", "Delete")),
        0x35 => Some(("esc", "Esc")),
        0x37 => Some(("command", "Left Meta")),
        0x38 => Some(("shift", "Left Shift")),
        0x39 => Some(("caps", "Caps Lock")),
        0x3A => Some(("option", "Left Alt")),
        0x3B => Some(("control", "Ctrl")),
        0x3C => Some(("shift2", "Right Shift")),
        0x3D => Some(("option2", "Right Alt")),
        0x3E => Some(("control", "Right Ctrl")),
        0x41 => Some(("np.", "Numpad .")),
        0x43 => Some(("np*", "Numpad *")),
        0x45 => Some(("np+", "Numpad +")),
        0x4B => Some(("np/", "Numpad /")),
        0x4C => Some(("np_enter", "Numpad Enter")),
        0x4E => Some(("np-", "Numpad -")),
        0x52 => Some(("np0", "Numpad 0")),
        0x53 => Some(("np1", "Numpad 1")),
        0x54 => Some(("np2", "Numpad 2")),
        0x55 => Some(("np3", "Numpad 3")),
        0x56 => Some(("np4", "Numpad 4")),
        0x57 => Some(("np5", "Numpad 5")),
        0x58 => Some(("np6", "Numpad 6")),
        0x59 => Some(("np7", "Numpad 7")),
        0x5A => Some(("np8", "Numpad 8")),
        0x5B => Some(("np9", "Numpad 9")),
        0x5D => Some(("command2", "Right Meta")),
        0x72 => Some(("insert", "Insert")),
        0x73 => Some(("home", "Home")),
        0x74 => Some(("pgup", "Page Up")),
        0x75 => Some(("delete", "Backspace")),
        0x77 => Some(("end", "End")),
        0x78 => Some(("F2", "F2")),
        0x79 => Some(("pgdn", "Page Down")),
        0x7A => Some(("F1", "F1")),
        0x7B => Some(("left", "Arrow Left")),
        0x7C => Some(("right", "Arrow Right")),
        0x7D => Some(("down", "Arrow Down")),
        0x7E => Some(("up", "Arrow Up")),
        0x90 => Some(("F5", "F5")),
        0x91 => Some(("F6", "F6")),
        0x92 => Some(("F7", "F7")),
        0x93 => Some(("F8", "F8")),
        0x94 => Some(("F9", "F9")),
        0x95 => Some(("F10", "F10")),
        0x96 => Some(("F11", "F11")),
        0x97 => Some(("F12", "F12")),
        _ => None,
    }
}

#[derive(Debug)]
pub enum HookInstallError {
    EventTap,
}

impl fmt::Display for HookInstallError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EventTap => write!(
                f,
                "failed to install CGEventTap — grant Input Monitoring for MyTime in System Settings"
            ),
        }
    }
}

impl std::error::Error for HookInstallError {}
