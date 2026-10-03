//! Model listing, download (resumable, SHA-256 verified) and removal.

use super::catalog::{self, LlmModel};
use crate::transcriber::ModelDownloadProgressPayload;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

pub const PROGRESS_EVENT: &str = "llm-model-download-progress";

#[derive(Debug, Serialize)]
pub struct LlmModelInfo {
    pub key: String,
    pub name: String,
    pub size_bytes: u64,
    pub installed: bool,
    /// The model suggested for this machine's memory.
    pub recommended: bool,
    /// The installed model reports are generated with.
    pub active: bool,
}

#[tauri::command]
pub fn get_llm_models() -> Vec<LlmModelInfo> {
    let ram = crate::hardware::HardwareInfo::detect().total_ram_gb;
    let recommended = catalog::recommended_for_ram(ram).key;
    let active = catalog::installed().map(|m| m.key);
    catalog::MODELS
        .iter()
        .map(|m| LlmModelInfo {
            key: m.key.into(),
            name: m.name.into(),
            size_bytes: m.size_bytes,
            installed: catalog::is_installed(m),
            recommended: m.key == recommended,
            active: Some(m.key) == active,
        })
        .collect()
}

fn in_flight() -> &'static Mutex<HashSet<&'static str>> {
    static IN_FLIGHT: OnceLock<Mutex<HashSet<&'static str>>> = OnceLock::new();
    IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Downloads `key` into the models directory; progress on [`PROGRESS_EVENT`].
#[tauri::command]
pub async fn download_llm_model(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let model = catalog::by_key(&key).ok_or_else(|| format!("Bilinmeyen model: {key}"))?;
    if !in_flight().lock().unwrap().insert(model.key) {
        return Err(format!("{} zaten indiriliyor.", model.name));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let emit = |status: &str, done: u64, error: Option<String>| {
            let _ = app.emit(
                PROGRESS_EVENT,
                ModelDownloadProgressPayload {
                    model_key: model.key.into(),
                    percentage: ((done as f64 / model.size_bytes as f64) * 1000.0).round() / 10.0,
                    downloaded_bytes: done,
                    total_bytes: model.size_bytes,
                    status: status.into(),
                    error,
                },
            );
        };
        let result = download(model, &|done| emit("downloading", done, None));
        match &result {
            Ok(()) => emit("completed", model.size_bytes, None),
            Err(e) => emit("error", 0, Some(e.clone())),
        }
        result
    })
    .await
    .map_err(|e| format!("İndirme iş parçacığı hatası: {e}"));
    in_flight().lock().unwrap().remove(model.key);
    result?
}

fn download(model: &LlmModel, on_bytes: &dyn Fn(u64)) -> Result<(), String> {
    if catalog::is_installed(model) {
        return Ok(());
    }
    let target = catalog::path(model);
    let dir = target.parent().ok_or("Model klasörü yok")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Model klasörü oluşturulamadı: {e}"))?;
    let part = dir.join(format!("{}.part", model.filename));

    // Resume a partial download; hash what is already there first.
    let mut hasher = Sha256::new();
    let mut have = 0u64;
    if let Ok(mut f) = std::fs::File::open(&part) {
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = f.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            have += n as u64;
        }
    }
    if have > model.size_bytes {
        let _ = std::fs::remove_file(&part);
        return Err("Yarım kalan indirme bozuk; yeniden deneyin.".into());
    }

    if have < model.size_bytes {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .timeout(None)
            .build()
            .map_err(|e| e.to_string())?;
        let mut req = client.get(model.url);
        if have > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let mut resp = req
            .send()
            .map_err(|e| format!("İndirme başlatılamadı: {e}"))?;
        let status = resp.status();
        if have > 0 && status != reqwest::StatusCode::PARTIAL_CONTENT {
            // Server ignored the range: start over.
            let _ = std::fs::remove_file(&part);
            return Err("Sunucu kaldığı yerden devam etmeyi desteklemedi; yeniden deneyin.".into());
        }
        if !status.is_success() {
            return Err(format!("İndirme hatası: HTTP {status}"));
        }
        let mut out = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part)
            .map_err(|e| format!("Dosya açılamadı: {e}"))?;
        let mut buf = vec![0u8; 1 << 20];
        let mut last_reported = 0u64;
        loop {
            let n = resp
                .read(&mut buf)
                .map_err(|e| format!("İndirme kesildi (kaldığı yerden devam edilebilir): {e}"))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])
                .map_err(|e| format!("Diske yazılamadı: {e}"))?;
            hasher.update(&buf[..n]);
            have += n as u64;
            if have - last_reported >= 8 << 20 {
                last_reported = have;
                on_bytes(have);
            }
        }
        out.flush().map_err(|e| e.to_string())?;
    }

    if have != model.size_bytes {
        return Err(format!(
            "İndirme eksik kaldı ({have}/{} bayt); yeniden deneyin.",
            model.size_bytes
        ));
    }
    let digest = format!("{:x}", hasher.finalize());
    if digest != model.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err("İndirilen dosya doğrulanamadı (SHA-256 uyuşmuyor).".into());
    }
    std::fs::rename(&part, &target).map_err(|e| format!("Dosya taşınamadı: {e}"))?;
    on_bytes(have);
    Ok(())
}

