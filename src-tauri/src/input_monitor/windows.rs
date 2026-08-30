//! Windows global input monitoring via low-level WH_KEYBOARD_LL / WH_MOUSE_LL hooks.

use super::shared::{
    self, capitalize, emit_event, make_event, EVENT_CHANNEL_CAPACITY, EVENT_SENDER, LAST_MOVE_TICK,
    LAST_MOVE_X, LAST_MOVE_Y,
};
use super::{
    origin::{is_hardware_input, NativeInputOrigin},
    HelperDatagram, HelperInputMonitorEventDto, HelperStatusDto, InputMonitorEventDto,
    INPUT_HOOK_HELPER_ARG,
};
use std::{
    fmt,
    net::UdpSocket,
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Runtime};
use tracing::{error, info, warn};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    System::SystemInformation::GetTickCount64,
    UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PeekMessageW, SetWindowsHookExW,
        TranslateMessage, UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT,
        PM_NOREMOVE, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN,
        WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDOWN,
        WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    },
};

struct TrackedHelper {
    child: Child,
    spawned_at: Instant,
}

static HELPER_CHILD: OnceLock<Mutex<Option<TrackedHelper>>> = OnceLock::new();
static HELPER_DISABLED: AtomicBool = AtomicBool::new(false);
static HELPER_STATUS_SEEN: AtomicBool = AtomicBool::new(false);
static HELPER_REJECTED_INJECTED: AtomicU64 = AtomicU64::new(0);
static HELPER_REJECTED_REMOTE: AtomicU64 = AtomicU64::new(0);
static HELPER_REMOTE_ACTIVE: AtomicBool = AtomicBool::new(false);

const HELPER_STATUS_INTERVAL: Duration = Duration::from_secs(1);

/// Max helper deaths within [`HELPER_RESTART_WINDOW`] before we fall back to in-process hooks.
const HELPER_RESTART_THRESHOLD: usize = 3;
/// External kills (AV / job / session) fall back sooner — restart storms are worse than in-process.
const HELPER_EXTERNAL_KILL_THRESHOLD: usize = 2;
const HELPER_RESTART_WINDOW: Duration = Duration::from_secs(15);
const HELPER_MIN_LIFETIME: Duration = Duration::from_millis(500);
const HELPER_BACKOFF_MAX: Duration = Duration::from_secs(8);
/// Windows exit status commonly seen when a process is force-terminated (console close / job kill / AV).
const HELPER_EXIT_EXTERNAL_TERMINATION: u32 = 0x4001_0004;

pub fn start<R: Runtime>(app: AppHandle<R>) {
    if HELPER_DISABLED.load(Ordering::SeqCst) {
        start_inprocess(app);
        return;
    }

    if let Err(error) = start_helper_input_monitor(app.clone()) {
        warn!(
            ?error,
            "failed to start helper input monitor, falling back to in-process hook"
        );
        fallback_to_inprocess(app, "helper failed to start");
        return;
    }

    info!("started global input monitor via helper process");
}

fn start_inprocess<R: Runtime>(app: AppHandle<R>) {
    super::remote::ensure_poller();
    shared::start_inprocess(app, || unsafe { run_global_hook_loop() });
    info!("started global input monitor");
}

pub(crate) fn apply_helper_status(
    rejected_injected: u64,
    rejected_remote: u64,
    remote_session_active: bool,
) {
    HELPER_REJECTED_INJECTED.store(rejected_injected, Ordering::Relaxed);
    HELPER_REJECTED_REMOTE.store(rejected_remote, Ordering::Relaxed);
    HELPER_REMOTE_ACTIVE.store(remote_session_active, Ordering::Relaxed);
    HELPER_STATUS_SEEN.store(true, Ordering::Relaxed);
}

pub(crate) fn monitor_gate_status() -> (bool, u64, u64) {
    if HELPER_STATUS_SEEN.load(Ordering::Relaxed) && !HELPER_DISABLED.load(Ordering::SeqCst) {
        (
            HELPER_REMOTE_ACTIVE.load(Ordering::Relaxed),
            HELPER_REJECTED_INJECTED.load(Ordering::Relaxed),
            HELPER_REJECTED_REMOTE.load(Ordering::Relaxed),
        )
    } else {
        (
            super::remote::is_blocked(),
            super::remote::rejected_injected(),
            super::remote::rejected_remote(),
        )
    }
}

