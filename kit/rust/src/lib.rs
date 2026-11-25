//! What every OGCrafts desktop app's native side shares. The app's `run()` starts with `ogc_kit::builder()` and lists
//! the four commands of `ogc_kit::commands` in its own `generate_handler!`, so the window needs only `core:default`.
pub mod commands;
pub mod process;
use tauri::{AppHandle, Manager, Wry};

/// One running copy (it has to be the first plugin), the system browser, and the updater when this build has a key.
pub fn builder() -> tauri::Builder<Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| focus_main(app)))
        .plugin(tauri_plugin_opener::init())
        .manage(commands::PendingUpdate::default())
        .setup(|app| Ok(setup(app.handle())?))
}
/// Call this from your own `.setup()` if the app replaces the builder's.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    if commands::configured(app) {
        app.plugin(tauri_plugin_updater::Builder::new().build())?;
    }
    Ok(())
}
/// Shows the main window, restores it if it was minimized and gives it focus.
pub fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        let _ = w.set_focus();
    }
}
