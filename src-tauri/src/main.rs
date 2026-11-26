#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Thin shell: starts the Node helper, shows its page in a window, and stops it on exit. The page gets no native commands.
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Helper(Mutex<Option<Child>>);

/// Desktop apps often start with a short PATH, so look in the usual places too.
fn node() -> Option<PathBuf> {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for d in ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "C:\\Program Files\\nodejs"] { dirs.push(d.into()) }
    if let Some(h) = std::env::var_os("HOME") { dirs.push(PathBuf::from(h).join(".local/node/bin")) }
    dirs.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
}
/// The page keeps its settings (theme, sizes) in the browser storage of its address, so the helper asks for the port it had
/// last time. A different port would be a new address with nothing remembered.
fn saved_port(file: &Path) -> Option<u16> { std::fs::read_to_string(file).ok()?.trim().parse().ok().filter(|p| *p >= 1024) }
fn port_of(url: &str) -> Option<u16> { url.parse::<tauri::Url>().ok()?.port() }
fn start(cli: &Path, port: Option<u16>) -> Result<(Child, String), String> {
    let node = node().ok_or("Breakwright needs Node.js 22.15 or newer. Install it from nodejs.org, then open Breakwright again.")?;
    let mut c = Command::new(node);
    c.arg(cli).args(["open", "--print-url"]);
    if let Some(p) = port { c.args(["--port", &p.to_string()]); }
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
    let mut child = c.spawn().map_err(|e| format!("Couldn't start the helper: {e}"))?;
    let mut line = String::new();
    let read = BufReader::new(child.stdout.take().unwrap()).read_line(&mut line);
    let url = read.ok().and_then(|_| serde_json::from_str::<serde_json::Value>(&line).ok()).and_then(|v| v["url"].as_str().map(str::to_owned));
    match url { Some(u) => Ok((child, u)), None => { let _ = child.kill(); Err("The helper stopped right away. Check that Node.js is version 22.15 or newer.".into()) } }
}
fn main() {
    ogc_kit::builder()
        .setup(|app| {
            ogc_kit::setup(app.handle())?;
            let res = app.path().resource_dir()?.join("app/cli.mjs");
            // Windows resource paths can carry a \\?\ prefix that Node can't load as a script.
            let cli = PathBuf::from(res.to_string_lossy().trim_start_matches(r"\\?\").to_string());
            let file = app.path().app_data_dir()?.join("helper-port");
            let saved = saved_port(&file);
            // The port can be taken by another program by now: then any free one.
            let got = start(&cli, saved).or_else(|e| if saved.is_some() { start(&cli, None) } else { Err(e) });
            let (child, url) = match got {
                Ok((c, u)) => {
                    if let Some(p) = port_of(&u).filter(|p| Some(*p) != saved) {
                        let _ = std::fs::create_dir_all(file.parent().unwrap()).and_then(|_| std::fs::write(&file, p.to_string()));
                    }
                    (Some(c), WebviewUrl::External(u.parse()?))
                }
                Err(m) => (None, WebviewUrl::App(format!("index.html#{}", m.replace(' ', "%20")).into())),
            };
            let home = match &url { WebviewUrl::External(u) => Some(u.origin()), _ => None };
            app.manage(Helper(Mutex::new(child)));
            WebviewWindowBuilder::new(app, "main", url).title("Breakwright").inner_size(1280.0, 820.0).min_inner_size(480.0, 480.0)
                .on_navigation(move |u| home.as_ref().is_none_or(|h| u.origin() == *h)).build()?;
            Ok(())
        })
        .build(tauri::generate_context!()).expect("Breakwright couldn't start")
        .run(|app, e| if let RunEvent::Exit = e {
            // Closing its input asks the helper to stop tests and browsers; then make sure.
            if let Some(mut c) = app.state::<Helper>().0.lock().unwrap().take() {
                drop(c.stdin.take());
                for _ in 0..30 { if matches!(c.try_wait(), Ok(Some(_))) { return } std::thread::sleep(std::time::Duration::from_millis(100)) }
                let _ = c.kill();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn port_file_and_url() {
        let d = std::env::temp_dir().join(format!("bw-port-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("helper-port");
        assert_eq!(saved_port(&f), None, "no file yet");
        for (text, want) in [("52394\n", Some(52394)), ("80", None), ("x", None), ("70000", None)] {
            std::fs::write(&f, text).unwrap();
            assert_eq!(saved_port(&f), want, "{text:?}");
        }
        assert_eq!(port_of("http://127.0.0.1:52394/"), Some(52394));
        assert_eq!(port_of("not a url"), None);
        std::fs::remove_dir_all(&d).unwrap();
    }
}
