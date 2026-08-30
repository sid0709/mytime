//! macOS input-monitor diagnostics (permissions + CGEventTap probe).

use super::permissions::{self, ListenAccessStatus};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    CallbackResult,
};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::{info, warn};

static DIAG_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputMonitorDiagnosticsDto {
    pub pid: u32,
    pub ppid: u32,
    pub thread_id: u64,
    pub executable_path: String,
    pub bundle_id: Option<String>,
    pub iokit_listen_raw: u32,
    pub iokit_listen_status: String,
    pub cg_preflight_listen: bool,
    pub ax_trusted: bool,
    pub effective_listen_access: bool,
    pub tap_probe_session: String,
    pub tap_probe_hid: String,
    pub hook_thread_alive: bool,
    pub tap_installed_flag: bool,
    pub events_received: u64,
    pub log_hint: String,
}

fn iokit_raw() -> u32 {
    permissions::iokit_listen_raw()
}

fn status_label(s: ListenAccessStatus) -> &'static str {
    match s {
        ListenAccessStatus::Granted => "granted",
        ListenAccessStatus::Denied => "denied",
        ListenAccessStatus::Unknown => "unknown",
    }
}

/// Try creating a tap without running a run loop (Err = permission or config failure).
pub fn probe_result_label(location: CGEventTapLocation) -> &'static str {
    probe_tap_create(location)
}

fn probe_tap_create(location: CGEventTapLocation) -> &'static str {
    match CGEventTap::new(
        location,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        vec![CGEventType::KeyDown],
        |_, _, _| CallbackResult::Keep,
    ) {
        Ok(_) => "ok (tap object created)",
        Err(()) => {
            "failed (CGEventTap::new — usually missing Input Monitoring for this executable)"
        }
    }
}

pub fn collect(
    hook_thread_alive: bool,
    tap_installed_flag: bool,
    events_received: u64,
    log_dir: &str,
) -> InputMonitorDiagnosticsDto {
    let iokit_raw = iokit_raw();
    let iokit_status = permissions::iokit_listen_status();
    let cg_preflight = permissions::cg_preflight_listen_access();
    let ax = permissions::is_accessibility_trusted();
    let effective = permissions::has_listen_event_access();

    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "unknown".into());

    let bundle_id = std::env::var("CFBundleIdentifier").ok();

    InputMonitorDiagnosticsDto {
        pid: std::process::id(),
        ppid: unsafe { libc::getppid() as u32 },
        thread_id: thread_id(),
        executable_path: exe,
        bundle_id,
        iokit_listen_raw: iokit_raw,
        iokit_listen_status: status_label(iokit_status).into(),
        cg_preflight_listen: cg_preflight,
        ax_trusted: ax,
        effective_listen_access: effective,
        tap_probe_session: probe_tap_create(CGEventTapLocation::Session).into(),
        tap_probe_hid: probe_tap_create(CGEventTapLocation::HID).into(),
        hook_thread_alive,
        tap_installed_flag,
        events_received,
        log_hint: format!(
            "Full Rust logs: {log_dir}/mytime.log.* (set RUST_LOG=mytime=debug,mytime_lib=debug)"
        ),
    }
}

pub fn log_snapshot(log_dir: &str) {
    let n = DIAG_COUNTER.fetch_add(1, Ordering::Relaxed);
    let d = collect(
        super::hook_thread_is_alive(),
        super::tap_installed(),
        super::events_received(),
        log_dir,
    );
    info!(
        diag = n,
        pid = d.pid,
        ppid = d.ppid,
        thread_id = d.thread_id,
        exe = %d.executable_path,
        bundle_id = ?d.bundle_id,
        iokit_raw = d.iokit_listen_raw,
        iokit_status = %d.iokit_listen_status,
        cg_preflight = d.cg_preflight_listen,
        ax_trusted = d.ax_trusted,
        effective_listen = d.effective_listen_access,
        tap_session = %d.tap_probe_session,
        tap_hid = %d.tap_probe_hid,
        hook_alive = d.hook_thread_alive,
        tap_flag = d.tap_installed_flag,
        events = d.events_received,
        %d.log_hint,
        "input_monitor diagnostics"
    );

    if d.effective_listen_access
        && d.tap_probe_session.starts_with("failed")
        && d.tap_probe_hid.starts_with("failed")
    {
        warn!(
            "CGPreflight/IOKit say access OK but CGEventTapCreate returned NULL — enable Input Monitoring for the exact executable_path above, then restart"
        );
    }
    if !d.effective_listen_access {
        warn!(
            iokit = %d.iokit_listen_status,
            cg_preflight = d.cg_preflight_listen,
            "listen access not effective — hook thread will not install CGEventTap"
        );
    }
}

fn thread_id() -> u64 {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let mut tid: u64 = 0;
            libc::pthread_threadid_np(libc::pthread_self(), &mut tid);
            tid
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        0
    }
}

/// Lightweight probe used before entering the run loop.
pub fn log_tap_install_attempt(location: CGEventTapLocation) {
    let label = match location {
        CGEventTapLocation::Session => "Session",
        CGEventTapLocation::HID => "HID",
        _ => "Other",
    };
    let probe = probe_tap_create(location);
    info!(
        location = label,
        tap_probe = probe,
        "CGEventTap install attempt"
    );
}
