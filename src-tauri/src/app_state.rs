use std::sync::atomic::{AtomicBool, Ordering};

use chrono::{DateTime, Utc};

use crate::config::AppPaths;

pub struct AppState {
    paths: AppPaths,
    started_at: DateTime<Utc>,
    collectors_running: AtomicBool,
    backend_mode: &'static str,
}

impl AppState {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            paths,
            started_at: Utc::now(),
            collectors_running: AtomicBool::new(false),
            backend_mode: "foundation",
        }
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn started_at_rfc3339(&self) -> String {
        self.started_at.to_rfc3339()
    }

    pub fn collectors_running(&self) -> bool {
        self.collectors_running.load(Ordering::SeqCst)
    }

    pub fn backend_mode(&self) -> &'static str {
        self.backend_mode
    }
}
