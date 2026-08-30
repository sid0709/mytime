use std::sync::{Mutex, OnceLock};

use crate::db;
use crate::models::ApiServerSettingsDto;

pub const DEFAULT_PORT: u16 = 18765;
pub const DEFAULT_BIND: &str = "0.0.0.0";

const KEY_ENABLED: &str = "api_server_enabled";
const KEY_PORT: &str = "api_server_port";
const KEY_BIND: &str = "api_server_bind";
const KEY_HOSTNAME: &str = "api_server_hostname";

#[derive(Clone, Debug)]
pub struct ApiServerConfig {
    pub enabled: bool,
    pub port: u16,
    pub bind: String,
    pub hostname: String,
}

#[derive(Clone, Debug, Default)]
pub struct ApiServerRuntimeStatus {
    pub running: bool,
    pub listen_addr: Option<String>,
    pub error: Option<String>,
}

static RUNTIME_STATUS: OnceLock<Mutex<ApiServerRuntimeStatus>> = OnceLock::new();
static API_HOST: OnceLock<String> = OnceLock::new();

fn runtime_status() -> &'static Mutex<ApiServerRuntimeStatus> {
    RUNTIME_STATUS.get_or_init(|| Mutex::new(ApiServerRuntimeStatus::default()))
}

pub fn set_runtime_status(running: bool, listen_addr: Option<String>, error: Option<String>) {
    if let Ok(mut status) = runtime_status().lock() {
        status.running = running;
        status.listen_addr = listen_addr;
        status.error = error;
    }
}

pub fn get_runtime_status() -> ApiServerRuntimeStatus {
    runtime_status()
        .lock()
        .map(|status| status.clone())
        .unwrap_or_default()
}

pub fn load_config() -> ApiServerConfig {
    let enabled = match db::get_config(KEY_ENABLED) {
        None => true,
        Some(value) if value.is_empty() => true,
        Some(value) => value == "1" || value.eq_ignore_ascii_case("true"),
    };
    let port = db::get_config(KEY_PORT)
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT)
        .clamp(1024, 65535);
    let bind = db::get_config(KEY_BIND).unwrap_or_else(|| DEFAULT_BIND.to_string());
    let hostname = db::get_config(KEY_HOSTNAME).unwrap_or_default();

    ApiServerConfig {
        enabled,
        port,
        bind,
        hostname,
    }
}

pub fn save_config(config: &ApiServerConfig) -> Result<(), String> {
    db::set_config_result(KEY_ENABLED, if config.enabled { "1" } else { "0" })?;
    db::set_config_result(KEY_PORT, &config.port.to_string())?;
    db::set_config_result(KEY_BIND, &config.bind)?;
    db::set_config_result(KEY_HOSTNAME, &config.hostname)?;
    Ok(())
}

pub fn resolve_hostname(config: &ApiServerConfig) -> String {
    let trimmed = config.hostname.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    hostname::get()
        .ok()
        .and_then(|value| value.into_string().ok())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn build_api_base_url(port: u16) -> String {
    format!("http://{}:{port}/api/v1", api_host())
}

fn api_host() -> &'static str {
    API_HOST
        .get_or_init(|| {
            // UDP connect selects the active IPv4 route without sending a packet. This is only
            // used to display a reachable API URL; it does not poll or record connectivity.
            std::net::UdpSocket::bind("0.0.0.0:0")
                .ok()
                .and_then(|socket| {
                    socket.connect("8.8.8.8:80").ok()?;
                    socket.local_addr().ok()
                })
                .map(|address| address.ip().to_string())
                .unwrap_or_else(|| "127.0.0.1".to_string())
        })
        .as_str()
}

pub fn build_settings_dto(config: &ApiServerConfig) -> ApiServerSettingsDto {
    let runtime = get_runtime_status();
    let api_base_url = if runtime.running {
        Some(build_api_base_url(config.port))
    } else {
        None
    };

    ApiServerSettingsDto {
        enabled: config.enabled,
        port: config.port,
        bind: config.bind.clone(),
        hostname: resolve_hostname(config),
        running: runtime.running,
        listen_addr: runtime.listen_addr,
        api_base_url,
        error: runtime.error,
    }
}
