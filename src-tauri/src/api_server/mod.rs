pub mod config;
pub mod handlers;
mod query;
pub mod routes;

use std::sync::Mutex;

use tauri::AppHandle;
use tokio::sync::oneshot;
use tracing::{error, info};

use crate::models::{ApiServerSettingsDto, SetApiServerSettingsDto};

pub use config::{build_settings_dto, load_config, save_config, ApiServerConfig};

struct ServerTask {
    shutdown_tx: Option<oneshot::Sender<()>>,
}

static SERVER_TASK: std::sync::OnceLock<Mutex<Option<ServerTask>>> = std::sync::OnceLock::new();

fn server_task() -> &'static Mutex<Option<ServerTask>> {
    SERVER_TASK.get_or_init(|| Mutex::new(None))
}

pub fn start(app: AppHandle) {
    let config = load_config();
    if config.enabled {
        spawn_server(app, config);
    } else {
        config::set_runtime_status(false, None, None);
        info!("api server disabled in config");
    }
}

pub fn restart(app: AppHandle) {
    stop();
    let config = load_config();
    if config.enabled {
        spawn_server(app, config);
    } else {
        config::set_runtime_status(false, None, None);
        info!("api server disabled after settings update");
    }
}

pub fn stop() {
    if let Ok(mut guard) = server_task().lock() {
        if let Some(mut task) = guard.take() {
            if let Some(tx) = task.shutdown_tx.take() {
                let _ = tx.send(());
            }
        }
    }
}

fn spawn_server(app: AppHandle, config: ApiServerConfig) {
    let bind_addr = format!("{}:{}", config.bind, config.port);
    let api_state = routes::ApiState {
        app: app.clone(),
        config: config.clone(),
    };
    let router = routes::build_router(api_state);

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
            Ok(listener) => listener,
            Err(err) => {
                let message = format!("failed to bind {bind_addr}: {err}");
                error!(%bind_addr, error = %err, "api server bind failed");
                config::set_runtime_status(false, None, Some(message));
                return;
            }
        };

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        if let Ok(mut guard) = server_task().lock() {
            *guard = Some(ServerTask {
                shutdown_tx: Some(shutdown_tx),
            });
        }

        config::set_runtime_status(true, Some(bind_addr.clone()), None);
        info!(%bind_addr, "api server listening");

        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });

        if let Err(err) = server.await {
            let message = format!("api server stopped: {err}");
            error!(error = %err, "api server error");
            config::set_runtime_status(false, Some(bind_addr), Some(message));
        } else {
            config::set_runtime_status(false, None, None);
        }

        if let Ok(mut guard) = server_task().lock() {
            *guard = None;
        }
    });
}

pub fn get_settings() -> ApiServerSettingsDto {
    build_settings_dto(&load_config())
}

pub fn set_settings(
    app: AppHandle,
    patch: SetApiServerSettingsDto,
) -> Result<ApiServerSettingsDto, String> {
    let current = load_config();
    let next = routes::apply_settings_patch(&current, &patch);
    save_config(&next)?;
    restart(app);
    Ok(get_settings())
}

#[cfg(test)]
mod tests {
    use super::config::{ApiServerConfig, DEFAULT_PORT};
    use super::query::include_icons_default_false;
    use super::routes::apply_settings_patch;
    use crate::models::SetApiServerSettingsDto;
    use crate::services::resolve_query_date;

    #[test]
    fn include_icons_defaults_to_false() {
        assert!(!include_icons_default_false(None));
        assert!(include_icons_default_false(Some(true)));
        assert!(!include_icons_default_false(Some(false)));
    }

    #[test]
    fn apply_settings_patch_clamps_port() {
        let current = ApiServerConfig {
            enabled: true,
            port: DEFAULT_PORT,
            bind: "0.0.0.0".to_string(),
            hostname: String::new(),
        };
        let next = apply_settings_patch(
            &current,
            &SetApiServerSettingsDto {
                enabled: None,
                port: Some(80),
                bind: None,
                hostname: Some("lab-01".to_string()),
            },
        );
        assert_eq!(next.port, 1024);
        assert_eq!(next.hostname, "lab-01");
    }

    #[test]
    fn resolve_query_date_accepts_today_format() {
        let resolved = resolve_query_date(Some("2026-07-02".to_string())).expect("valid date");
        assert_eq!(resolved, "2026-07-02");
    }
}
