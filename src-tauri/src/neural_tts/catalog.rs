//! Downloadable voice packs for the briefing: what each is made of, where its
//! files come from (pinned revisions, SHA-256-checked) and the commands the
//! model hub uses.

use crate::local_llm::download::fetch;
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

pub const PROGRESS_EVENT: &str = "voice-pack-download-progress";

pub struct RemoteFile {
    /// Path inside the pack folder.
    pub rel: &'static str,
    /// Empty while the file is not published anywhere yet.
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

pub struct VoicePack {
    pub key: &'static str,
    pub lang: &'static str,
    pub name: &'static str,
    /// Folder under the models directory.
    pub dir: &'static str,
    pub files: &'static [RemoteFile],
}

/// English: Kokoro-82M (Apache-2.0) 8-bit/fp16 build at a pinned revision,
/// two voices, and misaki's dictionaries (Apache-2.0) at a pinned commit.
pub const KOKORO_EN: VoicePack = VoicePack {
    key: "kokoro-en",
    lang: "en",
    name: "Kokoro (English)",
    dir: "kokoro",
    files: &[
        RemoteFile {
            rel: "model_q8f16.onnx",
            url: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/onnx/model_q8f16.onnx",
            size: 86_033_585,
            sha256: "04c658aec1b6008857c2ad10f8c589d4180d0ec427e7e6118ceb487e215c3cd0",
        },
        RemoteFile {
            rel: "voices/af_heart.bin",
            url: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_heart.bin",
            size: 522_240,
            sha256: "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b",
        },
        RemoteFile {
            rel: "voices/bf_emma.bin",
            url: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bf_emma.bin",
            size: 522_240,
            sha256: "669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73",
        },
        RemoteFile {
            rel: "us_gold.json",
            url: "https://raw.githubusercontent.com/hexgrad/misaki/fba1236595f2d2bf21d414ba6e57d25256afada3/misaki/data/us_gold.json",
            size: 3_000_469,
            sha256: "dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f",
        },
        RemoteFile {
            rel: "us_silver.json",
            url: "https://raw.githubusercontent.com/hexgrad/misaki/fba1236595f2d2bf21d414ba6e57d25256afada3/misaki/data/us_silver.json",
            size: 3_099_517,
            sha256: "de8f67be911bb6c659187b4a65fd966b6a30e56350e0f790d763210b053ac475",
        },
    ],
};

/// Turkish: EMA Lightning (Apache-2.0), exported to ONNX by EchoMind. The
/// exported files are published with the open-source export; until then the
/// pack can only be installed by hand (download is not offered).
pub const EMA_TR: VoicePack = VoicePack {
    key: "ema-tr",
    lang: "tr",
    name: "EMA Lightning (Türkçe)",
    dir: "ema-lightning",
    files: &[
        RemoteFile {
            rel: "text.onnx",
            url: "",
            size: 4_804_278,
            sha256: "",
        },
        RemoteFile {
            rel: "sound.onnx",
            url: "",
            size: 17_927_687,
            sha256: "",
        },
        RemoteFile {
            rel: "decoder.onnx",
            url: "",
            size: 12_031_945,
            sha256: "",
        },
    ],
};

pub const PACKS: [&VoicePack; 2] = [&EMA_TR, &KOKORO_EN];

pub fn pack_dir(pack: &VoicePack) -> PathBuf {
    crate::storage::get_models_dir().join(pack.dir)
}

pub fn is_installed(pack: &VoicePack) -> bool {
    let dir = pack_dir(pack);
    pack.files.iter().all(|f| dir.join(f.rel).is_file())
}

fn downloadable(pack: &VoicePack) -> bool {
    pack.files
        .iter()
        .all(|f| !f.url.is_empty() && !f.sha256.is_empty())
}

fn find(key: &str) -> Result<&'static VoicePack, String> {
    PACKS
        .iter()
        .copied()
        .find(|p| p.key == key)
        .ok_or_else(|| format!("Bilinmeyen ses paketi: {key}"))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VoicePackInfo {
    pub key: String,
    pub lang: String,
    pub name: String,
    pub size_bytes: u64,
    pub installed: bool,
    /// The files are published and can be downloaded from the app.
    pub downloadable: bool,
}

#[tauri::command]
pub fn get_voice_packs() -> Vec<VoicePackInfo> {
    PACKS
        .iter()
        .map(|p| VoicePackInfo {
            key: p.key.into(),
            lang: p.lang.into(),
            name: p.name.into(),
            size_bytes: p.files.iter().map(|f| f.size).sum(),
            installed: is_installed(p),
            downloadable: downloadable(p),
        })
        .collect()
}

#[derive(Clone, Serialize)]
struct Progress {
    key: String,
    percentage: f32,
    status: &'static str,
    error: Option<String>,
}

fn in_flight() -> &'static Mutex<HashSet<&'static str>> {
    static SET: OnceLock<Mutex<HashSet<&'static str>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

fn download_pack(pack: &VoicePack, on_bytes: &dyn Fn(u64)) -> Result<(), String> {
    if !downloadable(pack) {
        return Err("Bu ses paketi henüz indirilebilir değil.".into());
    }
    let dir = pack_dir(pack);
    let mut done = 0u64;
    for f in pack.files {
        let target = dir.join(f.rel);
        if !target.is_file() {
            fetch(f.url, &target, f.size, f.sha256, &|b| on_bytes(done + b))?;
        }
        done += f.size;
        on_bytes(done);
    }
    Ok(())
}

/// Downloads a voice pack (resumable, every file SHA-256-checked); progress
/// arrives as `voice-pack-download-progress` events.
#[tauri::command]
pub async fn download_voice_pack(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let pack = find(&key)?;
    if !in_flight().lock().unwrap().insert(pack.key) {
        return Ok(());
    }
    let total: u64 = pack.files.iter().map(|f| f.size).sum();
    let emit = {
        let app = app.clone();
        move |percentage: f32, status: &'static str, error: Option<String>| {
            let _ = app.emit(
                PROGRESS_EVENT,
                Progress {
                    key: pack.key.into(),
                    percentage,
                    status,
                    error,
                },
            );
        }
    };
    let progress = emit.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        download_pack(pack, &|b| {
            progress(100.0 * b as f32 / total as f32, "downloading", None)
        })
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    in_flight().lock().unwrap().remove(pack.key);
    match &result {
        Ok(()) => emit(100.0, "completed", None),
        Err(e) => emit(0.0, "error", Some(e.clone())),
    }
    result
}

#[tauri::command]
pub fn delete_voice_pack(key: String) -> Result<(), String> {
    let pack = find(&key)?;
    super::forget_engines();
    let dir = pack_dir(pack);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Ses paketi silinemedi: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_are_complete_and_pinned() {
        for p in PACKS {
            assert!(!p.files.is_empty(), "{}", p.key);
            for f in p.files {
                assert!(f.size > 0, "{}", f.rel);
                if !f.url.is_empty() {
                    assert!(f.url.starts_with("https://"), "{}", f.url);
                    assert_eq!(f.sha256.len(), 64, "{}", f.rel);
                    // Pinned to a revision, never a moving branch.
                    assert!(
                        !f.url.contains("/main/") && !f.url.contains("/resolve/main"),
                        "{}",
                        f.url
                    );
                }
            }
        }
        assert!(downloadable(&KOKORO_EN));
        assert!(!downloadable(&EMA_TR));
    }

    #[test]
    fn listing_reports_size_and_state() {
        let list = get_voice_packs();
        let kokoro = list.iter().find(|p| p.key == "kokoro-en").unwrap();
        assert_eq!(
            kokoro.size_bytes,
            86_033_585 + 2 * 522_240 + 3_000_469 + 3_099_517
        );
        assert!(!kokoro.installed);
        assert!(kokoro.downloadable);
        assert!(find("nope").is_err());
    }

    #[test]
    fn unpublished_pack_is_not_downloaded() {
        assert!(download_pack(&EMA_TR, &|_| {})
            .unwrap_err()
            .contains("henüz"));
    }
}
