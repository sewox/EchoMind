use serde::{Deserialize, Serialize};
use std::time::Duration;

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
        let major = parts.get(0).and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
        let minor = parts.get(1).and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
        let patch = parts.get(2).and_then(|p| {
            // Handle pre-release tags like "0-beta"
            let num_part = p.split('-').next().unwrap_or("0");
            num_part.parse::<u32>().ok()
        }).unwrap_or(0);
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

    let assets = release.assets.unwrap_or_default().into_iter().map(|a| ReleaseAsset {
        name: a.name,
        size: a.size,
        download_url: a.browser_download_url,
        content_type: a.content_type.unwrap_or_else(|| "application/octet-stream".to_string()),
    }).collect();

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
pub fn open_release_url(url: String) -> Result<(), String> {
    let clean_url = url.trim();
    if clean_url.is_empty() || (!clean_url.starts_with("https://github.com/") && !clean_url.starts_with("https://")) {
        return Err("Geçersiz veya güvensiz URL formatı".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(clean_url)
            .spawn()
            .map_err(|e| format!("Tarayıcı açılamadı: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", clean_url])
            .spawn()
            .map_err(|e| format!("Tarayıcı açılamadı: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(clean_url)
            .spawn()
            .map_err(|e| format!("Tarayıcı açılamadı: {}", e))?;
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
    fn test_open_release_url_validation() {
        assert!(open_release_url("javascript:alert(1)".to_string()).is_err());
        assert!(open_release_url("file:///etc/passwd".to_string()).is_err());
        assert!(open_release_url("".to_string()).is_err());
        assert!(open_release_url("https://github.com/sewox/EchoMind/releases".to_string()).is_ok());
    }
}
