use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleaseAsset {
    pub name: String,
    pub size: u64,
    pub download_url: String,
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateCheckResult {
    pub is_update_available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_name: String,
    pub release_notes: String,
    pub published_at: String,
    pub html_url: String,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgressPayload {
    pub percentage: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub status: String, // "downloading", "installing", "completed", "error"
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    size: u64,
    browser_download_url: String,
    content_type: Option<String>,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    html_url: String,
    assets: Option<Vec<GitHubAsset>>,
}

/// Compares two semver strings (e.g. "v0.3.0" and "0.2.0")
/// Returns true if `latest` is strictly newer than `current`.
pub fn is_version_newer(latest: &str, current: &str) -> bool {
    let parse_semver = |v: &str| -> (u32, u32, u32) {
        let clean = v.trim().trim_start_matches('v').trim_start_matches('V');
        let parts: Vec<&str> = clean.split('.').collect();
        let major = parts
            .first()
            .and_then(|p| p.parse::<u32>().ok())
            .unwrap_or(0);
        let minor = parts
            .get(1)
            .and_then(|p| p.parse::<u32>().ok())
            .unwrap_or(0);
        let patch = parts
            .get(2)
            .and_then(|p| {
                // Handle pre-release tags like "0-beta"
                let num_part = p.split('-').next().unwrap_or("0");
                num_part.parse::<u32>().ok()
            })
            .unwrap_or(0);
        (major, minor, patch)
    };

    let (l_maj, l_min, l_pat) = parse_semver(latest);
    let (c_maj, c_min, c_pat) = parse_semver(current);

    if l_maj != c_maj {
        return l_maj > c_maj;
    }
    if l_min != c_min {
        return l_min > c_min;
    }
    l_pat > c_pat
}

/// Detects the best matching binary asset for the current OS and architecture.
pub fn select_best_asset(assets: &[ReleaseAsset]) -> Option<ReleaseAsset> {
    if assets.is_empty() {
        return None;
    }

    #[cfg(target_os = "macos")]
    {
        #[cfg(target_arch = "aarch64")]
        {
            if let Some(a) = assets.iter().find(|a| {
                let n = a.name.to_lowercase();
                (n.ends_with(".dmg") || n.ends_with(".app.tar.gz"))
                    && (n.contains("aarch64") || n.contains("arm64"))
            }) {
                return Some(a.clone());
            }
        }

        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".dmg"))
        {
            return Some(a.clone());
        }

        if let Some(a) = assets.iter().find(|a| {
            let n = a.name.to_lowercase();
            n.ends_with(".app.tar.gz") || n.ends_with(".zip")
        }) {
            return Some(a.clone());
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(a) = assets.iter().find(|a| {
            let n = a.name.to_lowercase();
            n.ends_with(".msi") || (n.ends_with(".exe") && n.contains("setup"))
        }) {
            return Some(a.clone());
        }

        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".exe"))
        {
            return Some(a.clone());
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".appimage"))
        {
            return Some(a.clone());
        }
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".deb"))
        {
            return Some(a.clone());
        }
    }

    // Generic fallback: first downloadable archive or binary
    assets.first().cloned()
}

