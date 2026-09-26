use crate::secure_key::{resolve_key_nonblocking, DATA_AT_REST_ACCOUNT, DATA_AT_REST_FALLBACK};
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use std::fs;
use std::path::Path;

const MAGIC_HEADER_V1: &[u8] = b"ECHOMIND_ENC_V1\0";
const MAGIC_HEADER_V2: &[u8] = b"ECHOMIND_ENC_V2\0";
const NONCE_LEN: usize = 12;

fn cipher() -> Result<ChaCha20Poly1305, String> {
    let key = resolve_key_nonblocking(DATA_AT_REST_ACCOUNT, DATA_AT_REST_FALLBACK)?;
    Ok(ChaCha20Poly1305::new(Key::from_slice(&key)))
}

/// Encrypts and writes raw bytes to disk with authenticated ChaCha20-Poly1305 encryption.
/// Format: `ECHOMIND_ENC_V2\0` + 12-byte random nonce + ciphertext (includes the auth tag).
pub fn write_encrypted_file<P: AsRef<Path>>(path: P, plaintext: &[u8]) -> Result<(), String> {
    let cipher = cipher()?;
    let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("Şifreleme hatası: {}", e))?;

    let mut output = Vec::with_capacity(MAGIC_HEADER_V2.len() + NONCE_LEN + ciphertext.len());
    output.extend_from_slice(MAGIC_HEADER_V2);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);

    fs::write(path.as_ref(), output).map_err(|e| {
        format!(
            "Şifreli dosya yazma hatası ({}): {}",
            path.as_ref().display(),
            e
        )
    })
}

/// Decrypts the legacy V1 format: a naive reversible stream cipher. Kept only so
/// files written by older app versions can still be read once (and then get
/// transparently upgraded to the real AEAD format on their next save).
#[deprecated(note = "read-only legacy migration path — do not use for new data")]
fn decrypt_legacy_v1(ciphertext: &[u8]) -> Vec<u8> {
    let username = std::env::var("USER").unwrap_or_else(|_| "echomind_user".to_string());
    let salt = b"EchoMind_DataAtRest_AES_ChaCha_SecureSalt_2025_#ZeroTrust!";
    let mut key = Vec::with_capacity(salt.len());
    for (i, &b) in salt.iter().enumerate() {
        let u_byte = username
            .as_bytes()
            .get(i % username.len())
            .copied()
            .unwrap_or(0x37);
        let offset = (i as u8).wrapping_mul(7);
        key.push(b ^ u_byte ^ offset);
    }

    ciphertext
        .iter()
        .enumerate()
        .map(|(i, &b)| {
            let k = key[i % key.len()];
            let rot = ((i % 8) as u8).rotate_left(1);
            b ^ (k.wrapping_add(rot))
        })
        .collect()
}

/// Reads a file from disk and decrypts it based on its format header.
/// Supports the current AEAD format, the legacy V1 stream-cipher format (read-only,
/// for a one-time transparent upgrade), and raw legacy plaintext predating any encryption.
pub fn read_encrypted_file<P: AsRef<Path>>(path: P) -> Result<Vec<u8>, String> {
    let raw_bytes = fs::read(path.as_ref())
        .map_err(|e| format!("Dosya okuma hatası ({}): {}", path.as_ref().display(), e))?;

    if let Some(rest) = raw_bytes.strip_prefix(MAGIC_HEADER_V2) {
        if rest.len() < NONCE_LEN {
            return Err("Şifreli dosya bozuk: nonce eksik".to_string());
        }
        let (nonce_bytes, ciphertext) = rest.split_at(NONCE_LEN);
        let cipher = cipher()?;
        let nonce = Nonce::from_slice(nonce_bytes);
        return cipher.decrypt(nonce, ciphertext).map_err(|_| {
            "Şifre çözme hatası: veri bozuk veya bütünlük doğrulaması başarısız".to_string()
        });
    }

    if let Some(rest) = raw_bytes.strip_prefix(MAGIC_HEADER_V1) {
        #[allow(deprecated)]
        return Ok(decrypt_legacy_v1(rest));
    }

    // Legacy plaintext fallback (files predating any on-disk encryption).
    Ok(raw_bytes)
}

/// Serializes and writes data as encrypted JSON.
pub fn save_encrypted_json<T: serde::Serialize, P: AsRef<Path>>(
    path: P,
    data: &T,
) -> Result<(), String> {
    let json_bytes =
        serde_json::to_vec_pretty(data).map_err(|e| format!("JSON serialize hatası: {}", e))?;
    write_encrypted_file(path, &json_bytes)
}