#[tauri::command]
pub fn delete_llm_model(key: String) -> Result<(), String> {
    let model = catalog::by_key(&key).ok_or_else(|| format!("Bilinmeyen model: {key}"))?;
    super::engine::unload();
    let path = catalog::path(model);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Model silinemedi: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::net::TcpListener;

    /// Serves `body` for every request, honouring `Range: bytes=N-`.
    fn serve(body: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                let mut start = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(r) = line.to_lowercase().strip_prefix("range: bytes=") {
                        start = r.trim().trim_end_matches('-').parse().unwrap_or(0);
                    }
                }
                let mut out = stream;
                let rest = &body[start..];
                let head = if start > 0 {
                    format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\n\r\n",
                        rest.len(), start, body.len() - 1, body.len()
                    )
                } else {
                    format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", rest.len())
                };
                let _ = out.write_all(head.as_bytes());
                let _ = out.write_all(rest);
            }
        });
        format!("http://{addr}/model.gguf")
    }

    fn fake_model(name: &str, body: &'static [u8], sha: Option<&str>) -> &'static LlmModel {
        let sha = sha
            .map(String::from)
            .unwrap_or_else(|| format!("{:x}", Sha256::digest(body)));
        Box::leak(Box::new(LlmModel {
            key: Box::leak(name.to_string().into_boxed_str()),
            name: "Test",
            filename: Box::leak(format!("{name}.gguf").into_boxed_str()),
            url: Box::leak(serve(body).into_boxed_str()),
            size_bytes: body.len() as u64,
            sha256: Box::leak(sha.into_boxed_str()),
            min_ram_gb: 0,
        }))
    }

    fn cleanup(m: &LlmModel) {
        let p = catalog::path(m);
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(p.with_file_name(format!("{}.part", m.filename)));
    }

    const BODY: &[u8] = b"GGUF fake model payload used by the download tests 0123456789";

    #[test]
    fn downloads_and_verifies() {
        let m = fake_model("dl-full", BODY, None);
        cleanup(m);
        download(m, &|_| {}).unwrap();
        assert!(catalog::is_installed(m));
        assert_eq!(std::fs::read(catalog::path(m)).unwrap(), BODY);
        cleanup(m);
    }

    #[test]
    fn resumes_a_partial_download() {
        let m = fake_model("dl-resume", BODY, None);
        cleanup(m);
        let part = catalog::path(m).with_file_name(format!("{}.part", m.filename));
        std::fs::create_dir_all(part.parent().unwrap()).unwrap();
        std::fs::write(&part, &BODY[..20]).unwrap();
        download(m, &|_| {}).unwrap();
        assert_eq!(std::fs::read(catalog::path(m)).unwrap(), BODY);
        assert!(!part.exists());
        cleanup(m);
    }

    #[test]
    fn rejects_a_file_with_the_wrong_hash() {
        let m = fake_model("dl-badhash", BODY, Some(&"0".repeat(64)));
        cleanup(m);
        let err = download(m, &|_| {}).unwrap_err();
        assert!(err.contains("SHA-256"), "{err}");
        assert!(!catalog::is_installed(m));
        assert!(!catalog::path(m)
            .with_file_name(format!("{}.part", m.filename))
            .exists());
        cleanup(m);
    }
}
