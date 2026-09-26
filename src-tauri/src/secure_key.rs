use crate::storage::get_storage_dir;
use chacha20poly1305::aead::{KeyInit, OsRng};
use chacha20poly1305::ChaCha20Poly1305;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[cfg(not(test))]
use keyring::Entry;

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

/// Where the encryption key for a logical account came from (never logs key material).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeySource {
    /// Retrieved from the OS-native secure keystore.
    Keychain,
    /// Loaded from (or written to) the app-data fallback key file.
    FallbackFile,
    /// Freshly generated because neither keystore nor fallback had a key.
    NewKeyCreated,
}

impl KeySource {
    fn as_log_label(self) -> &'static str {
        match self {
            KeySource::Keychain => "keychain",
            KeySource::FallbackFile => "fallback file",
            KeySource::NewKeyCreated => "new key created",
        }
    }
}

/// Result of classifying a keystore `get_password` outcome.
/// Factored out so NoEntry-vs-other-error behaviour is unit-testable without a
/// real OS keychain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeystoreGetOutcome {
    /// A valid 32-byte hex key was present in the keystore.
    Found([u8; 32]),
    /// Keystore reports no credential for this account — safe to create or migrate.
    NoEntry,
    /// Any other failure (access denied, locked keychain, bad hex, platform error).
    /// Must NOT overwrite whatever may still be stored in the keystore.
    Unavailable(String),
}

/// Next action after classifying the keystore lookup (and optional fallback file).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyResolution {
    UseKeystoreKey([u8; 32]),
    /// Fallback file holds a stable key; migrate it into the keystore.
    MigrateFallbackToKeystore([u8; 32]),
    /// Neither keystore nor fallback has a key — generate and store a new one.
    CreateNewInKeystore,
    /// Keystore is broken/locked/denied — keep using the fallback file path only.
    UseFallbackOnly {
        reason: String,
    },
}

/// Classifies a keystore get result. Only `NoEntry` authorises creating a new key.
pub fn classify_keystore_get(result: Result<String, keyring::Error>) -> KeystoreGetOutcome {
    match result {
        Ok(password) => match from_hex(password.trim()) {
            Some(key) => KeystoreGetOutcome::Found(key),
            None => {
                KeystoreGetOutcome::Unavailable("stored key is not valid 64-char hex".to_string())
            }
        },
        Err(keyring::Error::NoEntry) => KeystoreGetOutcome::NoEntry,
        Err(e) => KeystoreGetOutcome::Unavailable(e.to_string()),
    }
}

/// Pure decision function: never silently replace an existing keystore entry.
pub fn resolve_key_action(
    outcome: KeystoreGetOutcome,
    existing_fallback: Option<[u8; 32]>,
) -> KeyResolution {
    match outcome {
        KeystoreGetOutcome::Found(key) => KeyResolution::UseKeystoreKey(key),
        KeystoreGetOutcome::NoEntry => match existing_fallback {
            Some(key) => KeyResolution::MigrateFallbackToKeystore(key),
            None => KeyResolution::CreateNewInKeystore,
        },
        KeystoreGetOutcome::Unavailable(reason) => KeyResolution::UseFallbackOnly { reason },
    }
}

/// Returns true when the linked default keyring backend persists across process
/// restarts (i.e. is not the in-memory mock store).
pub fn keystore_is_persistent() -> bool {
    use keyring::credential::CredentialPersistence;
    !matches!(
        keyring::default::default_credential_builder().persistence(),
        CredentialPersistence::EntryOnly | CredentialPersistence::ProcessOnly
    )
}

fn read_existing_fallback(fallback_filename: &str) -> Option<[u8; 32]> {
    let path = fallback_key_path(fallback_filename);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| from_hex(s.trim()))
}

