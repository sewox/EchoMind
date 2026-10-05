//! The user's own words for the speech recognizer: company, product and
//! people names, technical terms. On a real meeting a 6-word list fixed
//! "Sonic Ball" → "SonicWall" with Apple dictation. A built-in list of 50
//! generic terms did not help at all (longer lists dilute the bias), so there
//! is no default list: short and specific works.

use crate::storage::get_storage_dir;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Upper bounds for the user's list.
pub const MAX_USER_TERMS: usize = 100;
pub const MAX_TERM_CHARS: usize = 60;

fn user_file() -> PathBuf {
    get_storage_dir().join("glossary.txt")
}

/// One term per line: trimmed, non-empty, de-duplicated (case-insensitive),
/// length- and count-bounded.
pub fn normalize(lines: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    lines
        .lines()
        .map(str::trim)
        .filter(|t| !t.is_empty() && t.chars().count() <= MAX_TERM_CHARS)
        .filter(|t| seen.insert(t.to_lowercase()))
        .take(MAX_USER_TERMS)
        .map(String::from)
        .collect()
}

fn read_user_terms(path: &Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .map(|s| normalize(&s))
        .unwrap_or_default()
}

/// All terms to hand to the recognizer.
pub fn terms() -> Vec<String> {
    read_user_terms(&user_file())
}

/// The user's terms as a short comma list for Whisper's initial prompt
/// (its context is small, so at most `max_chars`); `None` when empty.
pub fn whisper_hint(max_chars: usize) -> Option<String> {
    hint_from(read_user_terms(&user_file()), max_chars)
}

fn hint_from(terms: Vec<String>, max_chars: usize) -> Option<String> {
    let mut out = String::new();
    for t in terms {
        let extra = if out.is_empty() {
            t.chars().count()
        } else {
            t.chars().count() + 2
        };
        if out.chars().count() + extra > max_chars {
            break;
        }
        if !out.is_empty() {
            out.push_str(", ");
        }
        out.push_str(&t);
    }
    (!out.is_empty()).then_some(out)
}

/// The user's own terms, one per line.
#[tauri::command]
pub fn get_glossary() -> String {
    read_user_terms(&user_file()).join("\n")
}

/// Saves the user's terms (one per line); returns them normalized.
#[tauri::command]
pub fn set_glossary(terms: String) -> Result<String, String> {
    let list = normalize(&terms);
    let path = user_file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, list.join("\n")).map_err(|e| format!("Terimler kaydedilemedi: {e}"))?;
    Ok(list.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_user_input() {
        let long = "x".repeat(MAX_TERM_CHARS + 1);
        let input = format!("  SonicWall \n\nsonicwall\nAcme Corp\n{long}\n Ayşe Yılmaz ");
        assert_eq!(
            normalize(&input),
            vec!["SonicWall", "Acme Corp", "Ayşe Yılmaz"]
        );
        let many: String = (0..MAX_USER_TERMS + 10)
            .map(|i| format!("t{i}\n"))
            .collect();
        assert_eq!(normalize(&many).len(), MAX_USER_TERMS);
    }

    #[test]
    fn whisper_hint_is_short_and_omitted_when_empty() {
        let t = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            hint_from(t(&["Acme", "SonicWall", "Zeta"]), 15),
            Some("Acme, SonicWall".into())
        );
        assert_eq!(hint_from(t(&["Acme"]), 200), Some("Acme".into()));
        assert_eq!(hint_from(Vec::new(), 200), None);
        assert_eq!(hint_from(t(&["Uzunbirisim"]), 3), None);
    }

    #[test]
    fn saves_and_reads_back() {
        let dir = std::env::temp_dir().join(format!("echomind-glossary-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("glossary.txt");
        std::fs::write(&p, "Acme\nacme\n  Zeta  ").unwrap();
        assert_eq!(read_user_terms(&p), vec!["Acme", "Zeta"]);
        assert!(read_user_terms(&dir.join("missing")).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
