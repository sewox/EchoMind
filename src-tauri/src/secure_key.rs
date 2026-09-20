use crate::storage::get_storage_dir;
use chacha20poly1305::aead::{KeyInit, OsRng};
use chacha20poly1305::ChaCha20Poly1305;
#[cfg(not(test))]
use keyring::Entry;
use std::fs;
use std::path::PathBuf;

#[cfg(not(test))]
const SERVICE_NAME: &str = "com.echomind.assistant";

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn from_hex(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

fn fallback_key_path(fallback_filename: &str) -> PathBuf {
    // get_storage_dir() already resolves to an isolated temp directory in test
    // builds, so this never touches the real app data directory during tests.
    get_storage_dir().join(fallback_filename)
}

/// Last-resort key storage for environments without an OS keychain/Secret Service
/// daemon available (e.g. minimal Linux setups, some CI/sandbox environments).
/// The key is a genuine random 256-bit value (not derived from any public or
/// guessable input), stored with owner-only file permissions where supported.
fn get_or_create_fallback_key(fallback_filename: &str) -> [u8; 32] {
    let path = fallback_key_path(fallback_filename);

    if let Ok(existing) = fs::read_to_string(&path) {
        if let Some(key) = from_hex(existing.trim()) {
            return key;
        }
    }

    let new_key: [u8; 32] = ChaCha20Poly1305::generate_key(&mut OsRng).into();
    let _ = fs::create_dir_all(get_storage_dir());
    let _ = fs::write(&path, to_hex(&new_key));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = fs::set_permissions(&path, perms);
        }
    }

    new_key
}

/// Returns a stable, per-installation 256-bit key for the given logical purpose
/// (`account` distinguishes independent keys, e.g. one for the credential vault
/// and one for data-at-rest storage, so compromising one never exposes the other).
///
/// Prefers the OS-native secure keystore (macOS Keychain / Windows Credential
/// Manager / Linux Secret Service) so the key is gated behind the user's OS login
/// session rather than being readable by anything that can read app-data files.
/// Falls back to a random key file when no OS keystore is available at runtime.
///
/// Test builds skip the OS keystore entirely: CI runners and sandboxed/unsigned
/// test binaries can't reliably obtain keychain access (may prompt, silently
/// deny, or behave inconsistently across calls), which would make tests flaky.
#[cfg(test)]
pub fn get_or_create_key(_account: &str, fallback_filename: &str) -> [u8; 32] {
    get_or_create_fallback_key(fallback_filename)
}

#[cfg(not(test))]
pub fn get_or_create_key(account: &str, fallback_filename: &str) -> [u8; 32] {
    if let Ok(entry) = Entry::new(SERVICE_NAME, account) {
        if let Ok(existing) = entry.get_password() {
            if let Some(key) = from_hex(existing.trim()) {
                return key;
            }
        }

        let new_key: [u8; 32] = ChaCha20Poly1305::generate_key(&mut OsRng).into();
        if entry.set_password(&to_hex(&new_key)).is_ok() {
            return new_key;
        }
    }

    get_or_create_fallback_key(fallback_filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hex_roundtrip() {
        let key: [u8; 32] = ChaCha20Poly1305::generate_key(&mut OsRng).into();
        let encoded = to_hex(&key);
        assert_eq!(encoded.len(), 64);
        assert_eq!(from_hex(&encoded), Some(key));
    }

    #[test]
    fn test_from_hex_rejects_malformed_input() {
        assert_eq!(from_hex("too_short"), None);
        assert_eq!(from_hex(&"zz".repeat(32)), None);
    }

    #[test]
    fn test_fallback_key_is_stable_across_calls() {
        let filename = format!("test_fallback_key_{}.hex", std::process::id());
        let k1 = get_or_create_fallback_key(&filename);
        let k2 = get_or_create_fallback_key(&filename);
        assert_eq!(k1, k2);
        let _ = fs::remove_file(fallback_key_path(&filename));
    }
}
