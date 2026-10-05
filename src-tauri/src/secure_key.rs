use crate::storage::get_storage_dir;
use chacha20poly1305::aead::{KeyInit, OsRng};
use chacha20poly1305::ChaCha20Poly1305;
use std::collections::HashMap;
#[cfg(not(test))]
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

#[cfg(not(test))]
use keyring::Entry;

#[cfg(not(test))]
const SERVICE_NAME: &str = "com.echomind.assistant";

/// Single OS keystore item holding both encryption keys (one unlock prompt).
pub const MASTER_KEY_ACCOUNT: &str = "master_key";

/// Logical accounts whose keys are primed during async storage unlock.
pub const DATA_AT_REST_ACCOUNT: &str = "data_at_rest_key";
pub const DATA_AT_REST_FALLBACK: &str = "storage.key";
pub const CREDENTIAL_VAULT_ACCOUNT: &str = "credential_vault_key";
pub const CREDENTIAL_VAULT_FALLBACK: &str = "vault.key";

/// Stable error / IPC sentinel while Keychain (or other keystore) I/O is in flight.
pub const STORAGE_NOT_READY: &str = "storage_not_ready";

/// Stable error / IPC sentinel when the keystore refused access (denied or
/// dismissed prompt, locked keychain): nothing is decrypted or written until
/// the user retries.
pub const STORAGE_LOCKED: &str = "storage_locked";

/// Unlock lifecycle for OS keystore reads that may block (macOS Keychain prompt).
/// Kept off the UI/main thread via [`crate::storage::start_storage_unlock`].
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyUnlockPhase {
    /// Async unlock has not been started (tests / sync fallback path).
    NotStarted = 0,
    /// Background thread is resolving keys — never call keystore on the caller thread.
    InProgress = 1,
    /// Keys are cached and encrypted storage may be used.
    Ready = 2,
    /// The keystore refused access. No key was created; storage stays closed
    /// until [`begin_key_unlock`] is called again (retry).
    Locked = 3,
}

fn unlock_phase_cell() -> &'static AtomicU8 {
    static PHASE: AtomicU8 = AtomicU8::new(KeyUnlockPhase::NotStarted as u8);
    &PHASE
}

fn quit_requested_cell() -> &'static AtomicBool {
    static QUIT: AtomicBool = AtomicBool::new(false);
    &QUIT
}

fn key_cache() -> &'static Mutex<HashMap<String, [u8; 32]>> {
    static CACHE: OnceLock<Mutex<HashMap<String, [u8; 32]>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Returns a previously resolved key without touching the OS keystore.
pub fn try_get_cached_key(account: &str) -> Option<[u8; 32]> {
    key_cache()
        .lock()
        .ok()
        .and_then(|guard| guard.get(account).copied())
}

fn cache_key(account: &str, key: [u8; 32]) {
    if let Ok(mut guard) = key_cache().lock() {
        guard.insert(account.to_string(), key);
    }
}

#[cfg(not(test))]
fn cache_bundle(bundle: &KeyBundle) {
    cache_key(DATA_AT_REST_ACCOUNT, bundle.data_at_rest);
    cache_key(CREDENTIAL_VAULT_ACCOUNT, bundle.credential_vault);
}

pub fn key_unlock_phase() -> KeyUnlockPhase {
    match unlock_phase_cell().load(Ordering::SeqCst) {
        x if x == KeyUnlockPhase::InProgress as u8 => KeyUnlockPhase::InProgress,
        x if x == KeyUnlockPhase::Ready as u8 => KeyUnlockPhase::Ready,
        x if x == KeyUnlockPhase::Locked as u8 => KeyUnlockPhase::Locked,
        _ => KeyUnlockPhase::NotStarted,
    }
}

pub fn is_key_unlock_ready() -> bool {
    key_unlock_phase() == KeyUnlockPhase::Ready
}

pub fn is_key_unlock_in_progress() -> bool {
    key_unlock_phase() == KeyUnlockPhase::InProgress
}

/// Mark unlock as in-flight so encrypt/decrypt paths refuse to block on Keychain.
/// Returns false if unlock is already in flight or completed; a locked unlock
/// may start again (retry).
pub fn begin_key_unlock() -> bool {
    [KeyUnlockPhase::NotStarted, KeyUnlockPhase::Locked]
        .iter()
        .any(|from| {
            unlock_phase_cell()
                .compare_exchange(
                    *from as u8,
                    KeyUnlockPhase::InProgress as u8,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                )
                .is_ok()
        })
}

pub fn is_key_unlock_locked() -> bool {
    key_unlock_phase() == KeyUnlockPhase::Locked
}

/// The keystore refused access: storage stays closed until a retry.
pub fn mark_keys_locked() {
    unlock_phase_cell().store(KeyUnlockPhase::Locked as u8, Ordering::SeqCst);
}

pub fn mark_keys_ready() {
    unlock_phase_cell().store(KeyUnlockPhase::Ready as u8, Ordering::SeqCst);
}

/// Quit path: skip joining the unlock thread; callers must not block on Keychain.
pub fn request_quit_abort_unlock() {
    quit_requested_cell().store(true, Ordering::SeqCst);
}

pub fn quit_abort_requested() -> bool {
    quit_requested_cell().load(Ordering::SeqCst)
}

/// Resolve a key without blocking when async unlock is in progress.
///
/// - Cached → return immediately
/// - [`KeyUnlockPhase::InProgress`] and uncached → `Err(STORAGE_NOT_READY)`
/// - Otherwise → blocking [`get_or_create_key`] (tests / safety net before unlock starts)
pub fn resolve_key_nonblocking(account: &str, fallback_filename: &str) -> Result<[u8; 32], String> {
    if let Some(key) = try_get_cached_key(account) {
        return Ok(key);
    }
    if is_key_unlock_in_progress() {
        return Err(STORAGE_NOT_READY.to_string());
    }
    if is_key_unlock_locked() {
        return Err(STORAGE_LOCKED.to_string());
    }
    try_get_or_create_key(account, fallback_filename)
}

#[cfg(test)]
pub fn reset_key_unlock_state_for_test() {
    unlock_phase_cell().store(KeyUnlockPhase::NotStarted as u8, Ordering::SeqCst);
    quit_requested_cell().store(false, Ordering::SeqCst);
    if let Ok(mut guard) = key_cache().lock() {
        guard.clear();
    }
}