fn fallback_to_inprocess<R: Runtime>(app: AppHandle<R>, reason: &str) {
    if HELPER_DISABLED.swap(true, Ordering::SeqCst) {
        return;
    }
    error!(%reason, "falling back to in-process input hooks");
    start_inprocess(app);
}

fn helper_exit_code(status: Option<ExitStatus>) -> Option<u32> {
    status
        .and_then(|status| status.code())
        .map(|code| code as u32)
}

fn helper_exit_reason(code: Option<u32>) -> &'static str {
    match code {
        Some(HELPER_EXIT_EXTERNAL_TERMINATION) => {
            "external termination (0x40010004 — AV/job/session kill)"
        }
        Some(0) => "clean exit",
        Some(_) => "nonzero exit",
        None => "unknown exit",
    }
}

fn helper_backoff(death_index: usize) -> Duration {
    let secs = 1u64 << death_index.min(3);
    Duration::from_secs(secs).min(HELPER_BACKOFF_MAX)
}

/// Spawn the out-of-process input hook helper, connected back to `port`.
fn spawn_helper_child(port: u16) -> Result<TrackedHelper, String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let child = Command::new(std::env::current_exe().map_err(|error| error.to_string())?)
        .arg(INPUT_HOOK_HELPER_ARG)
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| error.to_string())?;

    assign_child_to_job_object(&child)?;

    Ok(TrackedHelper {
        child,
        spawned_at: Instant::now(),
    })
}

/// Tie the helper's lifetime to this process (kills helper when the app exits).
fn assign_child_to_job_object(child: &Child) -> Result<(), String> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    struct JobHandle(HANDLE);
    // Job object handles are thread-safe to use; the windows crate does not mark HANDLE as Send/Sync.
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    static JOB: OnceLock<JobHandle> = OnceLock::new();

    let job = JOB
        .get_or_init(|| unsafe {
            let job = CreateJobObjectW(None, None).expect("CreateJobObjectW");
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .expect("SetInformationJobObject");
            JobHandle(job)
        })
        .0;

    unsafe {
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, child.id())
            .map_err(|error| error.to_string())?;
        AssignProcessToJobObject(job, process).map_err(|error| error.to_string())?;
        let _ = CloseHandle(process);
    }

    Ok(())
}

