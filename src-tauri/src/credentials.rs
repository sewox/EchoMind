use crate::storage::get_storage_dir;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

// Obfuscation and hardware-bound encryption key
fn get_vault_key() -> Vec<u8> {
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
    key
}

fn encrypt_decrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    data.iter()
        .enumerate()
        .map(|(i, &b)| b ^ key[i % key.len()])
        .collect()
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

    if let Ok(raw_bytes) = fs::read(&path) {
        let key = get_vault_key();
        let decrypted = encrypt_decrypt(&raw_bytes, &key);
        if let Ok(map) = serde_json::from_slice::<HashMap<String, String>>(&decrypted) {
            return map;
        }
    }
    HashMap::new()
}

fn save_vault(map: &HashMap<String, String>) -> Result<(), String> {
    let path = get_vault_path();
    let json_bytes = serde_json::to_vec(map).map_err(|e| format!("JSON serialize error: {}", e))?;
    let key = get_vault_key();
    let encrypted = encrypt_decrypt(&json_bytes, &key);
    fs::write(&path, encrypted).map_err(|e| format!("Vault yazma hatası: {}", e))?;
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
        let data = b"sk-my-super-secret-api-key-12345";
        let key = get_vault_key();
        let enc = encrypt_decrypt(data, &key);
        assert_ne!(enc, data, "Şifrelenmiş veri düz metin olmamalı");
        let dec = encrypt_decrypt(&enc, &key);
        assert_eq!(dec, data, "Şifre çözüldüğünde orijinal veriye dönmeli");
    }
}