/// Serializes tests that mutate the process-global unlock phase / key cache.
#[cfg(test)]
pub fn key_unlock_test_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Best-effort scrub of a secret string before drop (no key material in logs/heaps longer than needed).
fn scrub_secret_string(s: &mut String) {
    // SAFETY: we overwrite the UTF-8 bytes with zeros then clear; String is left empty/valid.
    let len = s.len();
    if len > 0 {
        unsafe {
            let bytes = s.as_mut_vec();
            for b in bytes.iter_mut() {
                *b = 0;
            }
        }
    }
    s.clear();
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
    pub fn as_log_label(self) -> &'static str {
        match self {
            KeySource::Keychain => "keychain",
            KeySource::FallbackFile => "fallback file",
            KeySource::NewKeyCreated => "new key created",
        }
    }

    pub fn used_fallback(self) -> bool {
        matches!(self, KeySource::FallbackFile)
    }
}

/// Both encryption keys packaged in one OS keystore item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyBundle {
    pub data_at_rest: [u8; 32],
    pub credential_vault: [u8; 32],
}

/// Versioned binary blob: `version (1) || data_at_rest (32) || credential_vault (32)`.
pub const KEY_BUNDLE_VERSION: u8 = 1;
pub const KEY_BUNDLE_LEN: usize = 1 + 32 + 32;

/// Encode both keys as a fixed-length binary blob for a single keystore secret.
/// Never log the returned bytes.
pub fn encode_key_bundle(bundle: &KeyBundle) -> Vec<u8> {
    let mut out = Vec::with_capacity(KEY_BUNDLE_LEN);
    out.push(KEY_BUNDLE_VERSION);
    out.extend_from_slice(&bundle.data_at_rest);
    out.extend_from_slice(&bundle.credential_vault);
    debug_assert_eq!(out.len(), KEY_BUNDLE_LEN);
    out
}

/// Parse a unified keystore blob. Strict length + version check; returns `None`
/// on any malformation (caller must treat as absent and never delete legacy).
pub fn decode_key_bundle(raw: &[u8]) -> Option<KeyBundle> {
    if raw.len() != KEY_BUNDLE_LEN {
        return None;
    }
    if raw[0] != KEY_BUNDLE_VERSION {
        return None;
    }
    let mut data_at_rest = [0u8; 32];
    let mut credential_vault = [0u8; 32];
    data_at_rest.copy_from_slice(&raw[1..33]);
    credential_vault.copy_from_slice(&raw[33..65]);
    Some(KeyBundle {
        data_at_rest,
        credential_vault,
    })
}

fn scrub_secret_bytes(buf: &mut [u8]) {
    for b in buf.iter_mut() {
        *b = 0;
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

/// Outcome of reading the unified `master_key` keystore item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnifiedKeystoreOutcome {
    Found(KeyBundle),
    /// Missing **or** corrupt/wrong-length blob (strict decode failed → yok say).
    NoEntry,
    /// Access denied or other platform failure — do not overwrite or delete.
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
    UseFallbackOnly { reason: String },
}

/// Where one half of the bundle should come from during migration planning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LegacyKeyMaterial {
    FromKeystore([u8; 32]),
    FromFallback([u8; 32]),
    /// Caller must generate a fresh random key.
    GenerateNew,
}

/// Pure migration decision for the unified `master_key` item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnifiedMigrationPlan {
    /// Unified item already holds both keys — use it (and optionally clean legacy).
    UseUnified {
        bundle: KeyBundle,
        /// Best-effort delete of leftover pre-migration accounts.
        cleanup_legacy: bool,
    },
    /// Build / write a unified item from legacy keystore entries and/or fallbacks.
    WriteUnified {
        data: LegacyKeyMaterial,
        vault: LegacyKeyMaterial,
    },
    /// Keystore unusable — caller must use per-account fallback files only.
    FallbackOnly { reason: String },
}

/// Classifies a keystore get result. Only `NoEntry` authorises creating a new key.
pub fn classify_keystore_get(result: Result<String, keyring::Error>) -> KeystoreGetOutcome {
    match result {
        Ok(mut password) => {
            let outcome = match from_hex(password.trim()) {
                Some(key) => KeystoreGetOutcome::Found(key),
                None => KeystoreGetOutcome::Unavailable(
                    "stored key is not valid 64-char hex".to_string(),
                ),
            };
            scrub_secret_string(&mut password);
            outcome
        }
        Err(keyring::Error::NoEntry) => KeystoreGetOutcome::NoEntry,
        Err(e) => KeystoreGetOutcome::Unavailable(e.to_string()),
    }
}

