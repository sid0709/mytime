//! Register the app to run at Windows startup (once per install).

#[cfg(windows)]
use std::env;
#[cfg(windows)]
use tracing::info;

const STARTUP_CONFIG_KEY: &str = "startup_registered";
const RUN_KEY_PATH: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/// Registry value name for this app (must be unique per app).
const APP_REGISTRY_NAME: &str = "MyTime";

/// Registers the app to start at Windows login if not already registered.
/// Uses the `config` table to remember that we've done this once; no re-registration.
pub fn register_once() {
    #[cfg(not(windows))]
    {
        let _ = STARTUP_CONFIG_KEY;
        let _ = RUN_KEY_PATH;
        let _ = APP_REGISTRY_NAME;
        return;
    }

    #[cfg(windows)]
    {
        if crate::db::get_config(STARTUP_CONFIG_KEY).as_deref() == Some("1") {
            return;
        }

        let exe_path = match env::current_exe() {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(?e, "startup: could not get current exe path");
                return;
            }
        };
        let exe_str = exe_path.to_string_lossy().to_string();

        if let Err(e) = add_to_run_key(APP_REGISTRY_NAME, &exe_str) {
            tracing::warn!(?e, "startup: failed to add to Run key");
            return;
        }

        crate::db::set_config(STARTUP_CONFIG_KEY, "1");
        info!("registered app for Windows startup (Run key)");
    }
}

#[cfg(windows)]
fn add_to_run_key(name: &str, value: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use std::io::Error;
    use windows_registry::*;

    let key = CURRENT_USER
        .options()
        .read()
        .write()
        .open(RUN_KEY_PATH)
        .map_err(|e| Error::new(std::io::ErrorKind::Other, e))?;
    key.set_string(name, value)
        .map_err(|e| Error::new(std::io::ErrorKind::Other, e))?;
    Ok(())
}