#[tauri::command]
pub fn check_for_updates() -> Result<UpdateCheckResult, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let url = "https://api.github.com/repos/sewox/EchoMind/releases/latest";

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(format!("EchoMind-Assistant/{}", current_version))
        .build()
        .map_err(|e| format!("HTTP istemcisi oluşturulamadı: {}", e))?;

    let resp = client
        .get(url)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .map_err(|e| format!("Güncelleme sunucusuna bağlanılamadı: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API yanıt hatası: HTTP {}", resp.status()));
    }

    let release: GitHubRelease = resp
        .json()
        .map_err(|e| format!("Güncelleme bilgisi çözümlenemedi: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v').to_string();
    let is_update_available = is_version_newer(&latest_version, &current_version);

    let assets = release
        .assets
        .unwrap_or_default()
        .into_iter()
        .map(|a| ReleaseAsset {
            name: a.name,
            size: a.size,
            download_url: a.browser_download_url,
            content_type: a
                .content_type
                .unwrap_or_else(|| "application/octet-stream".to_string()),
        })
        .collect();

    Ok(UpdateCheckResult {
        is_update_available,
        current_version,
        latest_version,
        release_name: release.name.unwrap_or_else(|| release.tag_name.clone()),
        release_notes: release.body.unwrap_or_default(),
        published_at: release.published_at.unwrap_or_default(),
        html_url: release.html_url,
        assets,
    })
}

#[tauri::command]
pub fn download_and_install_update(
    app: tauri::AppHandle,
    download_url: Option<String>,
    filename: Option<String>,
) -> Result<String, String> {
    let target_url = match download_url {
        Some(url) if !url.trim().is_empty() => url,
        _ => {
            let check = check_for_updates()?;
            let asset = select_best_asset(&check.assets).ok_or_else(|| {
                "Bu platform için uygun güncelleme paketi bulunamadı.".to_string()
            })?;
            asset.download_url
        }
    };

    // Scoped to this project's own release assets only: a generic "https://github.com/"
    // prefix would also accept a download URL pointing at any attacker-controlled repo.
    // objects.githubusercontent.com is GitHub's own CDN redirect target for large assets
    // and uses opaque signed object keys, so it can't be scoped by path the same way.
    if !target_url.starts_with("https://github.com/sewox/EchoMind/releases/download/")
        && !target_url.starts_with("https://objects.githubusercontent.com/")
    {
        return Err("Güvenli olmayan güncelleme adresi.".to_string());
    }

    let raw_name = filename.unwrap_or_else(|| {
        target_url
            .split('/')
            .next_back()
            .unwrap_or("echomind_update_package")
            .to_string()
    });
    // Sanitize filename to prevent path traversal
    let safe_filename: String = raw_name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();

    let temp_dir = std::env::temp_dir().join("echomind_updates");
    let _ = std::fs::create_dir_all(&temp_dir);
    let target_path: PathBuf = temp_dir.join(&safe_filename);

    // Initial progress emit
    let _ = app.emit(
        "update-download-progress",
        UpdateProgressPayload {
            percentage: 0.0,
            downloaded_bytes: 0,
            total_bytes: 0,
            status: "downloading".to_string(),
            error: None,
        },
    );

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
        .user_agent(format!("EchoMind-Updater/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("İndirme istemcisi başlatılamadı: {}", e))?;

    let mut response = client
        .get(&target_url)
        .header("Accept", "application/octet-stream")
        .send()
        .map_err(|e| format!("Güncelleme sunucusuna bağlanılamadı: {}", e))?;

    if !response.status().is_success() {
        let err_msg = format!("HTTP İndirme Hatası: {}", response.status());
        let _ = app.emit(
            "update-download-progress",
            UpdateProgressPayload {
                percentage: 0.0,
                downloaded_bytes: 0,
                total_bytes: 0,
                status: "error".to_string(),
                error: Some(err_msg.clone()),
            },
        );
        return Err(err_msg);
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut file =
        File::create(&target_path).map_err(|e| format!("Hedef dosya oluşturulamadı: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut buffer = [0u8; 32768]; // 32KB chunks
    let mut last_emit_percent = 0;

    loop {
        match response.read(&mut buffer) {
            Ok(0) => break, // EOF
            Ok(bytes_read) => {
                file.write_all(&buffer[..bytes_read])
                    .map_err(|e| format!("Dosyaya yazılırken hata oluştu: {}", e))?;
                downloaded += bytes_read as u64;

                let percent = if total_size > 0 {
                    (downloaded as f64 / total_size as f64) * 100.0
                } else {
                    0.0
                };

                // Emit progress every 2% step or at the end to prevent IPC bottleneck
                if (percent as u32) != last_emit_percent || downloaded == total_size {
                    last_emit_percent = percent as u32;
                    let _ = app.emit(
                        "update-download-progress",
                        UpdateProgressPayload {
                            percentage: (percent * 10.0).round() / 10.0,
                            downloaded_bytes: downloaded,
                            total_bytes: total_size,
                            status: "downloading".to_string(),
                            error: None,
                        },
                    );
                }
            }
            Err(e) => {
                let err_msg = format!("İndirme sırasında kesinti: {}", e);
                let _ = app.emit(
                    "update-download-progress",
                    UpdateProgressPayload {
                        percentage: 0.0,
                        downloaded_bytes: downloaded,
                        total_bytes: total_size,
                        status: "error".to_string(),
                        error: Some(err_msg.clone()),
                    },
                );
                return Err(err_msg);
            }
        }
    }

    let _ = file.flush();

    // Notify ready to install
    let _ = app.emit(
        "update-download-progress",
        UpdateProgressPayload {
            percentage: 100.0,
            downloaded_bytes: downloaded,
            total_bytes: total_size,
            status: "installing".to_string(),
            error: None,
        },
    );

    let path_str = target_path.to_string_lossy().to_string();

    // Execute platform specific installer/launcher
    launch_installer(&target_path)?;

    let _ = app.emit(
        "update-download-progress",
        UpdateProgressPayload {
            percentage: 100.0,
            downloaded_bytes: downloaded,
            total_bytes: total_size,
            status: "completed".to_string(),
            error: None,
        },
    );

    Ok(path_str)
}

fn launch_installer(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // On macOS, open the .dmg or update file with the system default handler
        std::process::Command::new("open")
            .arg(path.as_os_str())
            .spawn()
            .map_err(|e| format!("macOS yükleyici açılamadı: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        let path_str = path.to_string_lossy();
        if path_str.ends_with(".msi") {
            std::process::Command::new("msiexec")
                .args(["/i", &path_str, "/passive"])
                .spawn()
                .map_err(|e| format!("Windows MSI yükleyicisi başlatılamadı: {}", e))?;
        } else {
            std::process::Command::new(path.as_os_str())
                .spawn()
                .map_err(|e| format!("Windows yükleyicisi başlatılamadı: {}", e))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(path, perms);
        }

        std::process::Command::new(path.as_os_str())
            .spawn()
            .map_err(|e| format!("Linux paketi başlatılamadı: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_semver_newer_detection() {
        assert!(is_version_newer("0.3.0", "0.2.0"));
        assert!(is_version_newer("v0.2.1", "0.2.0"));
        assert!(is_version_newer("1.0.0", "0.9.9"));
        assert!(is_version_newer("v0.2.1-beta", "0.2.0"));
        assert!(is_version_newer("2.0.0", "1.99.99"));
    }

    #[test]
    fn test_semver_equal_or_older() {
        assert!(!is_version_newer("0.2.0", "0.2.0"));
        assert!(!is_version_newer("v0.2.0", "0.2.0"));
        assert!(!is_version_newer("0.1.9", "0.2.0"));
        assert!(!is_version_newer("0.2.0", "0.2.1"));
        assert!(!is_version_newer("0.0.1", "1.0.0"));
    }

    #[test]
    fn test_select_best_asset_macos_or_fallback() {
        let assets = vec![
            ReleaseAsset {
                name: "EchoMind_0.2.4_x64.deb".to_string(),
                size: 1024,
                download_url: "https://github.com/sewox/EchoMind/releases/deb".to_string(),
                content_type: "application/octet-stream".to_string(),
            },
            ReleaseAsset {
                name: "EchoMind_0.2.4_aarch64.dmg".to_string(),
                size: 2048,
                download_url: "https://github.com/sewox/EchoMind/releases/dmg".to_string(),
                content_type: "application/octet-stream".to_string(),
            },
        ];

        let selected = select_best_asset(&assets);
        assert!(selected.is_some());
        #[cfg(target_os = "macos")]
        assert!(selected.unwrap().name.ends_with(".dmg"));
    }

    #[test]
    fn test_select_best_asset_empty() {
        assert!(select_best_asset(&[]).is_none());
    }
}
