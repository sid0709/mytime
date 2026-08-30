//! Layer 1b: reject input while this session is remote or only virtual HID is present.
//!
//! Product names are never consulted. The gate uses OS session flags, HID enumerator /
//! transport class, and optional remote-display flags. Hook callbacks only read an atomic.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tracing::{info, warn};

const SESSION_POLL_MS: u64 = 500;
const HID_POLL_EVERY: u32 = 4; // 4 * 500ms ≈ 2s

static BLOCKED: AtomicBool = AtomicBool::new(false);
static REJECTED_INJECTED: AtomicU64 = AtomicU64::new(0);
static REJECTED_REMOTE: AtomicU64 = AtomicU64::new(0);
static POLLER: OnceLock<()> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub enum HidClass {
    Physical,
    SoftwareVirtual,
    RdpStyle,
    Unknown,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RemoteSnapshot {
    pub session_remote: bool,
    pub has_physical_hid: bool,
    pub has_software_virtual_hid: bool,
    pub has_rdp_style_enumerator: bool,
    pub has_remote_display: bool,
}

pub fn is_blocked() -> bool {
    BLOCKED.load(Ordering::Relaxed)
}

pub fn rejected_injected() -> u64 {
    REJECTED_INJECTED.load(Ordering::Relaxed)
}

pub fn rejected_remote() -> u64 {
    REJECTED_REMOTE.load(Ordering::Relaxed)
}

/// Return `true` when the event should be counted. Origin-false increments injected;
/// a blocked remote session increments remote.
pub fn accept_hardware_event(is_hardware: bool) -> bool {
    if !is_hardware {
        note_rejected_injected();
        return false;
    }
    if is_blocked() {
        note_rejected_remote();
        return false;
    }
    true
}

pub fn ensure_poller() {
    POLLER.get_or_init(|| {
        apply_snapshot(&collect_snapshot());
        let _ = thread::Builder::new()
            .name("mytime-remote-gate".to_string())
            .spawn(poll_loop);
        ()
    });
}

fn note_rejected_injected() {
    let n = REJECTED_INJECTED.fetch_add(1, Ordering::Relaxed) + 1;
    if n == 1 || n.is_power_of_two() {
        warn!(rejected_injected = n, "discarding software-injected input");
    }
}

fn note_rejected_remote() {
    let n = REJECTED_REMOTE.fetch_add(1, Ordering::Relaxed) + 1;
    if n == 1 || n.is_power_of_two() {
        warn!(
            rejected_remote = n,
            "discarding input during a remote or virtual-HID session"
        );
    }
}

fn poll_loop() {
    let mut hid_ticks = 0_u32;
    let mut hid = collect_hid_snapshot();
    loop {
        thread::sleep(Duration::from_millis(SESSION_POLL_MS));
        hid_ticks = hid_ticks.saturating_add(1);
        if hid_ticks >= HID_POLL_EVERY {
            hid_ticks = 0;
            hid = collect_hid_snapshot();
        }
        let mut snapshot = collect_session_snapshot();
        snapshot.has_physical_hid = hid.has_physical_hid;
        snapshot.has_software_virtual_hid = hid.has_software_virtual_hid;
        snapshot.has_rdp_style_enumerator = hid.has_rdp_style_enumerator;
        snapshot.has_remote_display = hid.has_remote_display;
        apply_snapshot(&snapshot);
    }
}

fn apply_snapshot(snapshot: &RemoteSnapshot) {
    let blocked = should_block_input(snapshot);
    let was = BLOCKED.swap(blocked, Ordering::Relaxed);
    if blocked != was {
        info!(
            blocked,
            session_remote = snapshot.session_remote,
            has_physical_hid = snapshot.has_physical_hid,
            has_software_virtual_hid = snapshot.has_software_virtual_hid,
            has_rdp_style_enumerator = snapshot.has_rdp_style_enumerator,
            has_remote_display = snapshot.has_remote_display,
            "input remote-session gate updated"
        );
    }
}

/// Fail closed on OS-remote sessions, RDP-style enumerators, or virtual-only HID.
/// A leftover mirror adapter, even with a ROOT-enumerated HID, does not block
/// when a physical keyboard/mouse is present.
pub fn should_block_input(snapshot: &RemoteSnapshot) -> bool {
    if snapshot.session_remote {
        return true;
    }
    if snapshot.has_rdp_style_enumerator {
        return true;
    }
    if snapshot.has_software_virtual_hid && !snapshot.has_physical_hid {
        return true;
    }
    false
}

/// Classify a Raw Input / HID device path or transport string by OS taxonomy.
#[allow(dead_code)]
pub fn classify_device_path(path: &str) -> HidClass {
    let p = path.to_ascii_uppercase();
    if p.contains("RDP_MOU")
        || p.contains("RDP_KBD")
        || p.contains("TERMINPUT")
        || p.contains("TS_INPUT")
        || p.contains("RDPBUS")
    {
        return HidClass::RdpStyle;
    }
    if looks_physical(&p) {
        return HidClass::Physical;
    }
    if p.contains("VIRTUAL")
        || p.contains("ROOT#")
        || p.contains("ROOT\\")
        || p.contains("\\ROOT\\")
    {
        return HidClass::SoftwareVirtual;
    }
    HidClass::Unknown
}

#[allow(dead_code)]
fn looks_physical(p: &str) -> bool {
    p.contains("USB")
        || p.contains("BTHENUM")
        || p.contains("BTHLE")
        || p.contains("BTHHF")
        || p.contains("I2C")
        || p.contains("SPI")
        || p.contains("ACPI")
        || p.contains("PNP0")
        || p.contains("HID#VID_")
        || p.contains("HID\\VID_")
        || p == "USB"
        || p == "BLUETOOTH"
        || p == "I2C"
        || p == "SPI"
        || p == "FIFO"
        || p == "ISO"
}

fn collect_snapshot() -> RemoteSnapshot {
    let mut snapshot = collect_session_snapshot();
    let hid = collect_hid_snapshot();
    snapshot.has_physical_hid = hid.has_physical_hid;
    snapshot.has_software_virtual_hid = hid.has_software_virtual_hid;
    snapshot.has_rdp_style_enumerator = hid.has_rdp_style_enumerator;
    snapshot.has_remote_display = hid.has_remote_display;
    snapshot
}

fn collect_session_snapshot() -> RemoteSnapshot {
    RemoteSnapshot {
        session_remote: platform_session_remote(),
        ..RemoteSnapshot::default()
    }
}

fn collect_hid_snapshot() -> RemoteSnapshot {
    platform_hid_snapshot()
}

#[cfg(windows)]
fn platform_session_remote() -> bool {
    windows_impl::session_is_remote()
}

#[cfg(target_os = "macos")]
fn platform_session_remote() -> bool {
    macos_impl::session_is_remote()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn platform_session_remote() -> bool {
    false
}

#[cfg(windows)]
fn platform_hid_snapshot() -> RemoteSnapshot {
    windows_impl::hid_snapshot()
}

#[cfg(target_os = "macos")]
fn platform_hid_snapshot() -> RemoteSnapshot {
    macos_impl::hid_snapshot()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn platform_hid_snapshot() -> RemoteSnapshot {
    RemoteSnapshot::default()
}

#[cfg(windows)]
mod windows_impl {
    use super::{classify_device_path, HidClass, RemoteSnapshot};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayDevicesW, DISPLAY_DEVICEW, DISPLAY_DEVICE_MIRRORING_DRIVER,
        DISPLAY_DEVICE_REMOTE,
    };
    use windows::Win32::UI::Input::{
        GetRawInputDeviceInfoW, GetRawInputDeviceList, RAWINPUTDEVICELIST, RIDI_DEVICENAME,
        RIM_TYPEHID, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_REMOTECONTROL, SM_REMOTESESSION,
    };

    pub fn session_is_remote() -> bool {
        unsafe {
            GetSystemMetrics(SM_REMOTESESSION) != 0 || GetSystemMetrics(SM_REMOTECONTROL) != 0
        }
    }

    pub fn hid_snapshot() -> RemoteSnapshot {
        let mut snapshot = RemoteSnapshot {
            has_remote_display: remote_display_attached(),
            ..RemoteSnapshot::default()
        };
        inspect_raw_input(&mut snapshot);
        snapshot
    }

    fn inspect_raw_input(snapshot: &mut RemoteSnapshot) {
        unsafe {
            let mut count = 0_u32;
            let size = std::mem::size_of::<RAWINPUTDEVICELIST>() as u32;
            if GetRawInputDeviceList(None, &mut count, size) == u32::MAX {
                return;
            }
            if count == 0 {
                return;
            }
            let mut devices = vec![RAWINPUTDEVICELIST::default(); count as usize];
            if GetRawInputDeviceList(Some(devices.as_mut_ptr()), &mut count, size) == u32::MAX {
                return;
            }
            for device in devices.into_iter().take(count as usize) {
                if device.dwType != RIM_TYPEKEYBOARD
                    && device.dwType != RIM_TYPEMOUSE
                    && device.dwType != RIM_TYPEHID
                {
                    continue;
                }
                let mut name_chars = 0_u32;
                let _ = GetRawInputDeviceInfoW(
                    Some(device.hDevice),
                    RIDI_DEVICENAME,
                    None,
                    &mut name_chars,
                );
                if name_chars == 0 {
                    continue;
                }
                let mut buf = vec![0u16; name_chars as usize];
                let _ = GetRawInputDeviceInfoW(
                    Some(device.hDevice),
                    RIDI_DEVICENAME,
                    Some(buf.as_mut_ptr().cast()),
                    &mut name_chars,
                );
                let path = String::from_utf16_lossy(&buf)
                    .trim_end_matches('\0')
                    .to_string();
                match classify_device_path(&path) {
                    HidClass::Physical => snapshot.has_physical_hid = true,
                    HidClass::SoftwareVirtual => snapshot.has_software_virtual_hid = true,
                    HidClass::RdpStyle => snapshot.has_rdp_style_enumerator = true,
                    HidClass::Unknown => {}
                }
            }
        }
    }

    fn remote_display_attached() -> bool {
        unsafe {
            let mut adapter = DISPLAY_DEVICEW::default();
            adapter.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            let mut i = 0_u32;
            while EnumDisplayDevicesW(None, i, &mut adapter, 0).as_bool() {
                let flags = adapter.StateFlags;
                if flags.contains(DISPLAY_DEVICE_REMOTE)
                    || flags.contains(DISPLAY_DEVICE_MIRRORING_DRIVER)
                {
                    return true;
                }
                i = i.saturating_add(1);
                if i > 32 {
                    break;
                }
                adapter = DISPLAY_DEVICEW::default();
                adapter.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            }
            false
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::RemoteSnapshot;
    use core_foundation::base::CFTypeRef;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFTypeRef;
    }

    pub fn session_is_remote() -> bool {
        unsafe {
            let dict_ref = CGSessionCopyCurrentDictionary();
            if dict_ref.is_null() {
                return false;
            }
            let dict =
                CFDictionary::<CFString, CFType>::wrap_under_create_rule(dict_ref as *const _);
            let key = CFString::from_static_string("kCGSSessionOnConsoleKey");
            match dict.find(&key) {
                Some(value) => {
                    if let Some(flag) = value.downcast::<CFBoolean>() {
                        !bool::from(flag)
                    } else {
                        false
                    }
                }
                None => false,
            }
        }
    }

    pub fn hid_snapshot() -> RemoteSnapshot {
        // macOS Layer 1b is session-flag only (`kCGSSessionOnConsoleKey`).
        // HID enumerator / virtual-HID / RDP-style classification is Windows-only;
        // this snapshot stays empty so those bits never gate a Mac session.
        RemoteSnapshot::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_physical_session_is_accepted() {
        assert!(!should_block_input(&RemoteSnapshot {
            session_remote: false,
            has_physical_hid: true,
            has_software_virtual_hid: false,
            has_rdp_style_enumerator: false,
            has_remote_display: false,
        }));
    }

    #[test]
    fn rdp_session_flag_blocks() {
        assert!(should_block_input(&RemoteSnapshot {
            session_remote: true,
            has_physical_hid: true,
            ..RemoteSnapshot::default()
        }));
    }

    #[test]
    fn rdp_style_enumerator_blocks() {
        assert!(should_block_input(&RemoteSnapshot {
            has_rdp_style_enumerator: true,
            has_physical_hid: true,
            ..RemoteSnapshot::default()
        }));
    }

    #[test]
    fn virtual_only_hid_blocks() {
        assert!(should_block_input(&RemoteSnapshot {
            has_software_virtual_hid: true,
            has_physical_hid: false,
            ..RemoteSnapshot::default()
        }));
    }

    #[test]
    fn leftover_mirror_adapter_alone_does_not_block() {
        assert!(!should_block_input(&RemoteSnapshot {
            has_remote_display: true,
            has_physical_hid: true,
            has_software_virtual_hid: false,
            ..RemoteSnapshot::default()
        }));
    }

    #[test]
    fn remote_display_plus_virtual_hid_does_not_block_when_physical_present() {
        assert!(!should_block_input(&RemoteSnapshot {
            has_remote_display: true,
            has_software_virtual_hid: true,
            has_physical_hid: true,
            ..RemoteSnapshot::default()
        }));
    }

    #[test]
    fn usb_and_hid_vid_paths_are_physical() {
        assert_eq!(
            classify_device_path(r"\\?\HID#VID_046D&PID_C52B#6&1#{378de44c}"),
            HidClass::Physical
        );
        assert_eq!(
            classify_device_path(r"\\?\ACPI#PNP0303#4&123#{884b96c3}"),
            HidClass::Physical
        );
        assert_eq!(classify_device_path("USB"), HidClass::Physical);
        assert_eq!(classify_device_path("Bluetooth"), HidClass::Physical);
        assert_eq!(classify_device_path("I2C"), HidClass::Physical);
    }

    #[test]
    fn rdp_enumerators_are_rdp_style() {
        assert_eq!(
            classify_device_path(r"\\?\Root#RDP_MOU#0000#{378de44c-56ef-11d1-bc8c-00a0c91405dd}"),
            HidClass::RdpStyle
        );
        assert_eq!(
            classify_device_path(r"\\?\Root#RDP_KBD#0000#{884b96c3}"),
            HidClass::RdpStyle
        );
    }

    #[test]
    fn software_root_virtual_is_virtual() {
        assert_eq!(
            classify_device_path(r"\\?\Root#SYSTEM#0000#{378de44c}"),
            HidClass::SoftwareVirtual
        );
        assert_eq!(classify_device_path("Virtual"), HidClass::SoftwareVirtual);
    }

    #[test]
    fn unknown_paths_do_not_block_by_themselves() {
        let class = classify_device_path(r"\\?\SOME#ODD#DEVICE");
        assert_eq!(class, HidClass::Unknown);
        assert!(!should_block_input(&RemoteSnapshot {
            has_physical_hid: false,
            has_software_virtual_hid: false,
            has_rdp_style_enumerator: false,
            ..RemoteSnapshot::default()
        }));
    }
}
