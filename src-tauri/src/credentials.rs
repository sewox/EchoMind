use crate::secure_key::get_or_create_key;
use crate::storage::get_storage_dir;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const MAGIC_HEADER_V2: &[u8] = b"ECHOMIND_VAULT_V2\0";
const NONCE_LEN: usize = 12;

fn cipher() -> ChaCha20Poly1305 {
    let key = get_or_create_key("credential_vault_key", "vault.key");
    ChaCha20Poly1305::new(Key::from_slice(&key))
}

/// Decrypts the legacy vault format: a naive reversible XOR obfuscation with no
/// header, no authentication, and a key derivable from a public salt plus the
/// OS username. Kept only so vaults written by older app versions can be read
/// once and transparently upgraded to the real AEAD format on their next save.
#[deprecated(note = "read-only legacy migration path — do not use for new data")]
fn decrypt_legacy(raw_bytes: &[u8]) -> HashMap<String, String> {
    let hostname = std::env::var("USER").unwrap_or_else(|_| "echomind_user".to_string());
    let salt = b"EchoMind_Secure_Vault_Salt_v1_2025_#99!";
    let mut key = Vec::new();
    for (i, &b) in salt.iter().enumerate() {
        let h_byte = hostname
            .as_bytes()
            .get(i % hostname.len())
            .copied()
            .unwrap_or(0x42);
        key.push(b ^ h_byte);
    }

    let decrypted: Vec<u8> = raw_bytes
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ key[i % key.len()])
        .collect();

    serde_json::from_slice(&decrypted).unwrap_or_default()
}

fn get_vault_path() -> PathBuf {
    get_storage_dir().join("credentials.enc")
}

static VAULT_LOCK: Mutex<()> = Mutex::new(());

fn load_vault() -> HashMap<String, String> {
    let path = get_vault_path();
    if !path.exists() {
        return HashMap::new();
    }

    let raw_bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => return HashMap::new(),
    };

    if let Some(rest) = raw_bytes.strip_prefix(MAGIC_HEADER_V2) {
        if rest.len() < NONCE_LEN {
            return HashMap::new();
        }
        let (nonce_bytes, ciphertext) = rest.split_at(NONCE_LEN);
        let cipher = cipher();
        let nonce = Nonce::from_slice(nonce_bytes);
        return cipher
            .decrypt(nonce, ciphertext)
            .ok()
            .and_then(|plaintext| serde_json::from_slice(&plaintext).ok())
            .unwrap_or_default();
    }

    // Pre-V2 vault: no magic header, whole file is the legacy XOR ciphertext.
    #[allow(deprecated)]
    decrypt_legacy(&raw_bytes)
}

fn save_vault(map: &HashMap<String, String>) -> Result<(), String> {
    let path = get_vault_path();
    let json_bytes = serde_json::to_vec(map).map_err(|e| format!("JSON serialize error: {}", e))?;

    let cipher = cipher();
    let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, json_bytes.as_slice())
        .map_err(|e| format!("Şifreleme hatası: {}", e))?;

    let mut output = Vec::with_capacity(MAGIC_HEADER_V2.len() + NONCE_LEN + ciphertext.len());
    output.extend_from_slice(MAGIC_HEADER_V2);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);

    fs::write(&path, output).map_err(|e| format!("Vault yazma hatası: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn save_secure_credential(key_name: String, key_value: String) -> Result<(), String> {
    let _guard = VAULT_LOCK.lock().map_err(|e| e.to_string())?;
    let mut vault = load_vault();
    if key_value.trim().is_empty() {
        vault.remove(&key_name);
    } else {
        vault.insert(key_name, key_value);
    }
    save_vault(&vault)
}

#[tauri::command]
pub fn get_secure_credential(key_name: String) -> Result<Option<String>, String> {
    let _guard = VAULT_LOCK.lock().map_err(|e| e.to_string())?;
    let vault = load_vault();
    Ok(vault.get(&key_name).cloned())
}

#[tauri::command]
pub fn delete_secure_credential(key_name: String) -> Result<(), String> {
    let _guard = VAULT_LOCK.lock().map_err(|e| e.to_string())?;
    let mut vault = load_vault();
    vault.remove(&key_name);
    save_vault(&vault)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_credentials_encryption_roundtrip() {
        let mut map = HashMap::new();
        map.insert(
            "echomind_test_key".to_string(),
            "sk-my-super-secret-api-key-12345".to_string(),
        );

        let json_bytes = serde_json::to_vec(&map).unwrap();
        let cipher = cipher();
        let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
        let ciphertext = cipher.encrypt(&nonce, json_bytes.as_slice()).unwrap();

        assert_ne!(
            ciphertext, json_bytes,
            "Şifrelenmiş veri düz metin olmamalı"
        );

        let decrypted = cipher.decrypt(&nonce, ciphertext.as_slice()).unwrap();
        let restored: HashMap<String, String> = serde_json::from_slice(&decrypted).unwrap();
        assert_eq!(restored, map);
    }

    #[test]
    fn test_legacy_vault_migration() {
        let mut map = HashMap::new();
        map.insert(
            "echomind_groq_key".to_string(),
            "gsk_legacy_secret".to_string(),
        );
        let json_bytes = serde_json::to_vec(&map).unwrap();

        // Simulate a vault file written by the old XOR implementation (no header).
        let hostname = std::env::var("USER").unwrap_or_else(|_| "echomind_user".to_string());
        let salt = b"EchoMind_Secure_Vault_Salt_v1_2025_#99!";
        let mut key = Vec::new();
        for (i, &b) in salt.iter().enumerate() {
            let h_byte = hostname
                .as_bytes()
                .get(i % hostname.len())
                .copied()
                .unwrap_or(0x42);
            key.push(b ^ h_byte);
        }
        let legacy_ciphertext: Vec<u8> = json_bytes
            .iter()
            .enumerate()
            .map(|(i, &b)| b ^ key[i % key.len()])
            .collect();

        #[allow(deprecated)]
        let restored = decrypt_legacy(&legacy_ciphertext);
        assert_eq!(
            restored.get("echomind_groq_key"),
            Some(&"gsk_legacy_secret".to_string())
        );
    }
}
