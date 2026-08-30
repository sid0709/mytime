// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args().skip(1);
    if let Some(arg) = args.next() {
        if arg == "--mytime-input-hook-helper" {
            let port = args
                .next()
                .and_then(|value| value.parse::<u16>().ok())
                .expect("missing input hook helper port");
            if let Err(error) = mytime_lib::run_input_hook_helper(port) {
                panic!("failed to run input hook helper: {error}");
            }
            return;
        }
    }

    // Single-instance enforcement (focus existing window on a second launch) is handled
    // cross-platform by tauri-plugin-single-instance inside `run()`.
    mytime_lib::run();
}
