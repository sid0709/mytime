use std::{fs, io, path::PathBuf};

use tauri::{AppHandle, Manager, Runtime};

#[derive(Clone, Debug)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub db_path: PathBuf,
}

impl AppPaths {
    pub fn resolve<R: Runtime>(app: &AppHandle<R>) -> io::Result<Self> {
        let data_dir = app.path().app_data_dir().map_err(|error| {
            io::Error::new(
                io::ErrorKind::Other,
                format!("failed to resolve app data directory: {error}"),
            )
        })?;
        let log_dir = data_dir.join("logs");
        let db_path = data_dir.join("mytime.sqlite3");

        fs::create_dir_all(&data_dir)?;
        fs::create_dir_all(&log_dir)?;

        Ok(Self {
            data_dir,
            log_dir,
            db_path,
        })
    }
}