fn start_helper_input_monitor<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let socket = UdpSocket::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = socket
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    let child = spawn_helper_child(port)?;

    let store = HELPER_CHILD.get_or_init(|| Mutex::new(None));
    if let Ok(mut slot) = store.lock() {
        *slot = Some(child);
    } else {
        return Err("failed to store helper child".to_string());
    }

    // Single coalescing consumer; received events flow through the same pipeline as the
    // in-process hook (recorded + batched to the WebView).
    let watchdog_app = app.clone();
    shared::start_emitter(app);

    // Receiver: decode datagrams from the helper and queue them for the emitter.
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match socket.recv_from(&mut buffer) {
                Ok((len, _)) => match serde_json::from_slice::<HelperDatagram>(&buffer[..len]) {
                    Ok(HelperDatagram::Event { event }) => {
                        match InputMonitorEventDto::try_from(event) {
                            Ok(event) => emit_event(event),
                            Err(error) => error!(%error, "failed to map helper input event"),
                        }
                    }
                    Ok(HelperDatagram::Status { status }) => {
                        apply_helper_status(
                            status.rejected_injected,
                            status.rejected_remote,
                            status.remote_session_active,
                        );
                    }
                    Err(error) => error!(?error, "failed to decode helper datagram"),
                },
                Err(error) => {
                    error!(?error, "input monitor helper socket receive failed");
                    break;
                }
            }
        }
    });

    // Watchdog: respawn a transient helper death, but fail over quickly when the helper is
    // being externally killed (common AV/job exit 0x40010004). Endless 1s respawn storms can
    // destabilize the main app / WebView more than running hooks in-process.
    thread::spawn(move || {
        let mut recent_deaths: Vec<Instant> = Vec::new();
        let mut recent_external_kills: Vec<Instant> = Vec::new();
        let mut consecutive_failures: usize = 0;

        loop {
            if HELPER_DISABLED.load(Ordering::SeqCst) {
                break;
            }

            let tracked = HELPER_CHILD
                .get()
                .and_then(|store| store.lock().ok().and_then(|mut slot| slot.take()));

            let Some(mut tracked) = tracked else {
                // A previous respawn may have failed. Retry with backoff, then fall back.
                consecutive_failures = consecutive_failures.saturating_add(1);
                if consecutive_failures >= HELPER_RESTART_THRESHOLD {
                    fallback_to_inprocess(
                        watchdog_app.clone(),
                        "helper missing from slot after repeated spawn failures",
                    );
                    break;
                }
                let delay = helper_backoff(consecutive_failures.saturating_sub(1));
                match spawn_helper_child(port) {
                    Ok(new_child) => {
                        if let Some(store) = HELPER_CHILD.get() {
                            if let Ok(mut slot) = store.lock() {
                                *slot = Some(new_child);
                                info!(?delay, "input hook helper recovered after spawn failure");
                            }
                        }
                        consecutive_failures = 0;
                        thread::sleep(delay);
                    }
                    Err(error) => {
                        error!(%error, ?delay, "input hook helper respawn retry failed");
                        thread::sleep(delay.max(Duration::from_secs(2)));
                    }
                }
                continue;
            };

            let status = tracked.child.wait().ok();
            let lifetime = tracked.spawned_at.elapsed();
            let exit_code = helper_exit_code(status);
            let exit_reason = helper_exit_reason(exit_code);
            let externally_killed = exit_code == Some(HELPER_EXIT_EXTERNAL_TERMINATION);
            let died_quickly = lifetime < HELPER_MIN_LIFETIME;

            if HELPER_DISABLED.load(Ordering::SeqCst) {
                break;
            }

            let now = Instant::now();
            recent_deaths.push(now);
            recent_deaths.retain(|instant| instant.elapsed() < HELPER_RESTART_WINDOW);
            if externally_killed {
                recent_external_kills.push(now);
                recent_external_kills.retain(|instant| instant.elapsed() < HELPER_RESTART_WINDOW);
            }

            warn!(
                ?status,
                exit_code,
                exit_reason,
                ?lifetime,
                died_quickly,
                externally_killed,
                deaths = recent_deaths.len(),
                external_kills = recent_external_kills.len(),
                "input hook helper exited"
            );

            let should_fallback = recent_deaths.len() >= HELPER_RESTART_THRESHOLD
                || recent_external_kills.len() >= HELPER_EXTERNAL_KILL_THRESHOLD
                || (died_quickly && recent_deaths.len() >= HELPER_EXTERNAL_KILL_THRESHOLD);

            if should_fallback {
                fallback_to_inprocess(
                    watchdog_app.clone(),
                    &format!(
                        "helper unstable (deaths={}, external_kills={}, last={})",
                        recent_deaths.len(),
                        recent_external_kills.len(),
                        exit_reason
                    ),
                );
                break;
            }

            // A long healthy run means the next death is a fresh incident, not a storm.
            if lifetime >= Duration::from_secs(30) {
                consecutive_failures = 0;
            }
            consecutive_failures = consecutive_failures.saturating_add(1);
            let delay = helper_backoff(consecutive_failures.saturating_sub(1));
            thread::sleep(delay);
            if HELPER_DISABLED.load(Ordering::SeqCst) {
                break;
            }

            match spawn_helper_child(port) {
                Ok(new_child) => {
                    if let Some(store) = HELPER_CHILD.get() {
                        if let Ok(mut slot) = store.lock() {
                            *slot = Some(new_child);
                        }
                    }
                    info!(?delay, "input hook helper restarted");
                }
                Err(error) => {
                    error!(%error, "failed to restart input hook helper");
                    thread::sleep(Duration::from_secs(2));
                }
            }
        }
    });

    Ok(())
}

