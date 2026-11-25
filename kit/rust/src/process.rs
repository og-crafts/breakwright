//! Starting other programs on Windows, macOS and Linux.
use std::path::{Path, PathBuf};
use std::process::Command;

/// `Command::new` on Windows only finds `.exe`; this also finds `npx.cmd` and the like.
pub fn resolve(command: &str) -> String {
    if cfg!(windows) && Path::new(command).extension().is_none() && !command.contains(['/', '\\']) {
        let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
        for dir in std::env::var_os("PATH").iter().flat_map(std::env::split_paths) {
            for ext in exts.split(';').filter(|e| !e.is_empty()) {
                let f = dir.join(format!("{command}{}", ext.to_ascii_lowercase()));
                if f.is_file() {
                    return f.display().to_string();
                }
            }
        }
    }
    command.to_string()
}
/// A command that opens no console window on Windows.
pub fn quiet(command: &str) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(resolve(command));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}
/// Windows resource paths can carry a `\\?\` prefix that some programs (Node) can't load.
pub fn plain(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    match s.strip_prefix(r"\\?\UNC\") {
        Some(rest) => PathBuf::from(format!(r"\\{rest}")),
        None => PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s)),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prefix_goes_and_the_rest_stays() {
        assert_eq!(plain(Path::new(r"\\?\C:\a\b.mjs")), PathBuf::from(r"C:\a\b.mjs"));
        assert_eq!(plain(Path::new(r"\\?\UNC\srv\x")), PathBuf::from(r"\\srv\x"));
        assert_eq!(plain(Path::new("/opt/a")), PathBuf::from("/opt/a"));
    }
}