/// Classifies a unified `master_key` get_secret result.
///
/// Corrupt / wrong-length blobs are treated as [`UnifiedKeystoreOutcome::NoEntry`]
/// ("yok say") so migration may rewrite them — but callers must never delete
/// legacy entries until a newly written blob verifies byte-for-byte.
pub fn classify_unified_keystore_get(
    result: Result<Vec<u8>, keyring::Error>,
) -> UnifiedKeystoreOutcome {
    match result {
        Ok(mut secret) => {
            let outcome = match decode_key_bundle(&secret) {
                Some(bundle) => UnifiedKeystoreOutcome::Found(bundle),
                // Strict length/version failure → treat as absent, do not use.
                None => UnifiedKeystoreOutcome::NoEntry,
            };
            scrub_secret_bytes(&mut secret);
            outcome
        }
        Err(keyring::Error::NoEntry) => UnifiedKeystoreOutcome::NoEntry,
        Err(e) => UnifiedKeystoreOutcome::Unavailable(e.to_string()),
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

fn legacy_material_from(
    outcome: KeystoreGetOutcome,
    fallback: Option<[u8; 32]>,
) -> Result<LegacyKeyMaterial, String> {
    match outcome {
        KeystoreGetOutcome::Found(key) => Ok(LegacyKeyMaterial::FromKeystore(key)),
        KeystoreGetOutcome::NoEntry => match fallback {
            Some(key) => Ok(LegacyKeyMaterial::FromFallback(key)),
            None => Ok(LegacyKeyMaterial::GenerateNew),
        },
        KeystoreGetOutcome::Unavailable(reason) => Err(reason),
    }
}

/// Decide how to obtain both encryption keys with a single keystore item.
///
/// Critical invariants:
/// - Never invent a new key while an unreadable keystore entry may still exist.
/// - Prefer an existing unified blob over re-reading legacy accounts.
/// - When unified is missing, package existing legacy keys (do not derive/rotate).
pub fn plan_unified_migration(
    unified: UnifiedKeystoreOutcome,
    legacy_data: KeystoreGetOutcome,
    legacy_vault: KeystoreGetOutcome,
    fallback_data: Option<[u8; 32]>,
    fallback_vault: Option<[u8; 32]>,
) -> UnifiedMigrationPlan {
    match unified {
        UnifiedKeystoreOutcome::Found(bundle) => UnifiedMigrationPlan::UseUnified {
            bundle,
            cleanup_legacy: true,
        },
        UnifiedKeystoreOutcome::Unavailable(reason) => {
            UnifiedMigrationPlan::FallbackOnly { reason }
        }
        UnifiedKeystoreOutcome::NoEntry => {
            let data = match legacy_material_from(legacy_data, fallback_data) {
                Ok(m) => m,
                Err(reason) => return UnifiedMigrationPlan::FallbackOnly { reason },
            };
            let vault = match legacy_material_from(legacy_vault, fallback_vault) {
                Ok(m) => m,
                Err(reason) => return UnifiedMigrationPlan::FallbackOnly { reason },
            };
            UnifiedMigrationPlan::WriteUnified { data, vault }
        }
    }
}

fn materialize_legacy(material: LegacyKeyMaterial) -> ([u8; 32], KeySource, bool) {
    match material {
        LegacyKeyMaterial::FromKeystore(key) => (key, KeySource::Keychain, true),
        LegacyKeyMaterial::FromFallback(key) => (key, KeySource::FallbackFile, false),
        LegacyKeyMaterial::GenerateNew => {
            let key: [u8; 32] = ChaCha20Poly1305::generate_key(&mut OsRng).into();
            (key, KeySource::NewKeyCreated, false)
        }
    }
}

/// Minimal keystore surface used by unified resolution (real OS backend or test mock).
pub trait KeystoreBackend {
    /// Legacy per-account hex keys (string password field).
    fn get_password(&self, account: &str) -> Result<String, keyring::Error>;
    fn set_password(&self, account: &str, password: &str) -> Result<(), keyring::Error>;
    /// Unified `master_key` binary blob (secret field).
    fn get_secret(&self, account: &str) -> Result<Vec<u8>, keyring::Error>;
    fn set_secret(&self, account: &str, secret: &[u8]) -> Result<(), keyring::Error>;
    fn delete(&self, account: &str) -> Result<(), keyring::Error>;
}

fn best_effort_delete_legacy<K: KeystoreBackend>(ks: &K, account: &str) {
    match ks.delete(account) {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => {
            // Never crash on cleanup; never log key material.
            eprintln!(
                "⚠️ Could not delete legacy keystore entry '{}': {}",
                account, e
            );
        }
    }
}

/// Result of resolving both keys via the unified `master_key` flow.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnifiedResolveSuccess {
    pub bundle: KeyBundle,
    pub data_source: KeySource,
    pub vault_source: KeySource,
}

/// Execute the unified key plan against a keystore backend.
///
/// On `Ok`, both keys are ready to cache. On `Err`, migration was aborted
/// (denied / unreadable legacy / keystore broken) — caller must resolve each
/// managed account independently and must not have modified legacy entries.
pub fn execute_unified_migration<K: KeystoreBackend>(
    ks: &K,
    fallback_data: Option<[u8; 32]>,
    fallback_vault: Option<[u8; 32]>,
) -> Result<UnifiedResolveSuccess, String> {
    let unified = classify_unified_keystore_get(ks.get_secret(MASTER_KEY_ACCOUNT));

    // Only touch legacy accounts when unified is missing/corrupt — avoids extra
    // prompts on the steady-state path after migration.
    let (legacy_data, legacy_vault) = match &unified {
        UnifiedKeystoreOutcome::NoEntry => (
            classify_keystore_get(ks.get_password(DATA_AT_REST_ACCOUNT)),
            classify_keystore_get(ks.get_password(CREDENTIAL_VAULT_ACCOUNT)),
        ),
        UnifiedKeystoreOutcome::Found(_) | UnifiedKeystoreOutcome::Unavailable(_) => {
            (KeystoreGetOutcome::NoEntry, KeystoreGetOutcome::NoEntry)
        }
    };

    let plan = plan_unified_migration(
        unified,
        legacy_data,
        legacy_vault,
        fallback_data,
        fallback_vault,
    );

    match plan {
        UnifiedMigrationPlan::UseUnified {
            bundle,
            cleanup_legacy,
        } => {
            if cleanup_legacy {
                best_effort_delete_legacy(ks, DATA_AT_REST_ACCOUNT);
                best_effort_delete_legacy(ks, CREDENTIAL_VAULT_ACCOUNT);
            }
            Ok(UnifiedResolveSuccess {
                bundle,
                data_source: KeySource::Keychain,
                vault_source: KeySource::Keychain,
            })
        }
        UnifiedMigrationPlan::FallbackOnly { reason } => Err(reason),
        UnifiedMigrationPlan::WriteUnified { data, vault } => {
            let (data_key, data_src, data_from_ks) = materialize_legacy(data);
            let (vault_key, vault_src, vault_from_ks) = materialize_legacy(vault);
            let bundle = KeyBundle {
                data_at_rest: data_key,
                credential_vault: vault_key,
            };

            let mut encoded = encode_key_bundle(&bundle);
            let set_result = ks.set_secret(MASTER_KEY_ACCOUNT, &encoded);
            scrub_secret_bytes(&mut encoded);

            match set_result {
                Ok(()) => {
                    // Read back and compare byte-for-byte with what we intended.
                    let verified = match ks.get_secret(MASTER_KEY_ACCOUNT) {
                        Ok(mut read_back) => {
                            let expected = encode_key_bundle(&bundle);
                            let ok = read_back.as_slice() == expected.as_slice();
                            scrub_secret_bytes(&mut read_back);
                            ok
                        }
                        Err(_) => false,
                    };

                    if verified {
                        // Only delete legacy after verified unified write.
                        if data_from_ks {
                            best_effort_delete_legacy(ks, DATA_AT_REST_ACCOUNT);
                        }
                        if vault_from_ks {
                            best_effort_delete_legacy(ks, CREDENTIAL_VAULT_ACCOUNT);
                        }
                    } else {
                        eprintln!(
                            "⚠️ Unified master_key write could not be verified; \
                             leaving legacy keystore entries intact"
                        );
                    }

                    let data_source = match data_src {
                        KeySource::NewKeyCreated => KeySource::NewKeyCreated,
                        KeySource::FallbackFile | KeySource::Keychain => KeySource::Keychain,
                    };
                    let vault_source = match vault_src {
                        KeySource::NewKeyCreated => KeySource::NewKeyCreated,
                        KeySource::FallbackFile | KeySource::Keychain => KeySource::Keychain,
                    };
                    Ok(UnifiedResolveSuccess {
                        bundle,
                        data_source,
                        vault_source,
                    })
                }
                Err(e) => {
                    // Could not create unified item — never delete legacy.
                    if matches!(data_src, KeySource::NewKeyCreated)
                        || matches!(vault_src, KeySource::NewKeyCreated)
                    {
                        return Err(format!(
                            "could not write unified master_key ({e}); resolve independently"
                        ));
                    }
                    // Both keys came from legacy keystore and/or fallback files —
                    // safe to use without unified write; retry migration next launch.
                    eprintln!(
                        "⚠️ Could not write unified master_key ({}); using existing keys for this session",
                        e
                    );
                    Ok(UnifiedResolveSuccess {
                        bundle,
                        data_source: data_src,
                        vault_source: vault_src,
                    })
                }
            }
        }
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

#[cfg(not(test))]
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

fn is_managed_account(account: &str) -> bool {
    account == DATA_AT_REST_ACCOUNT || account == CREDENTIAL_VAULT_ACCOUNT
}

/// Resolve and cache both managed encryption keys, preferring a single keystore item.
/// Returns the data-at-rest key source (used for history-recovery UI).
///
/// `Err` when the keystore holds (or may hold) keys it would not hand over —
/// a denied or dismissed prompt, a locked keychain. No key is created then:
/// a fresh key cannot open the existing history, and the app used to start
/// with an empty history and set the real one aside as `.corrupt-*`.
#[cfg(not(test))]
pub fn prime_encryption_keys() -> Result<KeySource, String> {
    if try_get_cached_key(DATA_AT_REST_ACCOUNT).is_some()
        && try_get_cached_key(CREDENTIAL_VAULT_ACCOUNT).is_some()
    {
        return Ok(KeySource::Keychain);
    }

    if !keystore_is_persistent() {
        eprintln!(
            "⚠️ OS keystore is mock/non-persistent; using stable fallback files for managed keys"
        );
        let data = get_or_create_fallback_key(DATA_AT_REST_FALLBACK);
        let vault = get_or_create_fallback_key(CREDENTIAL_VAULT_FALLBACK);
        cache_key(DATA_AT_REST_ACCOUNT, data);
        cache_key(CREDENTIAL_VAULT_ACCOUNT, vault);
        log_key_source_once(DATA_AT_REST_ACCOUNT, KeySource::FallbackFile);
        log_key_source_once(CREDENTIAL_VAULT_ACCOUNT, KeySource::FallbackFile);
        return Ok(KeySource::FallbackFile);
    }

    let ks = OsKeystore;
    match execute_unified_migration(
        &ks,
        read_existing_fallback(DATA_AT_REST_FALLBACK),
        read_existing_fallback(CREDENTIAL_VAULT_FALLBACK),
    ) {
        Ok(success) => {
            cache_bundle(&success.bundle);
            log_key_source_once(DATA_AT_REST_ACCOUNT, success.data_source);
            log_key_source_once(CREDENTIAL_VAULT_ACCOUNT, success.vault_source);
            Ok(success.data_source)
        }
        Err(reason) => {
            // The keystore would not hand over an entry that exists or may
            // exist. Never fall back to creating keys here (see above).
            eprintln!(
                "⚠️ Keychain access refused ({reason}). No key created; secure storage stays \
                 locked until retried."
            );
            Err(reason)
        }
    }
}

#[cfg(test)]
pub fn prime_encryption_keys() -> Result<KeySource, String> {
    let data = get_or_create_fallback_key(DATA_AT_REST_FALLBACK);
    let vault = get_or_create_fallback_key(CREDENTIAL_VAULT_FALLBACK);
    cache_key(DATA_AT_REST_ACCOUNT, data);
    cache_key(CREDENTIAL_VAULT_ACCOUNT, vault);
    Ok(KeySource::FallbackFile)
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
/// Managed accounts (`data_at_rest_key` / `credential_vault_key`) share a single
/// `master_key` keystore item so macOS prompts at most once per unlock.
///
/// Test builds skip the OS keystore entirely: CI runners and sandboxed/unsigned
/// test binaries can't reliably obtain keychain access (may prompt, silently
/// deny, or behave inconsistently across calls), which would make tests flaky.
#[cfg(test)]
pub fn get_or_create_key(account: &str, fallback_filename: &str) -> [u8; 32] {
    get_or_create_key_with_source(account, fallback_filename).0
}

#[cfg(test)]
pub fn get_or_create_key_with_source(
    account: &str,
    fallback_filename: &str,
) -> ([u8; 32], KeySource) {
    if let Some(key) = try_get_cached_key(account) {
        return (key, KeySource::FallbackFile);
    }
    if is_managed_account(account) {
        let _ = prime_encryption_keys();
        if let Some(key) = try_get_cached_key(account) {
            return (key, KeySource::FallbackFile);
        }
    }
    let key = get_or_create_fallback_key(fallback_filename);
    cache_key(account, key);
    (key, KeySource::FallbackFile)
}

/// Resolves (and caches) a key. Managed accounts come from the single
/// keystore item; when the keystore refuses access this is an error — never a
/// newly created key that cannot open existing data.
#[cfg(not(test))]
pub fn try_get_or_create_key(account: &str, fallback_filename: &str) -> Result<[u8; 32], String> {
    if let Some(key) = try_get_cached_key(account) {
        return Ok(key);
    }
    if is_managed_account(account) {
        prime_encryption_keys()?;
        return try_get_cached_key(account)
            .ok_or_else(|| format!("key for '{account}' missing after unlock"));
    }
    Ok(resolve_single_account(account, fallback_filename).0)
}

#[cfg(test)]
pub fn try_get_or_create_key(account: &str, fallback_filename: &str) -> Result<[u8; 32], String> {
    Ok(get_or_create_key(account, fallback_filename))
}

/// Pre-unification per-account keystore resolve (also used when unified migration aborts).
#[cfg(not(test))]
fn resolve_single_account(account: &str, fallback_filename: &str) -> ([u8; 32], KeySource) {
    if !keystore_is_persistent() {
        eprintln!(
            "⚠️ OS keystore is mock/non-persistent; using stable fallback file for '{}'",
            account
        );
        let key = get_or_create_fallback_key(fallback_filename);
        cache_key(account, key);
        log_key_source_once(account, KeySource::FallbackFile);
        return (key, KeySource::FallbackFile);
    }

    let entry = match Entry::new(SERVICE_NAME, account) {
        Ok(e) => e,
        Err(e) => {
            eprintln!(
                "⚠️ Keystore entry create failed for '{}': {}; using fallback file",
                account, e
            );
            let key = get_or_create_fallback_key(fallback_filename);
            cache_key(account, key);
            log_key_source_once(account, KeySource::FallbackFile);
            return (key, KeySource::FallbackFile);
        }
    };

    let outcome = classify_keystore_get(entry.get_password());
    let existing_fallback = read_existing_fallback(fallback_filename);
    let (key, source) = match resolve_key_action(outcome, existing_fallback) {
        KeyResolution::UseKeystoreKey(key) => (key, KeySource::Keychain),
        KeyResolution::MigrateFallbackToKeystore(key) => {
            let source = match entry.set_password(&to_hex(&key)) {
                Ok(()) => {
                    eprintln!(
                        "ℹ️ Migrated existing fallback key into OS keystore for '{}'",
                        account
                    );
                    KeySource::Keychain
                }
                Err(e) => {
                    eprintln!(
                        "⚠️ Could not migrate fallback key to keystore for '{}': {}; keeping fallback file",
                        account, e
                    );
                    KeySource::FallbackFile
                }
            };
            (key, source)
        }
        KeyResolution::CreateNewInKeystore => {
            let new_key: [u8; 32] = ChaCha20Poly1305::generate_key(&mut OsRng).into();
            match entry.set_password(&to_hex(&new_key)) {
                Ok(()) => (new_key, KeySource::NewKeyCreated),
                Err(e) => {
                    eprintln!(
                        "⚠️ Keystore set failed for '{}': {}; using stable fallback file",
                        account, e
                    );
                    (
                        get_or_create_fallback_key(fallback_filename),
                        KeySource::FallbackFile,
                    )
                }
            }
        }
        KeyResolution::UseFallbackOnly { reason } => {
            eprintln!(
                "⚠️ Keystore read failed for '{}' ({}). NOT replacing any stored key; using fallback file.",
                account, reason
            );
            (
                get_or_create_fallback_key(fallback_filename),
                KeySource::FallbackFile,
            )
        }
    };

    cache_key(account, key);
    log_key_source_once(account, source);
    (key, source)
}

#[cfg(not(test))]
struct OsKeystore;

#[cfg(not(test))]
impl KeystoreBackend for OsKeystore {
    fn get_password(&self, account: &str) -> Result<String, keyring::Error> {
        Entry::new(SERVICE_NAME, account)?.get_password()
    }

    fn set_password(&self, account: &str, password: &str) -> Result<(), keyring::Error> {
        Entry::new(SERVICE_NAME, account)?.set_password(password)
    }

    fn get_secret(&self, account: &str) -> Result<Vec<u8>, keyring::Error> {
        Entry::new(SERVICE_NAME, account)?.get_secret()
    }

    fn set_secret(&self, account: &str, secret: &[u8]) -> Result<(), keyring::Error> {
        Entry::new(SERVICE_NAME, account)?.set_secret(secret)
    }

    fn delete(&self, account: &str) -> Result<(), keyring::Error> {
        Entry::new(SERVICE_NAME, account)?.delete_credential()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashSet;

    #[derive(Default)]
    struct MockKeystore {
        /// Binary secrets keyed by account (legacy hex stored as UTF-8 bytes).
        entries: RefCell<HashMap<String, Vec<u8>>>,
        /// Accounts that return Unavailable instead of their stored value / NoEntry.
        denied: RefCell<HashSet<String>>,
        /// When true, `set_secret` / `set_password` always fails.
        fail_set: RefCell<bool>,
        /// When true, `delete` always fails (non-NoEntry).
        fail_delete: RefCell<bool>,
        /// Count of get_secret/get_password calls per account.
        get_counts: RefCell<HashMap<String, usize>>,
    }

    impl MockKeystore {
        fn with_legacy(data: [u8; 32], vault: [u8; 32]) -> Self {
            let ks = Self::default();
            ks.entries.borrow_mut().insert(
                DATA_AT_REST_ACCOUNT.to_string(),
                to_hex(&data).into_bytes(),
            );
            ks.entries.borrow_mut().insert(
                CREDENTIAL_VAULT_ACCOUNT.to_string(),
                to_hex(&vault).into_bytes(),
            );
            ks
        }

        fn with_unified(bundle: &KeyBundle) -> Self {
            let ks = Self::default();
            ks.entries
                .borrow_mut()
                .insert(MASTER_KEY_ACCOUNT.to_string(), encode_key_bundle(bundle));
            ks
        }

        fn get_count(&self, account: &str) -> usize {
            self.get_counts
                .borrow()
                .get(account)
                .copied()
                .unwrap_or(0)
        }

        fn bump_get(&self, account: &str) {
            *self
                .get_counts
                .borrow_mut()
                .entry(account.to_string())
                .or_insert(0) += 1;
        }
    }

    impl KeystoreBackend for MockKeystore {
        fn get_password(&self, account: &str) -> Result<String, keyring::Error> {
            self.bump_get(account);
            if self.denied.borrow().contains(account) {
                return Err(keyring::Error::Invalid(
                    "service".into(),
                    "access denied".into(),
                ));
            }
            match self.entries.borrow().get(account) {
                Some(v) => String::from_utf8(v.clone()).map_err(|_| {
                    keyring::Error::Invalid("service".into(), "not utf-8".into())
                }),
                None => Err(keyring::Error::NoEntry),
            }
        }

        fn set_password(&self, account: &str, password: &str) -> Result<(), keyring::Error> {
            if *self.fail_set.borrow() {
                return Err(keyring::Error::Invalid(
                    "service".into(),
                    "set denied".into(),
                ));
            }
            self.entries
                .borrow_mut()
                .insert(account.to_string(), password.as_bytes().to_vec());
            Ok(())
        }

        fn get_secret(&self, account: &str) -> Result<Vec<u8>, keyring::Error> {
            self.bump_get(account);
            if self.denied.borrow().contains(account) {
                return Err(keyring::Error::Invalid(
                    "service".into(),
                    "access denied".into(),
                ));
            }
            match self.entries.borrow().get(account) {
                Some(v) => Ok(v.clone()),
                None => Err(keyring::Error::NoEntry),
            }
        }

        fn set_secret(&self, account: &str, secret: &[u8]) -> Result<(), keyring::Error> {
            if *self.fail_set.borrow() {
                return Err(keyring::Error::Invalid(
                    "service".into(),
                    "set denied".into(),
                ));
            }
            self.entries
                .borrow_mut()
                .insert(account.to_string(), secret.to_vec());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), keyring::Error> {
            if *self.fail_delete.borrow() {
                return Err(keyring::Error::Invalid(
                    "service".into(),
                    "delete denied".into(),
                ));
            }
            match self.entries.borrow_mut().remove(account) {
                Some(_) => Ok(()),
                None => Err(keyring::Error::NoEntry),
            }
        }
    }

    fn random_key() -> [u8; 32] {
        ChaCha20Poly1305::generate_key(&mut OsRng).into()
    }

    #[test]
    fn test_hex_roundtrip() {
        let key = random_key();
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
    fn test_key_bundle_binary_roundtrip() {
        let bundle = KeyBundle {
            data_at_rest: random_key(),
            credential_vault: random_key(),
        };
        let encoded = encode_key_bundle(&bundle);
        assert_eq!(encoded.len(), KEY_BUNDLE_LEN);
        assert_eq!(encoded[0], KEY_BUNDLE_VERSION);
        assert_eq!(decode_key_bundle(&encoded), Some(bundle));

        assert!(decode_key_bundle(&encoded[..64]).is_none());
        let mut too_long = encoded.clone();
        too_long.push(0);
        assert!(decode_key_bundle(&too_long).is_none());
        let mut bad_ver = encoded;
        bad_ver[0] = 0xFF;
        assert!(decode_key_bundle(&bad_ver).is_none());
        assert!(decode_key_bundle(b"not-a-bundle").is_none());
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

        let key = random_key();
        assert_eq!(
            classify_keystore_get(Ok(to_hex(&key))),
            KeystoreGetOutcome::Found(key)
        );
    }

    #[test]
    fn test_classify_unified_corrupt_is_treated_as_no_entry() {
        let bundle = KeyBundle {
            data_at_rest: random_key(),
            credential_vault: random_key(),
        };
        assert_eq!(
            classify_unified_keystore_get(Ok(encode_key_bundle(&bundle))),
            UnifiedKeystoreOutcome::Found(bundle)
        );
        assert_eq!(
            classify_unified_keystore_get(Err(keyring::Error::NoEntry)),
            UnifiedKeystoreOutcome::NoEntry
        );
        assert_eq!(
            classify_unified_keystore_get(Ok(vec![0u8; 10])),
            UnifiedKeystoreOutcome::NoEntry
        );
        assert_eq!(
            classify_unified_keystore_get(Ok(to_hex(&random_key()).into_bytes())),
            UnifiedKeystoreOutcome::NoEntry
        );
        assert!(matches!(
            classify_unified_keystore_get(Err(keyring::Error::Invalid(
                "service".into(),
                "denied".into()
            ))),
            UnifiedKeystoreOutcome::Unavailable(_)
        ));
    }

    #[test]
    fn test_resolve_only_creates_new_key_on_no_entry_without_fallback() {
        let key = random_key();

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
        assert!(
            keystore_is_persistent(),
            "default keyring credential builder must not be the mock/in-memory store; \
             enable apple-native / windows-native / sync-secret-service in Cargo.toml"
        );
    }

    #[test]
    fn test_resolve_key_nonblocking_returns_not_ready_while_unlock_in_progress() {
        let _lock = key_unlock_test_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_key_unlock_state_for_test();
        assert!(begin_key_unlock());
        assert_eq!(key_unlock_phase(), KeyUnlockPhase::InProgress);

        let account = format!("test_not_ready_{}", std::process::id());
        let fallback = format!("test_not_ready_{}.hex", std::process::id());
        let err = resolve_key_nonblocking(&account, &fallback).unwrap_err();
        assert_eq!(err, STORAGE_NOT_READY);

        let primed = get_or_create_key(&account, &fallback);
        assert_eq!(
            resolve_key_nonblocking(&account, &fallback).unwrap(),
            primed
        );

        mark_keys_ready();
        assert!(is_key_unlock_ready());
        assert_eq!(
            resolve_key_nonblocking(&account, &fallback).unwrap(),
            primed
        );

        let _ = fs::remove_file(fallback_key_path(&fallback));
        reset_key_unlock_state_for_test();
    }

    #[test]
    fn test_cached_key_stable_across_get_or_create_calls() {
        let _lock = key_unlock_test_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_key_unlock_state_for_test();
        let account = format!("test_cache_acct_{}", std::process::id());
        let fallback = format!("test_cache_file_{}.hex", std::process::id());
        let k1 = get_or_create_key(&account, &fallback);
        let k2 = get_or_create_key(&account, &fallback);
        assert_eq!(k1, k2);
        assert_eq!(try_get_cached_key(&account), Some(k1));
        let _ = fs::remove_file(fallback_key_path(&fallback));
        reset_key_unlock_state_for_test();
    }

    /// A denied/dismissed Keychain prompt on the existing master_key used to
    /// end in fresh keys and an empty history (real data set aside as
    /// `.corrupt-*`). The migration must fail and write nothing.
    #[test]
    fn test_denied_master_key_creates_and_writes_nothing() {
        let bundle = KeyBundle {
            data_at_rest: random_key(),
            credential_vault: random_key(),
        };
        let ks = MockKeystore::with_unified(&bundle);
        ks.denied.borrow_mut().insert(MASTER_KEY_ACCOUNT.to_string());
        let before = ks.entries.borrow().clone();

        assert!(execute_unified_migration(&ks, None, None).is_err());
        assert_eq!(*ks.entries.borrow(), before, "keystore must be untouched");
        assert_eq!(ks.get_count(DATA_AT_REST_ACCOUNT), 0, "no legacy fallback reads");
    }

    #[test]
    fn test_locked_unlock_refuses_keys_and_storage_until_retried() {
        let _lock = key_unlock_test_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_key_unlock_state_for_test();
        let account = "locked_test_account";
        assert!(begin_key_unlock());
        mark_keys_locked();
        assert!(is_key_unlock_locked());
        assert_eq!(
            resolve_key_nonblocking(account, "locked_test.key").unwrap_err(),
            STORAGE_LOCKED
        );
        assert_eq!(
            crate::storage::require_storage_ready().unwrap_err(),
            STORAGE_LOCKED
        );
        // Retry: unlock may start again from the locked state.
        assert!(begin_key_unlock());
        assert!(is_key_unlock_in_progress());
        reset_key_unlock_state_for_test();
    }

    #[test]
    fn test_begin_key_unlock_is_idempotent() {
        let _lock = key_unlock_test_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_key_unlock_state_for_test();
        assert!(begin_key_unlock());
        assert!(!begin_key_unlock());
        mark_keys_ready();
        assert!(!begin_key_unlock());
        reset_key_unlock_state_for_test();
    }

    #[test]
    fn test_plan_prefers_unified_over_legacy() {
        let bundle = KeyBundle {
            data_at_rest: random_key(),
            credential_vault: random_key(),
        };
        let other = random_key();
        let plan = plan_unified_migration(
            UnifiedKeystoreOutcome::Found(bundle),
            KeystoreGetOutcome::Found(other),
            KeystoreGetOutcome::Found(other),
            None,
            None,
        );
        assert_eq!(
            plan,
            UnifiedMigrationPlan::UseUnified {
                bundle,
                cleanup_legacy: true
            }
        );
    }

    #[test]
    fn test_plan_migrates_legacy_pair_into_write() {
        let data = random_key();
        let vault = random_key();
        let plan = plan_unified_migration(
            UnifiedKeystoreOutcome::NoEntry,
            KeystoreGetOutcome::Found(data),
            KeystoreGetOutcome::Found(vault),
            None,
            None,
        );
        assert_eq!(
            plan,
            UnifiedMigrationPlan::WriteUnified {
                data: LegacyKeyMaterial::FromKeystore(data),
                vault: LegacyKeyMaterial::FromKeystore(vault),
            }
        );
    }

    #[test]
    fn test_plan_unavailable_forces_fallback_only() {
        let plan = plan_unified_migration(
            UnifiedKeystoreOutcome::Unavailable("denied".into()),
            KeystoreGetOutcome::NoEntry,
            KeystoreGetOutcome::NoEntry,
            Some(random_key()),
            Some(random_key()),
        );
        assert!(matches!(
            plan,
            UnifiedMigrationPlan::FallbackOnly { reason } if reason == "denied"
        ));

        let plan2 = plan_unified_migration(
            UnifiedKeystoreOutcome::NoEntry,
            KeystoreGetOutcome::Unavailable("data locked".into()),
            KeystoreGetOutcome::NoEntry,
            Some(random_key()),
            None,
        );
        assert!(matches!(
            plan2,
            UnifiedMigrationPlan::FallbackOnly { reason } if reason == "data locked"
        ));
    }

    #[test]
    fn test_plan_generates_when_both_legacy_missing() {
        let plan = plan_unified_migration(
            UnifiedKeystoreOutcome::NoEntry,
            KeystoreGetOutcome::NoEntry,
            KeystoreGetOutcome::NoEntry,
            None,
            None,
        );
        assert_eq!(
            plan,
            UnifiedMigrationPlan::WriteUnified {
                data: LegacyKeyMaterial::GenerateNew,
                vault: LegacyKeyMaterial::GenerateNew,
            }
        );
    }

    #[test]
    fn test_plan_one_legacy_missing_generates_only_that_half() {
        let data = random_key();
        let plan = plan_unified_migration(
            UnifiedKeystoreOutcome::NoEntry,
            KeystoreGetOutcome::Found(data),
            KeystoreGetOutcome::NoEntry,
            None,
            None,
        );
        assert_eq!(
            plan,
            UnifiedMigrationPlan::WriteUnified {
                data: LegacyKeyMaterial::FromKeystore(data),
                vault: LegacyKeyMaterial::GenerateNew,
            }
        );
    }

    #[test]
    fn test_migrate_legacy_two_entries_to_unified_preserves_keys() {
        let data = random_key();
        let vault = random_key();
        let ks = MockKeystore::with_legacy(data, vault);

        let success = execute_unified_migration(&ks, None, None).expect("migrate");
        assert_eq!(success.bundle.data_at_rest, data);
        assert_eq!(success.bundle.credential_vault, vault);
        assert_eq!(success.data_source, KeySource::Keychain);

        assert!(ks.entries.borrow().contains_key(MASTER_KEY_ACCOUNT));
        assert!(!ks.entries.borrow().contains_key(DATA_AT_REST_ACCOUNT));
        assert!(!ks.entries.borrow().contains_key(CREDENTIAL_VAULT_ACCOUNT));

        let stored = ks.entries.borrow().get(MASTER_KEY_ACCOUNT).cloned().unwrap();
        assert_eq!(stored, encode_key_bundle(&success.bundle));
    }

    #[test]
    fn test_crash_after_write_before_delete_retries_safely() {
        let data = random_key();
        let vault = random_key();
        let bundle = KeyBundle {
            data_at_rest: data,
            credential_vault: vault,
        };

        let ks = MockKeystore::with_unified(&bundle);
        ks.entries.borrow_mut().insert(
            DATA_AT_REST_ACCOUNT.to_string(),
            to_hex(&data).into_bytes(),
        );
        ks.entries.borrow_mut().insert(
            CREDENTIAL_VAULT_ACCOUNT.to_string(),
            to_hex(&vault).into_bytes(),
        );

        let success = execute_unified_migration(&ks, None, None).expect("resume");
        assert_eq!(success.bundle, bundle);
        assert!(!ks.entries.borrow().contains_key(DATA_AT_REST_ACCOUNT));
        assert!(!ks.entries.borrow().contains_key(CREDENTIAL_VAULT_ACCOUNT));
        assert!(ks.entries.borrow().contains_key(MASTER_KEY_ACCOUNT));

        let ks2 = MockKeystore::with_unified(&bundle);
        let _ = execute_unified_migration(&ks2, None, None).unwrap();
        assert_eq!(ks2.get_count(MASTER_KEY_ACCOUNT), 1);
        assert_eq!(ks2.get_count(DATA_AT_REST_ACCOUNT), 0);
        assert_eq!(ks2.get_count(CREDENTIAL_VAULT_ACCOUNT), 0);
    }

    #[test]
    fn test_fresh_install_both_legacy_missing_creates_unified() {
        let ks = MockKeystore::default();
        let success = execute_unified_migration(&ks, None, None).expect("create");
        assert_ne!(success.bundle.data_at_rest, success.bundle.credential_vault);
        assert_eq!(success.data_source, KeySource::NewKeyCreated);
        assert_eq!(success.vault_source, KeySource::NewKeyCreated);

        let stored = ks.entries.borrow().get(MASTER_KEY_ACCOUNT).cloned().unwrap();
        assert_eq!(decode_key_bundle(&stored), Some(success.bundle));
        assert_eq!(stored.len(), KEY_BUNDLE_LEN);
        assert!(!ks.entries.borrow().contains_key(DATA_AT_REST_ACCOUNT));
        assert!(!ks.entries.borrow().contains_key(CREDENTIAL_VAULT_ACCOUNT));
    }

    #[test]
    fn test_one_legacy_missing_still_migrates() {
        let data = random_key();
        let ks = MockKeystore::default();
        ks.entries.borrow_mut().insert(
            DATA_AT_REST_ACCOUNT.to_string(),
            to_hex(&data).into_bytes(),
        );

        let success = execute_unified_migration(&ks, None, None).expect("partial migrate");
        assert_eq!(success.bundle.data_at_rest, data);
        assert_ne!(success.bundle.credential_vault, data);
        assert!(!ks.entries.borrow().contains_key(DATA_AT_REST_ACCOUNT));
        assert!(ks.entries.borrow().contains_key(MASTER_KEY_ACCOUNT));
    }

    #[test]
    fn test_corrupt_unified_does_not_delete_legacy_until_rewrite_verifies() {
        let data = random_key();
        let vault = random_key();
        let ks = MockKeystore::with_legacy(data, vault);
        ks.entries
            .borrow_mut()
            .insert(MASTER_KEY_ACCOUNT.to_string(), vec![0u8; 3]);

        let success = execute_unified_migration(&ks, None, None).expect("rewrite corrupt");
        assert_eq!(success.bundle.data_at_rest, data);
        assert_eq!(success.bundle.credential_vault, vault);

        let stored = ks.entries.borrow().get(MASTER_KEY_ACCOUNT).cloned().unwrap();
        assert_eq!(stored.len(), KEY_BUNDLE_LEN);
        assert_eq!(decode_key_bundle(&stored), Some(success.bundle));
        assert!(!ks.entries.borrow().contains_key(DATA_AT_REST_ACCOUNT));
        assert!(!ks.entries.borrow().contains_key(CREDENTIAL_VAULT_ACCOUNT));
    }

    #[test]
    fn test_legacy_denied_aborts_migration_without_touching_entries() {
        let data = random_key();
        let vault = random_key();
        let ks = MockKeystore::with_legacy(data, vault);
        ks.denied
            .borrow_mut()
            .insert(CREDENTIAL_VAULT_ACCOUNT.to_string());

        let err = execute_unified_migration(&ks, None, None).unwrap_err();
        assert!(err.contains("denied") || err.contains("access"));
        assert!(!ks.entries.borrow().contains_key(MASTER_KEY_ACCOUNT));
        assert!(ks.entries.borrow().contains_key(DATA_AT_REST_ACCOUNT));
        assert!(ks.entries.borrow().contains_key(CREDENTIAL_VAULT_ACCOUNT));
    }

    #[test]
    fn test_master_key_denied_aborts_without_touching_legacy() {
        let data = random_key();
        let vault = random_key();
        let ks = MockKeystore::with_legacy(data, vault);
        ks.denied.borrow_mut().insert(MASTER_KEY_ACCOUNT.to_string());

        let err = execute_unified_migration(&ks, Some(data), Some(vault)).unwrap_err();
        assert!(err.contains("denied") || err.contains("access"));
        assert!(!ks.entries.borrow().contains_key(MASTER_KEY_ACCOUNT));
        assert!(ks.entries.borrow().contains_key(DATA_AT_REST_ACCOUNT));
        assert!(ks.entries.borrow().contains_key(CREDENTIAL_VAULT_ACCOUNT));
    }

    #[test]
    fn test_migrate_from_fallback_files_when_keystore_empty() {
        let data = random_key();
        let vault = random_key();
        let ks = MockKeystore::default();

        let success =
            execute_unified_migration(&ks, Some(data), Some(vault)).expect("fallback migrate");
        assert_eq!(success.bundle.data_at_rest, data);
        assert_eq!(success.bundle.credential_vault, vault);
        assert_eq!(success.data_source, KeySource::Keychain);
        assert!(ks.entries.borrow().contains_key(MASTER_KEY_ACCOUNT));
    }

    #[test]
    fn test_failed_unified_write_keeps_legacy_keys() {
        let data = random_key();
        let vault = random_key();
        let ks = MockKeystore::with_legacy(data, vault);
        *ks.fail_set.borrow_mut() = true;

        let success = execute_unified_migration(&ks, None, None).expect("session keys");
        assert_eq!(success.bundle.data_at_rest, data);
        assert_eq!(success.bundle.credential_vault, vault);
        assert!(ks.entries.borrow().contains_key(DATA_AT_REST_ACCOUNT));
        assert!(ks.entries.borrow().contains_key(CREDENTIAL_VAULT_ACCOUNT));
        assert!(!ks.entries.borrow().contains_key(MASTER_KEY_ACCOUNT));
    }

    #[test]
    fn test_failed_unified_write_of_new_keys_errors_to_independent_resolve() {
        let ks = MockKeystore::default();
        *ks.fail_set.borrow_mut() = true;
        let err = execute_unified_migration(&ks, None, None).unwrap_err();
        assert!(err.contains("resolve independently") || err.contains("fallback"));
        assert!(ks.entries.borrow().is_empty());
    }

    #[test]
    fn test_delete_failure_after_verify_does_not_panic() {
        let data = random_key();
        let vault = random_key();
        let ks = MockKeystore::with_legacy(data, vault);
        *ks.fail_delete.borrow_mut() = true;

        let success = execute_unified_migration(&ks, None, None).expect("migrate");
        assert_eq!(success.bundle.data_at_rest, data);
        assert!(ks.entries.borrow().contains_key(MASTER_KEY_ACCOUNT));
        assert!(ks.entries.borrow().contains_key(DATA_AT_REST_ACCOUNT));
        assert!(ks.entries.borrow().contains_key(CREDENTIAL_VAULT_ACCOUNT));
    }
}