pub fn run_input_hook_helper(port: u16) -> Result<(), String> {
    let socket = UdpSocket::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    socket
        .connect(("127.0.0.1", port))
        .map_err(|error| error.to_string())?;
    let status_socket = socket.try_clone().map_err(|error| error.to_string())?;

    let (tx, rx) = mpsc::sync_channel::<InputMonitorEventDto>(EVENT_CHANNEL_CAPACITY);
    if EVENT_SENDER.set(tx).is_err() {
        return Err("input monitor helper already initialized".to_string());
    }

    thread::spawn(move || {
        super::remote::ensure_poller();
        loop {
            let payload = HelperDatagram::Status {
                status: HelperStatusDto {
                    rejected_injected: super::remote::rejected_injected(),
                    rejected_remote: super::remote::rejected_remote(),
                    remote_session_active: super::remote::is_blocked(),
                },
            };
            match serde_json::to_vec(&payload) {
                Ok(bytes) => {
                    if let Err(error) = status_socket.send(&bytes) {
                        error!(?error, "failed to forward helper input status");
                        break;
                    }
                }
                Err(error) => error!(?error, "failed to serialize helper input status"),
            }
            thread::sleep(HELPER_STATUS_INTERVAL);
        }
    });

    thread::spawn(move || {
        for event in rx {
            match serde_json::to_vec(&HelperDatagram::Event {
                event: HelperInputMonitorEventDto::from(event),
            }) {
                Ok(payload) => {
                    if let Err(error) = socket.send(&payload) {
                        error!(?error, "failed to forward helper input event");
                    }
                }
                Err(error) => {
                    error!(?error, "failed to serialize helper input event");
                }
            }
        }
    });

    unsafe { run_global_hook_loop().map_err(|error| error.to_string()) }
}

pub unsafe fn run_global_hook_loop() -> Result<(), HookInstallError> {
    super::remote::ensure_poller();
    // WH_KEYBOARD_LL / WH_MOUSE_LL require a message queue on the installing thread.
    // A headless helper subprocess does not get one automatically.
    let mut priming = MSG::default();
    let _ = PeekMessageW(&mut priming, None, 0, 0, PM_NOREMOVE);

    let keyboard_hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0)
        .map_err(HookInstallError::KeyboardHook)?;
    let mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0)
        .map_err(HookInstallError::MouseHook)?;

    let mut message = MSG::default();
    loop {
        let result = GetMessageW(&mut message, None, 0, 0);
        if result.0 == 0 {
            break;
        }
        if result.0 == -1 {
            return Err(HookInstallError::MessagePump(
                windows::core::Error::from_win32(),
            ));
        }
        let _ = TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    let _ = UnhookWindowsHookEx(keyboard_hook);
    let _ = UnhookWindowsHookEx(mouse_hook);

    Ok(())
}

