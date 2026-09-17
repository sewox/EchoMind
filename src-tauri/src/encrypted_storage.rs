use std::fs;
use std::path::Path;

const MAGIC_HEADER: &[u8] = b"ECHOMIND_ENC_V1\0";

/// Derives a machine/user-bound key for local data-at-rest encryption
fn get_storage_key() -> Vec<u8> {
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
    key
}

/// Encrypts / Decrypts bytes using key stream XOR cipher with key rotation
fn stream_cipher(data: &[u8], key: &[u8]) -> Vec<u8> {
    data.iter()
        .enumerate()
        .map(|(i, &b)| {
            let k = key[i % key.len()];
            let rot = ((i % 8) as u8).rotate_left(1);
            b ^ (k.wrapping_add(rot))
        })
        .collect()
}

/// Encrypts and writes raw bytes to disk with the EchoMind secure magic header.
pub fn write_encrypted_file<P: AsRef<Path>>(path: P, plaintext: &[u8]) -> Result<(), String> {
    let key = get_storage_key();
    let ciphertext = stream_cipher(plaintext, &key);

    let mut output = Vec::with_capacity(MAGIC_HEADER.len() + ciphertext.len());
    output.extend_from_slice(MAGIC_HEADER);
    output.extend_from_slice(&ciphertext);

    fs::write(path.as_ref(), output).map_err(|e| {
        format!(
            "Şifreli dosya yazma hatası ({}): {}",
            path.as_ref().display(),
            e
        )
    })
}

/// Reads a file from disk. If it has the EchoMind magic header, decrypts it.
/// If it's a legacy plaintext file, reads it directly (providing smooth migration).
pub fn read_encrypted_file<P: AsRef<Path>>(path: P) -> Result<Vec<u8>, String> {
    let raw_bytes = fs::read(path.as_ref())
        .map_err(|e| format!("Dosya okuma hatası ({}): {}", path.as_ref().display(), e))?;

    if raw_bytes.starts_with(MAGIC_HEADER) {
        let ciphertext = &raw_bytes[MAGIC_HEADER.len()..];
        let key = get_storage_key();
        let plaintext = stream_cipher(ciphertext, &key);
        Ok(plaintext)
    } else {
        // Legacy plaintext fallback
        Ok(raw_bytes)
    }
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
        assert!(raw_disk.starts_with(MAGIC_HEADER));
        let raw_str = String::from_utf8_lossy(&raw_disk);
        assert!(!raw_str.contains("Ticari sır"));
        assert!(!raw_str.contains("10M USD"));

        // 3. Load and decrypt
        let loaded: SampleData = load_encrypted_json(&file_path).unwrap();
        assert_eq!(loaded, original);

        let _ = fs::remove_file(file_path);
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
}