/// Reads encrypted JSON from disk and deserializes it.
pub fn load_encrypted_json<T: serde::de::DeserializeOwned, P: AsRef<Path>>(
    path: P,
) -> Result<T, String> {
    let plaintext = read_encrypted_file(path)?;
    if plaintext.is_empty() {
        return Err("Dosya boş".to_string());
    }
    serde_json::from_slice(&plaintext).map_err(|e| format!("JSON deserialize hatası: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
    struct SampleData {
        secret_notes: String,
        amount: u64,
    }

    #[test]
    fn test_encrypted_storage_roundtrip() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("echomind_test_enc_{}.dat", std::process::id()));

        let original = SampleData {
            secret_notes: "Ticari sır: Birleşme görüşmesi 10M USD".to_string(),
            amount: 10_000_000,
        };

        // 1. Save encrypted
        save_encrypted_json(&file_path, &original).unwrap();

        // 2. Read raw bytes from disk: it must NOT contain plaintext strings
        let raw_disk = fs::read(&file_path).unwrap();
        assert!(raw_disk.starts_with(MAGIC_HEADER_V2));
        let raw_str = String::from_utf8_lossy(&raw_disk);
        assert!(!raw_str.contains("Ticari sır"));
        assert!(!raw_str.contains("10M USD"));

        // 3. Load and decrypt
        let loaded: SampleData = load_encrypted_json(&file_path).unwrap();
        assert_eq!(loaded, original);

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn test_tamper_detection_rejects_modified_ciphertext() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("echomind_test_tamper_{}.dat", std::process::id()));

        let original = SampleData {
            secret_notes: "Gizli".to_string(),
            amount: 1,
        };
        save_encrypted_json(&file_path, &original).unwrap();

        let mut raw = fs::read(&file_path).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0xFF; // flip a bit in the ciphertext/tag
        fs::write(&file_path, &raw).unwrap();

        let result: Result<SampleData, String> = load_encrypted_json(&file_path);
        assert!(
            result.is_err(),
            "tampered ciphertext must fail authentication instead of silently decrypting"
        );

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn test_two_files_do_not_share_ciphertext_prefix() {
        // Regression guard for the old scheme, where a deterministic per-user keystream
        // meant two files with the same plaintext prefix leaked correlated ciphertext.
        let temp_dir = std::env::temp_dir();
        let path_a = temp_dir.join(format!("echomind_test_nonce_a_{}.dat", std::process::id()));
        let path_b = temp_dir.join(format!("echomind_test_nonce_b_{}.dat", std::process::id()));

        let data = SampleData {
            secret_notes: "identical prefix".to_string(),
            amount: 7,
        };
        save_encrypted_json(&path_a, &data).unwrap();
        save_encrypted_json(&path_b, &data).unwrap();

        let raw_a = fs::read(&path_a).unwrap();
        let raw_b = fs::read(&path_b).unwrap();
        assert_ne!(
            raw_a, raw_b,
            "identical plaintext must not produce identical ciphertext across files"
        );

        let _ = fs::remove_file(path_a);
        let _ = fs::remove_file(path_b);
    }

    #[test]
    fn test_legacy_plaintext_migration() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("echomind_test_legacy_{}.dat", std::process::id()));

        let legacy_json = r#"{"secret_notes":"Eski format düz metin","amount":42}"#;
        fs::write(&file_path, legacy_json.as_bytes()).unwrap();

        // Should transparently load legacy plaintext
        let loaded: SampleData = load_encrypted_json(&file_path).unwrap();
        assert_eq!(loaded.secret_notes, "Eski format düz metin");
        assert_eq!(loaded.amount, 42);

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn test_legacy_v1_xor_migration() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!(
            "echomind_test_legacy_v1_{}.dat",
            std::process::id()
        ));

        let original = SampleData {
            secret_notes: "Eski XOR formatı".to_string(),
            amount: 99,
        };
        let json_bytes = serde_json::to_vec_pretty(&original).unwrap();

        // Simulate a file written by the old V1 encrypt_storage implementation.
        let username = std::env::var("USER").unwrap_or_else(|_| "echomind_user".to_string());
        let salt = b"EchoMind_DataAtRest_AES_ChaCha_SecureSalt_2025_#ZeroTrust!";
        let mut key = Vec::with_capacity(salt.len());
        for (i, &b) in salt.iter().enumerate() {
            let u_byte = username
                .as_bytes()
                .get(i % username.len())
                .copied()
                .unwrap_or(0x37);
            let offset = (i as u8).wrapping_mul(7);
            key.push(b ^ u_byte ^ offset);
        }
        let ciphertext: Vec<u8> = json_bytes
            .iter()
            .enumerate()
            .map(|(i, &b)| {
                let k = key[i % key.len()];
                let rot = ((i % 8) as u8).rotate_left(1);
                b ^ (k.wrapping_add(rot))
            })
            .collect();

        let mut legacy_file = Vec::new();
        legacy_file.extend_from_slice(MAGIC_HEADER_V1);
        legacy_file.extend_from_slice(&ciphertext);
        fs::write(&file_path, &legacy_file).unwrap();

        let loaded: SampleData = load_encrypted_json(&file_path).unwrap();
        assert_eq!(loaded, original);

        // Re-saving must upgrade the file to the new AEAD format.
        save_encrypted_json(&file_path, &loaded).unwrap();
        let raw_after_upgrade = fs::read(&file_path).unwrap();
        assert!(raw_after_upgrade.starts_with(MAGIC_HEADER_V2));

        let _ = fs::remove_file(file_path);
    }
}

#[cfg(test)]
mod unlock_gate_tests {
    use super::*;
    use crate::secure_key::{
        begin_key_unlock, key_unlock_test_lock, mark_keys_ready, reset_key_unlock_state_for_test,
        STORAGE_NOT_READY,
    };

    #[test]
    fn test_write_encrypted_refuses_while_unlock_in_progress() {
        let _lock = key_unlock_test_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        reset_key_unlock_state_for_test();
        assert!(begin_key_unlock());

        let path = std::env::temp_dir().join(format!(
            "echomind_test_not_ready_{}.dat",
            std::process::id()
        ));
        let err = write_encrypted_file(&path, b"secret").unwrap_err();
        assert_eq!(err, STORAGE_NOT_READY);

        mark_keys_ready();
        // Ready but uncached still sync-resolves in tests (NotStarted was replaced by Ready
        // after mark; resolve_key_nonblocking allows blocking when not InProgress).
        reset_key_unlock_state_for_test();
        let _ = fs::remove_file(path);
    }
}