unsafe extern "system" fn keyboard_proc(code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let keyboard = *(l_param.0 as *const KBDLLHOOKSTRUCT);

        if !super::remote::accept_hardware_event(is_hardware_input(
            NativeInputOrigin::WindowsKeyboard {
                flags: keyboard.flags.0,
            },
        )) {
            return CallNextHookEx(None, code, w_param, l_param);
        }

        let message = w_param.0 as u32;

        let action = match message {
            WM_KEYDOWN | WM_SYSKEYDOWN => Some("press"),
            WM_KEYUP | WM_SYSKEYUP => Some("release"),
            _ => None,
        };

        if let Some(action) = action {
            if let Some((state_key, key_name)) = map_keyboard_key(&keyboard) {
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
    }

    CallNextHookEx(None, code, w_param, l_param)
}

unsafe extern "system" fn mouse_proc(code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let mouse = *(l_param.0 as *const MSLLHOOKSTRUCT);

        if !super::remote::accept_hardware_event(is_hardware_input(
            NativeInputOrigin::WindowsMouse { flags: mouse.flags },
        )) {
            return CallNextHookEx(None, code, w_param, l_param);
        }

        let message = w_param.0 as u32;

        match message {
            WM_LBUTTONDOWN => emit_event(make_event(
                "mouse",
                "press",
                "Left Click".to_string(),
                None,
                Some("left"),
                None,
                Some(mouse.pt.x),
                Some(mouse.pt.y),
            )),
            WM_LBUTTONUP => emit_event(make_event(
                "mouse",
                "release",
                "Left Release".to_string(),
                None,
                Some("left"),
                None,
                Some(mouse.pt.x),
                Some(mouse.pt.y),
            )),
            WM_RBUTTONDOWN => emit_event(make_event(
                "mouse",
                "press",
                "Right Click".to_string(),
                None,
                Some("right"),
                None,
                Some(mouse.pt.x),
                Some(mouse.pt.y),
            )),
            WM_RBUTTONUP => emit_event(make_event(
                "mouse",
                "release",
                "Right Release".to_string(),
                None,
                Some("right"),
                None,
                Some(mouse.pt.x),
                Some(mouse.pt.y),
            )),
            WM_MBUTTONDOWN => emit_event(make_event(
                "scroll",
                "press",
                "Middle Click".to_string(),
                None,
                Some("middle"),
                None,
                Some(mouse.pt.x),
                Some(mouse.pt.y),
            )),
            WM_MBUTTONUP => emit_event(make_event(
                "scroll",
                "release",
                "Middle Release".to_string(),
                None,
                Some("middle"),
                None,
                Some(mouse.pt.x),
                Some(mouse.pt.y),
            )),
            WM_MOUSEWHEEL => {
                let wheel_delta = ((mouse.mouseData >> 16) & 0xffff) as i16;
                let direction = if wheel_delta > 0 { "up" } else { "down" };
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
                    Some(mouse.pt.x),
                    Some(mouse.pt.y),
                ));
            }
            WM_MOUSEMOVE => {
                use std::sync::atomic::Ordering;

                let tick = GetTickCount64();
                let last_tick = LAST_MOVE_TICK.load(Ordering::Relaxed);
                let last_x = LAST_MOVE_X.load(Ordering::Relaxed);
                let last_y = LAST_MOVE_Y.load(Ordering::Relaxed);
                let moved_enough = last_x == i32::MIN
                    || (mouse.pt.x - last_x).abs() + (mouse.pt.y - last_y).abs() >= 18;

                if moved_enough && tick.saturating_sub(last_tick) >= 180 {
                    LAST_MOVE_TICK.store(tick, Ordering::Relaxed);
                    LAST_MOVE_X.store(mouse.pt.x, Ordering::Relaxed);
                    LAST_MOVE_Y.store(mouse.pt.y, Ordering::Relaxed);

                    emit_event(make_event(
                        "mouse",
                        "move",
                        format!("Move {}, {}", mouse.pt.x, mouse.pt.y),
                        None,
                        None,
                        None,
                        Some(mouse.pt.x),
                        Some(mouse.pt.y),
                    ));
                }
            }
            _ => {}
        }
    }

    CallNextHookEx(None, code, w_param, l_param)
}

