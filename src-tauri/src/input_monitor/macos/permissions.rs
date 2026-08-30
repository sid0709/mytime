//! macOS permissions for global input monitoring.
//!
//! **Input Monitoring** uses IOKit `IOHIDRequestAccess` (shows the system dialog) and/or
//! `CGPreflightListenEventAccess`. Accessibility is separate and used for some event APIs.

use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use std::ffi::c_void;
use tracing::{info, warn};

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListenAccessStatus {
    Granted,
    Denied,
    Unknown,
}

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOHIDCheckAccess(request_type: u32) -> u32;
    fn IOHIDRequestAccess(request_type: u32) -> bool;
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
}

const K_IOHID_REQUEST_TYPE_LISTEN_EVENT: u32 = 1;
const K_IOHID_ACCESS_TYPE_GRANTED: u32 = 0;
const K_IOHID_ACCESS_TYPE_DENIED: u32 = 1;

pub fn iokit_listen_raw() -> u32 {
    unsafe { IOHIDCheckAccess(K_IOHID_REQUEST_TYPE_LISTEN_EVENT) }
}

pub fn iokit_listen_status() -> ListenAccessStatus {
    match iokit_listen_raw() {
        K_IOHID_ACCESS_TYPE_GRANTED => ListenAccessStatus::Granted,
        K_IOHID_ACCESS_TYPE_DENIED => ListenAccessStatus::Denied,
        _ => ListenAccessStatus::Unknown,
    }
}

/// Triggers the macOS **Input Monitoring** permission dialog when status is unknown.
pub fn request_iokit_listen_access() -> bool {
    unsafe { IOHIDRequestAccess(K_IOHID_REQUEST_TYPE_LISTEN_EVENT) }
}

/// Whether `CGEventTapCreate` is allowed for this process (authoritative for the hook).
pub fn cg_preflight_listen_access() -> bool {
    unsafe { CGPreflightListenEventAccess() }
}

/// Gate for installing CGEventTap — uses CoreGraphics preflight (required for tap creation).
pub fn has_listen_event_access() -> bool {
    let cg = cg_preflight_listen_access();
    let iokit = iokit_listen_status();
    if !cg && iokit == ListenAccessStatus::Granted {
        warn!(
            ?iokit,
            "IOKit reports granted but CGPreflightListenEventAccess is false — enable this binary under Input Monitoring and restart"
        );
    }
    if cg && iokit == ListenAccessStatus::Denied {
        warn!(
            ?iokit,
            "CGPreflight true while IOKit denied — unusual; trusting CG preflight for tap install"
        );
    }
    cg
}

pub fn request_listen_event_access() -> bool {
    if iokit_listen_status() == ListenAccessStatus::Granted {
        return true;
    }

    if iokit_listen_status() == ListenAccessStatus::Unknown {
        let granted = request_iokit_listen_access();
        info!(granted, "IOHIDRequestAccess(ListenEvent) completed");
        if granted || iokit_listen_status() == ListenAccessStatus::Granted {
            return true;
        }
    }

    unsafe { CGRequestListenEventAccess() }
}

pub fn is_accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

pub fn request_accessibility_trust(prompt: bool) -> bool {
    if is_accessibility_trusted() {
        return true;
    }
    if !prompt {
        return false;
    }
    let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
    let value = CFBoolean::true_value();
    let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
    unsafe { AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef() as *const c_void) }
}

pub fn has_input_monitoring_permission() -> bool {
    has_listen_event_access()
}

/// Request Input Monitoring + optional Accessibility prompt. Call from the **main thread** at launch.
pub fn request_input_monitoring_permission() -> bool {
    if has_listen_event_access() {
        return true;
    }
    let listen = request_listen_event_access();
    let _ax = request_accessibility_trust(true);
    listen || has_listen_event_access()
}

pub fn prompt_all_at_launch() -> bool {
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "unknown".into());

    let before = iokit_listen_status();
    info!(%exe, ?before, cg_preflight = unsafe { CGPreflightListenEventAccess() }, "macOS permission state before request");

    let granted = request_input_monitoring_permission();

    let after = iokit_listen_status();
    info!(
        %exe,
        ?after,
        granted,
        cg_preflight = unsafe { CGPreflightListenEventAccess() },
        ax_trusted = is_accessibility_trusted(),
        "macOS permission state after request"
    );

    granted
}
