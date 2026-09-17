use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// Configuration options for Data Loss Prevention (DLP) redaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DlpConfig {
    pub redact_credit_cards: bool,
    pub redact_tckn: bool,
    pub redact_iban: bool,
    pub redact_api_keys: bool,
    pub redact_emails: bool,
    pub redact_phones: bool,
}

impl Default for DlpConfig {
    fn default() -> Self {
        Self {
            redact_credit_cards: true,
            redact_tckn: true,
            redact_iban: true,
            redact_api_keys: true,
            redact_emails: true,
            redact_phones: true,
        }
    }
}

/// Validates whether a numeric string conforms to the Luhn checksum algorithm (Credit Cards).
pub fn is_valid_luhn(number_str: &str) -> bool {
    let digits: Vec<u32> = number_str
        .chars()
        .filter(|c| c.is_ascii_digit())
        .filter_map(|c| c.to_digit(10))
        .collect();

    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }

    let mut sum = 0;
    let mut alternate = false;

    for &digit in digits.iter().rev() {
        if alternate {
            let doubled = digit * 2;
            sum += if doubled > 9 { doubled - 9 } else { doubled };
        } else {
            sum += digit;
        }
        alternate = !alternate;
    }

    sum % 10 == 0
}

/// Validates Turkish National ID (TCKN) checksum algorithm.
pub fn is_valid_tckn(number_str: &str) -> bool {
    let digits: Vec<u32> = number_str
        .chars()
        .filter(|c| c.is_ascii_digit())
        .filter_map(|c| c.to_digit(10))
        .collect();

    if digits.len() != 11 || digits[0] == 0 {
        return false;
    }

    let odd_sum: u32 = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
    let even_sum: u32 = digits[1] + digits[3] + digits[5] + digits[7];

    let digit_10 = (odd_sum * 7).wrapping_sub(even_sum) % 10;
    if digits[9] != digit_10 {
        return false;
    }

    let total_sum: u32 = digits[..10].iter().sum();
    if digits[10] != total_sum % 10 {
        return false;
    }

    true
}

static API_KEY_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
static PHONE_REGEX: OnceLock<Regex> = OnceLock::new();
static EMAIL_REGEX: OnceLock<Regex> = OnceLock::new();
static IBAN_REGEX: OnceLock<Regex> = OnceLock::new();
static DIGIT_CHUNK_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_api_key_patterns() -> &'static Vec<Regex> {
    API_KEY_PATTERNS.get_or_init(|| {
        vec![
            // OpenAI keys
            Regex::new(r"(?i)\b(sk-(?:proj-)?[a-zA-Z0-9_\-]{20,})\b").unwrap(),
            // Groq keys
            Regex::new(r"\b(gsk_[a-zA-Z0-9_\-]{20,})\b").unwrap(),
            // Google Gemini / Cloud API keys
            Regex::new(r"\b(AIzaSy[a-zA-Z0-9_\-]{20,})\b").unwrap(),
            // GitHub tokens
            Regex::new(r"\b(gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{50,})\b").unwrap(),
            // AWS Access Keys
            Regex::new(r"\b(AKIA[0-9A-Z]{16})\b").unwrap(),
            // Generic Bearer tokens
            Regex::new(r"(?i)\bBearer\s+([a-zA-Z0-9_\-\.]{20,})\b").unwrap(),
        ]
    })
}

fn get_phone_regex() -> &'static Regex {
    PHONE_REGEX.get_or_init(|| {
        // Matches TR phones: +90 5xx xxx xx xx, 05xx..., 5xx...
        Regex::new(r"(?:\+?90[\s.-]?)?(?:\(?0?5\d{2}\)?[\s.-]?)\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b")
            .unwrap()
    })
}

fn get_email_regex() -> &'static Regex {
    EMAIL_REGEX
        .get_or_init(|| Regex::new(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}").unwrap())
}

fn get_iban_regex() -> &'static Regex {
    IBAN_REGEX.get_or_init(|| {
        // Matches TR and international IBANs
        Regex::new(r"\bTR[0-9]{2}[\s]?[0-9]{4}[\s]?[0-9]{4}[\s]?[0-9]{4}[\s]?[0-9]{4}[\s]?[0-9]{4}[\s]?[0-9]{2}\b").unwrap()
    })
}

