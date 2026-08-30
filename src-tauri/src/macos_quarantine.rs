use std::path::{Path, PathBuf};

/// Walk up from an executable path to the enclosing `.app` bundle.
pub(crate) fn enclosing_app_bundle(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|candidate| {
            candidate
                .extension()
                .is_some_and(|extension| extension == "app")
        })
        .map(Path::to_path_buf)
}

/// Clear the Gatekeeper quarantine flag on this app bundle.
///
/// Must run from the still-alive process after an in-app update replaces the
/// bundle, and before relaunch. Otherwise macOS treats the new files as
/// damaged because they were downloaded from the internet without notarization.
pub fn clear_current_app_quarantine() -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        let Some(app) = enclosing_app_bundle(&exe) else {
            return Ok(());
        };
        let status = std::process::Command::new("/usr/bin/xattr")
            .args(["-cr"])
            .arg(&app)
            .status()
            .map_err(|error| format!("failed to run xattr: {error}"))?;
        if !status.success() {
            return Err(format!(
                "xattr -cr {} failed with status {status}",
                app.display()
            ));
        }
        tracing::info!(app = %app.display(), "cleared macOS quarantine attribute");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::enclosing_app_bundle;
    use std::path::{Path, PathBuf};

    #[test]
    fn finds_enclosing_app_bundle() {
        let exe = PathBuf::from("/Applications/MyTime.app/Contents/MacOS/mytime");
        assert_eq!(
            enclosing_app_bundle(&exe).as_deref(),
            Some(Path::new("/Applications/MyTime.app"))
        );
    }

    #[test]
    fn ignores_bare_binaries() {
        assert_eq!(
            enclosing_app_bundle(Path::new("/usr/local/bin/mytime")),
            None
        );
    }
}