fn map_keyboard_key(keyboard: &KBDLLHOOKSTRUCT) -> Option<(&'static str, &'static str)> {
    let vk_code = keyboard.vkCode;
    let scan_code = keyboard.scanCode;

    match vk_code {
        0x08 => Some(("delete", "Backspace")),
        0x09 => Some(("tab", "Tab")),
        0x0D => Some(("return", "Return")),
        0x10 => {
            if scan_code == 0x36 {
                Some(("shift2", "Right Shift"))
            } else {
                Some(("shift", "Left Shift"))
            }
        }
        0x11 => Some(("control", "Ctrl")),
        0x12 => {
            if keyboard.flags.0 & 0x01 != 0 {
                Some(("option2", "Right Alt"))
            } else {
                Some(("option", "Left Alt"))
            }
        }
        0x14 => Some(("caps", "Caps Lock")),
        0x1B => Some(("esc", "Esc")),
        0x20 => Some(("space", "Space")),
        0x21 => Some(("pgup", "Page Up")),
        0x22 => Some(("pgdn", "Page Down")),
        0x23 => Some(("end", "End")),
        0x24 => Some(("home", "Home")),
        0x25 => Some(("left", "Arrow Left")),
        0x26 => Some(("up", "Arrow Up")),
        0x27 => Some(("right", "Arrow Right")),
        0x28 => Some(("down", "Arrow Down")),
        0x2D => Some(("insert", "Insert")),
        0x2E => Some(("nav_del", "Delete")),
        0x5B => Some(("command", "Left Meta")),
        0x5C => Some(("command2", "Right Meta")),
        0x60 => Some(("np0", "Numpad 0")),
        0x61 => Some(("np1", "Numpad 1")),
        0x62 => Some(("np2", "Numpad 2")),
        0x63 => Some(("np3", "Numpad 3")),
        0x64 => Some(("np4", "Numpad 4")),
        0x65 => Some(("np5", "Numpad 5")),
        0x66 => Some(("np6", "Numpad 6")),
        0x67 => Some(("np7", "Numpad 7")),
        0x68 => Some(("np8", "Numpad 8")),
        0x69 => Some(("np9", "Numpad 9")),
        0x6A => Some(("np*", "Numpad *")),
        0x6B => Some(("np+", "Numpad +")),
        0x6D => Some(("np-", "Numpad -")),
        0x6E => Some(("np.", "Numpad .")),
        0x6F => Some(("np/", "Numpad /")),
        0x70 => Some(("F1", "F1")),
        0x71 => Some(("F2", "F2")),
        0x72 => Some(("F3", "F3")),
        0x73 => Some(("F4", "F4")),
        0x74 => Some(("F5", "F5")),
        0x75 => Some(("F6", "F6")),
        0x76 => Some(("F7", "F7")),
        0x77 => Some(("F8", "F8")),
        0x78 => Some(("F9", "F9")),
        0x79 => Some(("F10", "F10")),
        0x7A => Some(("F11", "F11")),
        0x7B => Some(("F12", "F12")),
        0x90 => Some(("numlock", "Num Lock")),
        0xA0 => Some(("shift", "Left Shift")),
        0xA1 => Some(("shift2", "Right Shift")),
        0xA2 => Some(("control", "Left Ctrl")),
        0xA3 => Some(("control", "Right Ctrl")),
        0xA4 => Some(("option", "Left Alt")),
        0xA5 => Some(("option2", "Right Alt")),
        0xBA => Some((";", ";")),
        0xBB => Some(("=", "=")),
        0xBC => Some((",", ",")),
        0xBD => Some(("-", "-")),
        0xBE => Some((".", ".")),
        0xBF => Some(("/", "/")),
        0xC0 => Some(("`", "`")),
        0xDB => Some(("[", "[")),
        0xDC => Some(("\\", "\\")),
        0xDD => Some(("]", "]")),
        0xDE => Some(("'", "'")),
        value if (0x30..=0x39).contains(&value) => {
            let digit = char::from_u32(value)?;
            let text = match digit {
                '0' => "0",
                '1' => "1",
                '2' => "2",
                '3' => "3",
                '4' => "4",
                '5' => "5",
                '6' => "6",
                '7' => "7",
                '8' => "8",
                '9' => "9",
                _ => return None,
            };
            Some((text, text))
        }
        value if (0x41..=0x5A).contains(&value) => {
            let text = match value {
                0x41 => "A",
                0x42 => "B",
                0x43 => "C",
                0x44 => "D",
                0x45 => "E",
                0x46 => "F",
                0x47 => "G",
                0x48 => "H",
                0x49 => "I",
                0x4A => "J",
                0x4B => "K",
                0x4C => "L",
                0x4D => "M",
                0x4E => "N",
                0x4F => "O",
                0x50 => "P",
                0x51 => "Q",
                0x52 => "R",
                0x53 => "S",
                0x54 => "T",
                0x55 => "U",
                0x56 => "V",
                0x57 => "W",
                0x58 => "X",
                0x59 => "Y",
                0x5A => "Z",
                _ => return None,
            };
            Some((text, text))
        }
        _ => None,
    }
}

#[derive(Debug)]
pub enum HookInstallError {
    KeyboardHook(windows::core::Error),
    MouseHook(windows::core::Error),
    MessagePump(windows::core::Error),
}

impl fmt::Display for HookInstallError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::KeyboardHook(error) => write!(f, "failed to install keyboard hook: {error}"),
            Self::MouseHook(error) => write!(f, "failed to install mouse hook: {error}"),
            Self::MessagePump(error) => write!(f, "input hook message pump failed: {error}"),
        }
    }
}

impl std::error::Error for HookInstallError {}