fn get_digit_chunk_regex() -> &'static Regex {
    DIGIT_CHUNK_REGEX.get_or_init(|| {
        // Matches 11-19 digit chunks (with optional spaces/dashes)
        Regex::new(r"\b(?:\d[\s.-]?){11,19}\b").unwrap()
    })
}

/// Redacts sensitive PII and secrets from text based on active DLP configuration.
pub fn redact_sensitive_data(text: &str, config: &DlpConfig) -> String {
    let mut result = text.to_string();

    // 1. Redact API Keys & Tokens
    if config.redact_api_keys {
        for pattern in get_api_key_patterns() {
            result = pattern
                .replace_all(&result, "[REDACTED: API_KEY]")
                .to_string();
        }
    }

    // 2. Redact IBAN
    if config.redact_iban {
        result = get_iban_regex()
            .replace_all(&result, "[REDACTED: IBAN]")
            .to_string();
    }

    // 3. Redact Credit Cards & TCKN (Algorithmic verification)
    if config.redact_credit_cards || config.redact_tckn {
        let matches: Vec<(std::ops::Range<usize>, String)> = get_digit_chunk_regex()
            .find_iter(&result)
            .map(|m| (m.range(), m.as_str().to_string()))
            .collect();

        // Process from end to start so byte offsets remain valid
        for (range, matched_str) in matches.into_iter().rev() {
            let digits_only: String = matched_str.chars().filter(|c| c.is_ascii_digit()).collect();

            if config.redact_tckn && digits_only.len() == 11 && is_valid_tckn(&digits_only) {
                result.replace_range(range, "[REDACTED: TCKN]");
            } else if config.redact_credit_cards
                && (13..=19).contains(&digits_only.len())
                && is_valid_luhn(&digits_only)
            {
                result.replace_range(range, "[REDACTED: CREDIT_CARD]");
            }
        }
    }

    // 4. Redact Emails
    if config.redact_emails {
        result = get_email_regex()
            .replace_all(&result, "[REDACTED: EMAIL]")
            .to_string();
    }

    // 5. Redact Phone Numbers
    if config.redact_phones {
        result = get_phone_regex()
            .replace_all(&result, "[REDACTED: PHONE]")
            .to_string();
    }

    result
}

#[tauri::command]
pub fn redact_sensitive_text(text: String, config: Option<DlpConfig>) -> Result<String, String> {
    let cfg = config.unwrap_or_default();
    Ok(redact_sensitive_data(&text, &cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_luhn_credit_card() {
        // Valid Luhn test card (Visa sample)
        assert!(is_valid_luhn("4532015112830366"));
        // Invalid Luhn
        assert!(!is_valid_luhn("4532015112830367"));
        // Too short
        assert!(!is_valid_luhn("12345"));
    }

    #[test]
    fn test_tckn_algorithm() {
        // Known valid algorithmic TCKN pattern (standard test numbers)
        assert!(is_valid_tckn("10000000146"));
        // Invalid TCKN
        assert!(!is_valid_tckn("10000000147"));
        assert!(!is_valid_tckn("01234567890")); // Cannot start with 0
    }

    #[test]
    fn test_api_key_redaction() {
        let config = DlpConfig::default();
        let input = "Here is my openai key: sk-1234567890abcdef1234567890abcdef and groq: gsk_abcdef1234567890abcdef1234567890";
        let output = redact_sensitive_data(input, &config);
        assert!(!output.contains("sk-1234567890abcdef1234567890abcdef"));
        assert!(!output.contains("gsk_abcdef1234567890abcdef1234567890"));
        assert!(output.contains("[REDACTED: API_KEY]"));
    }

    #[test]
    fn test_iban_redaction() {
        let config = DlpConfig::default();
        let input = "Banka hesabım: TR330006100519786457841234 lütfen buraya gönderin.";
        let output = redact_sensitive_data(input, &config);
        assert!(!output.contains("TR330006100519786457841234"));
        assert!(output.contains("[REDACTED: IBAN]"));
    }

    #[test]
    fn test_email_and_phone_redaction() {
        let config = DlpConfig::default();
        let input = "Bana ceo@company.com veya 0532 123 45 67 üzerinden ulaşabilirsiniz.";
        let output = redact_sensitive_data(input, &config);
        assert!(!output.contains("ceo@company.com"));
        assert!(!output.contains("0532 123 45 67"));
        assert!(output.contains("[REDACTED: EMAIL]"));
        assert!(output.contains("[REDACTED: PHONE]"));
    }
}
