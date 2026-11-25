//! In-app updates and links. An update installs only when its signature matches the public key in `tauri.conf.json`.
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Error, Update, UpdaterExt};

#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current: String,
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
}
/// Builds without a key (development, forks) don't load the updater; it refuses to start without one.
pub fn configured(app: &AppHandle) -> bool {
    app.config().plugins.0.get("updater").and_then(|c| c.get("pubkey")).and_then(|k| k.as_str()).is_some_and(|k| !k.trim().is_empty())
}
fn name(app: &AppHandle) -> String {
    app.package_info().name.clone()
}
/// Web and mail addresses only: never a file, a script or another program's scheme.
pub fn openable(url: &str) -> bool {
    let u = url.to_ascii_lowercase();
    (u.starts_with("https://") || u.starts_with("mailto:")) && !url.chars().any(char::is_control)
}
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !openable(&url) {
        return Err("Only web and e-mail links can be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn update_configured(app: AppHandle) -> bool {
    configured(&app)
}
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateInfo, String> {
    let (current, name) = (app.package_info().version.to_string(), name(&app));
    if !configured(&app) {
        return Err(format!("This build of {name} can’t update itself."));
    }
    // Shared out over a host's addresses, so one that doesn't answer costs seconds, not the system's 20 or more.
    let updater = app.updater_builder().configure_client(|c| c.connect_timeout(Duration::from_secs(20))).build().map_err(|e| e.to_string())?;
    // A connection that stalls mustn't leave the window waiting for good.
    let found = tokio::time::timeout(Duration::from_secs(60), updater.check())
        .await
        .map_err(|_| "Couldn’t check for updates: GitHub didn’t answer within 60 seconds.".to_string())?
        .map_err(|e| check_error_text(&e, &name, &current))?;
    let info = UpdateInfo {
        current,
        version: found.as_ref().map(|u| u.version.clone()),
        notes: found.as_ref().and_then(|u| u.body.clone()),
        date: found.as_ref().and_then(|u| u.date.map(|d| d.to_string())),
    };
    *app.state::<PendingUpdate>().0.lock().unwrap() = found;
    Ok(info)
}
/// `ReleaseNotFound` means no published release has a `latest.json` yet, or GitHub couldn't be reached.
pub fn check_error_text(e: &Error, name: &str, current: &str) -> String {
    match e {
        Error::ReleaseNotFound => format!("No update found. You have {name} {current}. If you’re offline, try again later."),
        other => format!("Couldn’t check for updates: {other}"),
    }
}
/// Installs only the version the person agreed to: a later check may have found another.
#[tauri::command]
pub async fn update_install(app: AppHandle, version: String) -> Result<(), String> {
    let update = app.state::<PendingUpdate>().0.lock().unwrap().take().ok_or("Check for updates first.")?;
    if update.version != version {
        return Err(format!("The newest version is now {}. Check for updates again.", update.version));
    }
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| format!("Couldn’t install the update: {e}"))?;
    app.restart();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_release_reads_as_no_update() {
        assert!(check_error_text(&Error::ReleaseNotFound, "App", "0.1.0").starts_with("No update found. You have App 0.1.0."));
        assert!(check_error_text(&Error::EmptyEndpoints, "App", "0.1.0").starts_with("Couldn’t check for updates: "));
    }
    #[test]
    fn only_web_and_mail_open() {
        assert!(openable("https://ogcrafts.cloud/") && openable("MAILTO:a@b.c"));
        for bad in ["http://x", "file:///etc/passwd", "javascript:1", "C:\\x.exe", "https://x\n", ""] {
            assert!(!openable(bad), "{bad}");
        }
    }
}