/// Last-resort key storage for environments without an OS keychain/Secret Service
/// daemon available (e.g. minimal Linux setups, some CI/sandbox environments).
/// The key is a genuine random 256-bit value (not derived from any public or
/// guessable input), stored with owner-only file permissions where supported.
fn get_or_create_fallback_key(fallback_filename: &str) -> [u8; 32] {
    if let Some(key) = read_existing_fallback(fallback_filename) {
        return key;
    }

    let path = fallback_key_path(fallback_filename);
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

fn log_key_source_once(account: &str, source: KeySource) {
    static LOGGED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
    let mut guard = LOGGED.lock().unwrap_or_else(|e| e.into_inner());
    let set = guard.get_or_insert_with(HashSet::new);
    if set.insert(account.to_string()) {
        eprintln!(
            "🔐 EchoMind key source for '{}': {}",
            account,
            source.as_log_label()
        );
    }
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
    if !keystore_is_persistent() {
        eprintln!(
            "⚠️ OS keystore is mock/non-persistent; using stable fallback file for '{}'",
            account
        );
        let key = get_or_create_fallback_key(fallback_filename);
        log_key_source_once(account, KeySource::FallbackFile);
        return key;
    }

    let entry = match Entry::new(SERVICE_NAME, account) {
        Ok(e) => e,
        Err(e) => {
            eprintln!(
                "⚠️ Keystore entry create failed for '{}': {}; using fallback file",
                account, e
            );
            let key = get_or_create_fallback_key(fallback_filename);
            log_key_source_once(account, KeySource::FallbackFile);
            return key;
        }
    };

    let outcome = classify_keystore_get(entry.get_password());
    let existing_fallback = read_existing_fallback(fallback_filename);
    match resolve_key_action(outcome, existing_fallback) {
        KeyResolution::UseKeystoreKey(key) => {
            log_key_source_once(account, KeySource::Keychain);
            key
        }
        KeyResolution::MigrateFallbackToKeystore(key) => {
            match entry.set_password(&to_hex(&key)) {
                Ok(()) => {
                    eprintln!(
                        "ℹ️ Migrated existing fallback key into OS keystore for '{}'",
                        account
                    );
                    log_key_source_once(account, KeySource::Keychain);
                }
                Err(e) => {
                    eprintln!(
                        "⚠️ Could not migrate fallback key to keystore for '{}': {}; keeping fallback file",
                        account, e
                    );
                    log_key_source_once(account, KeySource::FallbackFile);
                }
            }
            key
        }
        KeyResolution::CreateNewInKeystore => {
            let new_key: [u8; 32] = ChaCha20Poly1305::generate_key(&mut OsRng).into();
            match entry.set_password(&to_hex(&new_key)) {
                Ok(()) => {
                    log_key_source_once(account, KeySource::NewKeyCreated);
                    new_key
                }
                Err(e) => {
                    eprintln!(
                        "⚠️ Keystore set failed for '{}': {}; using stable fallback file",
                        account, e
                    );
                    let key = get_or_create_fallback_key(fallback_filename);
                    log_key_source_once(account, KeySource::FallbackFile);
                    key
                }
            }
        }
        KeyResolution::UseFallbackOnly { reason } => {
            eprintln!(
                "⚠️ Keystore read failed for '{}' ({}). NOT replacing any stored key; using fallback file.",
                account, reason
            );
            let key = get_or_create_fallback_key(fallback_filename);
            log_key_source_once(account, KeySource::FallbackFile);
            key
        }
    }
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

    #[test]
    fn test_classify_no_entry_vs_other_errors() {
        assert_eq!(
            classify_keystore_get(Err(keyring::Error::NoEntry)),
            KeystoreGetOutcome::NoEntry
        );

        let other = classify_keystore_get(Err(keyring::Error::Invalid(
            "service".into(),
            "denied".into(),
        )));
        assert!(matches!(other, KeystoreGetOutcome::Unavailable(_)));

        let bad_hex = classify_keystore_get(Ok("not-valid-hex".into()));
        assert!(matches!(bad_hex, KeystoreGetOutcome::Unavailable(_)));

        let key: [u8; 32] = ChaCha20Poly1305::generate_key(&mut OsRng).into();
        assert_eq!(
            classify_keystore_get(Ok(to_hex(&key))),
            KeystoreGetOutcome::Found(key)
        );
    }

    #[test]
    fn test_resolve_only_creates_new_key_on_no_entry_without_fallback() {
        let key: [u8; 32] = ChaCha20Poly1305::generate_key(&mut OsRng).into();

        assert_eq!(
            resolve_key_action(KeystoreGetOutcome::Found(key), None),
            KeyResolution::UseKeystoreKey(key)
        );
        assert_eq!(
            resolve_key_action(KeystoreGetOutcome::NoEntry, None),
            KeyResolution::CreateNewInKeystore
        );
        assert_eq!(
            resolve_key_action(KeystoreGetOutcome::NoEntry, Some(key)),
            KeyResolution::MigrateFallbackToKeystore(key)
        );

        let denied = resolve_key_action(
            KeystoreGetOutcome::Unavailable("access denied".into()),
            Some(key),
        );
        assert!(matches!(
            &denied,
            KeyResolution::UseFallbackOnly { reason } if reason == "access denied"
        ));
        // Critically: Unavailable must NEVER become CreateNewInKeystore.
        assert!(!matches!(denied, KeyResolution::CreateNewInKeystore));
    }

    #[test]
    fn test_fallback_migration_prefers_existing_file_over_new_key() {
        let filename = format!("test_migrate_fallback_{}.hex", std::process::id());
        let existing = get_or_create_fallback_key(&filename);
        let read_back = read_existing_fallback(&filename);
        assert_eq!(read_back, Some(existing));

        let action = resolve_key_action(KeystoreGetOutcome::NoEntry, read_back);
        assert_eq!(action, KeyResolution::MigrateFallbackToKeystore(existing));

        let _ = fs::remove_file(fallback_key_path(&filename));
    }

    #[test]
    fn test_default_keystore_is_not_mock_store() {
        // Runtime guard: with apple-native / windows-native / sync-secret-service
        // enabled, the default credential builder must not be the in-memory mock
        // (CredentialPersistence::EntryOnly). If this fails, Cargo.toml lost its
        // platform features and every launch would rotate encryption keys again.
        assert!(
            keystore_is_persistent(),
            "default keyring credential builder must not be the mock/in-memory store; \
             enable apple-native / windows-native / sync-secret-service in Cargo.toml"
        );
    }
}
