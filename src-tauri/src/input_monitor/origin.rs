//! Pure native-input origin classification.
//!
//! This module deliberately contains no platform API types so the trust policy can be
//! unit-tested on every build host. Platform hooks extract their native metadata and call
//! [`is_hardware_input`] before creating an application event.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeInputOrigin {
    #[cfg(any(windows, test))]
    WindowsKeyboard { flags: u32 },
    #[cfg(any(windows, test))]
    WindowsMouse { flags: u32 },
    #[cfg(any(target_os = "macos", test))]
    MacosQuartz {
        source_state_id: i64,
        source_pid: i64,
    },
}

// KBDLLHOOKSTRUCT flags documented by Win32.
#[cfg(any(windows, test))]
const LLKHF_LOWER_IL_INJECTED: u32 = 0x02;
#[cfg(any(windows, test))]
const LLKHF_INJECTED: u32 = 0x10;

// MSLLHOOKSTRUCT flags documented by Win32.
#[cfg(any(windows, test))]
const LLMHF_INJECTED: u32 = 0x01;
#[cfg(any(windows, test))]
const LLMHF_LOWER_IL_INJECTED: u32 = 0x02;

// kCGEventSourceStateHIDSystemState from CGEventTypes.h.
#[cfg(any(target_os = "macos", test))]
const MACOS_HID_SYSTEM_STATE: i64 = 1;

/// Return `true` only when the native metadata identifies hardware-origin input.
///
/// The macOS rule is intentionally fail-closed: Quartz events must use the HID source
/// state and must not identify a user-space process as their source.
pub(crate) fn is_hardware_input(origin: NativeInputOrigin) -> bool {
    match origin {
        #[cfg(any(windows, test))]
        NativeInputOrigin::WindowsKeyboard { flags } => {
            flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED) == 0
        }
        #[cfg(any(windows, test))]
        NativeInputOrigin::WindowsMouse { flags } => {
            flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED) == 0
        }
        #[cfg(any(target_os = "macos", test))]
        NativeInputOrigin::MacosQuartz {
            source_state_id,
            source_pid,
        } => source_state_id == MACOS_HID_SYSTEM_STATE && source_pid <= 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_keyboard_accepts_hardware_and_rejects_injected_flags() {
        for flags in [0x00, 0x01, 0x20, 0x80] {
            assert!(is_hardware_input(NativeInputOrigin::WindowsKeyboard {
                flags,
            }));
        }
        assert!(!is_hardware_input(NativeInputOrigin::WindowsKeyboard {
            flags: 0x10,
        }));
        assert!(!is_hardware_input(NativeInputOrigin::WindowsKeyboard {
            flags: 0x12,
        }));
        assert!(!is_hardware_input(NativeInputOrigin::WindowsKeyboard {
            flags: 0x02,
        }));
    }

    #[test]
    fn windows_mouse_accepts_hardware_and_rejects_injected_flags() {
        assert!(is_hardware_input(NativeInputOrigin::WindowsMouse {
            flags: 0x00,
        }));
        for flags in [0x01, 0x02, 0x03] {
            assert!(!is_hardware_input(NativeInputOrigin::WindowsMouse {
                flags,
            }));
        }
    }

    #[test]
    fn macos_requires_hid_state_without_a_user_process_source() {
        for source_pid in [0, -1] {
            assert!(is_hardware_input(NativeInputOrigin::MacosQuartz {
                source_state_id: MACOS_HID_SYSTEM_STATE,
                source_pid,
            }));
        }

        for (source_state_id, source_pid) in [(0, 0), (-1, 0), (2, 0), (1, 1), (1, 42)] {
            assert!(!is_hardware_input(NativeInputOrigin::MacosQuartz {
                source_state_id,
                source_pid,
            }));
        }
    }

    #[test]
    fn rejected_input_does_not_reach_downstream_sink() {
        let origins = [
            NativeInputOrigin::WindowsKeyboard { flags: 0x10 },
            NativeInputOrigin::WindowsMouse { flags: 0x01 },
            NativeInputOrigin::MacosQuartz {
                source_state_id: 0,
                source_pid: 123,
            },
        ];
        let mut dispatched = 0;

        for origin in origins {
            if is_hardware_input(origin) {
                dispatched += 1;
            }
        }

        assert_eq!(dispatched, 0);
    }
}
