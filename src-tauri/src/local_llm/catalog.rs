//! On-device language models for reports (GGUF, run in-process by llama.cpp).
//!
//! Chosen by evaluating meeting reports on a real 48-minute Turkish meeting:
//! Qwen 3.5 4B found every topic and decision with valid source citations;
//! the 2B model missed a whole topic and invented a decision, so it is only
//! used where the 4B model does not fit in memory.

use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct LlmModel {
    pub key: &'static str,
    pub name: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    pub size_bytes: u64,
    /// SHA-256 of the file (Hugging Face LFS object id); verified after download.
    pub sha256: &'static str,
    /// Below this much RAM the model is not offered as the default.
    pub min_ram_gb: u64,
}

pub const QWEN35_4B: LlmModel = LlmModel {
    key: "qwen3.5-4b",
    name: "Qwen 3.5 4B",
    filename: "Qwen3.5-4B-Q4_K_M.gguf",
    url: "https://huggingface.co/lmstudio-community/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
    size_bytes: 2_707_513_696,
    sha256: "25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c",
    min_ram_gb: 8,
};

pub const QWEN35_2B: LlmModel = LlmModel {
    key: "qwen3.5-2b",
    name: "Qwen 3.5 2B",
    filename: "Qwen3.5-2B-Q4_K_M.gguf",
    url: "https://huggingface.co/lmstudio-community/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf",
    size_bytes: 1_270_808_032,
    sha256: "0bfe35afc9f05b7fac3fa04925e051ac7939a42a8a17ea11afc99701bea826cc",
    min_ram_gb: 0,
};

/// Best first.
pub const MODELS: [LlmModel; 2] = [QWEN35_4B, QWEN35_2B];

pub fn by_key(key: &str) -> Option<&'static LlmModel> {
    MODELS.iter().find(|m| m.key == key)
}

pub fn path(model: &LlmModel) -> PathBuf {
    crate::storage::get_models_dir().join(model.filename)
}

/// Complete on disk (size matches; the hash was checked when it was saved).
pub fn is_installed(model: &LlmModel) -> bool {
    std::fs::metadata(path(model))
        .map(|m| m.len() == model.size_bytes)
        .unwrap_or(false)
}

/// The best installed model, if any.
pub fn installed() -> Option<&'static LlmModel> {
    // Unit tests must not depend on whether this machine has a model; the
    // real-model test opts in with ECHOMIND_LLM_TEST=1.
    if cfg!(test) && std::env::var_os("ECHOMIND_LLM_TEST").is_none() {
        return None;
    }
    MODELS.iter().find(|m| is_installed(m))
}

/// The model to offer on a machine with `total_ram_gb` of memory.
pub fn recommended_for_ram(total_ram_gb: f64) -> &'static LlmModel {
    MODELS
        .iter()
        .find(|m| total_ram_gb >= m.min_ram_gb as f64)
        .unwrap_or(&MODELS[MODELS.len() - 1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_b_from_eight_gigabytes() {
        assert_eq!(recommended_for_ram(16.0).key, QWEN35_4B.key);
        assert_eq!(recommended_for_ram(8.0).key, QWEN35_4B.key);
        assert_eq!(recommended_for_ram(7.6).key, QWEN35_2B.key);
        assert_eq!(recommended_for_ram(4.0).key, QWEN35_2B.key);
    }

    #[test]
    fn catalog_entries_are_well_formed() {
        for m in MODELS {
            assert_eq!(by_key(m.key), Some(&m));
            assert!(m.url.starts_with("https://huggingface.co/") && m.url.ends_with(m.filename));
            assert_eq!(m.sha256.len(), 64);
            assert!(m.sha256.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(m.size_bytes > 1_000_000_000);
        }
        assert!(by_key("missing").is_none());
    }
}
