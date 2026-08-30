use std::{error::Error, path::Path, sync::OnceLock};

mod activity_score;
pub mod api_server;
mod app_state;
mod app_usage_monitor;
mod config;
mod db;
mod input_aggregator;
mod input_complexity;
mod input_monitor;
mod input_sequence;
mod ipc;
mod models;
mod quality_live;
mod services;
mod startup;

use app_state::AppState;
use config::AppPaths;
use tauri::{
    image::Image,
    menu::{Menu, MenuId, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tracing::info;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();
const LOG_RETENTION_DAYS: u64 = 30;
const LOG_MAINTENANCE_INTERVAL_SECS: u64 = 6 * 60 * 60;

fn prune_old_logs(log_dir: &Path) {
    let Some(cutoff) = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(LOG_RETENTION_DAYS * 86_400))
    else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };

    let mut removed = 0_u32;
    for entry in entries.flatten() {
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with("mytime.log.")
        {
            continue;
        }
        let is_old = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .map(|modified| modified < cutoff)
            .unwrap_or(false);
        if is_old && std::fs::remove_file(entry.path()).is_ok() {
            removed = removed.saturating_add(1);
        }
    }
    if removed > 0 {
        tracing::info!(removed, "pruned old application log files");
    }
}

fn init_logging(log_dir: &Path) -> Result<(), Box<dyn Error>> {
    let file_appender = tracing_appender::rolling::daily(log_dir, "mytime.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let file_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(non_blocking);

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer);

    #[cfg(debug_assertions)]
    let registry = registry.with(
        tracing_subscriber::fmt::layer()
            .with_ansi(true)
            .with_writer(std::io::stderr),
    );

    registry.try_init()?;

    let _ = LOG_GUARD.set(guard);
    prune_old_logs(log_dir);

    // A tray application may stay alive for months, so startup-only cleanup is insufficient.
    // Re-run retention periodically without involving the UI or the main runtime thread.
    let maintenance_log_dir = log_dir.to_path_buf();
    let _ = std::thread::Builder::new()
        .name("mytime-log-maintenance".to_string())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(
                LOG_MAINTENANCE_INTERVAL_SECS,
            ));
            prune_old_logs(&maintenance_log_dir);
        });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch: focus and show the existing main window.
            show_main_window(app);
        }))
        .setup(|app| {
            // Menu-bar / tray app: keep the tray icon and stay out of the macOS Dock.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let paths = AppPaths::resolve(&app.handle())?;
            crate::activity_score::load_quality_env();
            init_logging(&paths.log_dir)?;

            info!(
                data_dir = %paths.data_dir.display(),
                log_dir = %paths.log_dir.display(),
                db_path = %paths.db_path.display(),
                "initialized foundation paths"
            );

            db::init(&paths.db_path).map_err(|e| {
                Box::<dyn std::error::Error>::from(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    e,
                ))
            })?;

            // Register app to start at Windows login (once; no re-register).
            startup::register_once();

            #[cfg(target_os = "macos")]
            let log_dir_for_input = paths.log_dir.clone();

            let state = AppState::new(paths);
            app.manage(state);

            info!("registered backend foundation state");

            #[cfg(target_os = "macos")]
            {
                input_monitor::set_macos_log_dir(log_dir_for_input.clone());
                let granted = input_monitor::prompt_macos_permissions_at_launch();
                info!(granted, "macOS input monitoring permission prompt finished");
                let diag = input_monitor::get_monitor_diagnostics(
                    log_dir_for_input.to_string_lossy().as_ref(),
                );
                info!(?diag, "macOS input monitor diagnostics at launch");
            }

            // Start background collectors.
            let data_dir = app.state::<AppState>().paths().data_dir.clone();
            quality_live::start(app.handle().clone(), &data_dir);
            app_usage_monitor::start_global_app_usage_monitor(app.handle().clone());
            input_monitor::start_global_input_monitor(app.handle().clone());

            api_server::start(app.handle().clone());

            setup_tray(app)?;

            Ok(())
        })
        // When the user clicks the window close button, hide to tray instead of quitting.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide the window and keep the process + collectors running.
                let _ = window.hide();
                keep_out_of_dock(window.app_handle());
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            ipc::get_recent_logs,
            ipc::get_dashboard_summary,
            ipc::get_input_stats,
            ipc::get_recent_input_events,
            ipc::get_input_monitor_status,
            ipc::get_input_monitor_diagnostics,
            ipc::request_input_monitor_permission,
            ipc::open_input_monitor_settings,
            ipc::get_activity_app_usage,
            ipc::get_activity_overview,
            ipc::get_activity_session_page,
            ipc::get_activity_input_minutes,
            ipc::get_activity_heatmap,
            ipc::get_activity_timeline,
            ipc::get_quality_live,
            ipc::get_quality_day,
            ipc::refresh_quality_live,
            ipc::get_sunburst_settings,
            ipc::save_sunburst_settings,
            ipc::get_api_server_settings,
            ipc::set_api_server_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn run_input_hook_helper(port: u16) -> Result<(), String> {
    input_monitor::run_input_hook_helper(port)
}

fn keep_out_of_dock<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) {
    #[cfg(target_os = "macos")]
    {
        let _ = _app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
}

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let was_visible = window.is_visible().unwrap_or(true);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        // macOS WKWebView often composites a blank white surface after hide-to-tray.
        if !was_visible {
            let _ = window.eval("window.location.reload()");
        }
    }
    keep_out_of_dock(app);
}

fn load_tray_icon<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Image<'static>> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join("icons/32x32.png");
        if path.exists() {
            return Image::from_path(path);
        }
    }

    // Dev-only fallback: release builds must ship the icon via bundle.resources.
    #[cfg(debug_assertions)]
    {
        let manifest_icon =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/32x32.png");
        if manifest_icon.exists() {
            return Image::from_path(manifest_icon);
        }
    }

    Image::from_bytes(include_bytes!("../icons/32x32.png"))
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
    let app_handle = app.handle().clone();
    let icon = load_tray_icon(&app_handle).map_err(|error| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("failed to load tray icon: {error}"),
        )
    })?;

    let quit_id = MenuId::new("tray-quit");
    let quit_item = MenuItem::with_id(&app_handle, quit_id.clone(), "Quit", true, None::<&str>)?;
    let tray_menu = Menu::with_items(&app_handle, &[&quit_item])?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("MyTime")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            if event.id() == &quit_id {
                app_usage_monitor::persist_checkpoint();
                quality_live::flush();
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    show_main_window(tray.app_handle());
                }
            }
        })
        .build(app)?;

    // Keep the tray icon alive for the app lifetime (dropping it removes the icon).
    app.manage(tray);
    info!("system tray icon created");
    Ok(())
}
