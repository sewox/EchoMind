import { invoke } from '@tauri-apps/api/core';

export interface DlpConfig {
  redact_credit_cards: boolean;
  redact_tckn: boolean;
  redact_iban: boolean;
  redact_api_keys: boolean;
  redact_emails: boolean;
  redact_phones: boolean;
}

export const DEFAULT_DLP_CONFIG: DlpConfig = {
  redact_credit_cards: true,
  redact_tckn: true,
  redact_iban: true,
  redact_api_keys: true,
  redact_emails: true,
  redact_phones: true,
};

/**
 * Validates whether a number string satisfies Luhn checksum algorithm (Credit Cards).
 */
export function isLuhnValid(numberStr: string): boolean {
  const digits = numberStr.replace(/\D/g, '').split('').map(Number);
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let alternate = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits[i];
    if (alternate) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

/**
 * Validates Turkish National ID (TCKN) checksum algorithm.
 */
export function isTcknValid(numberStr: string): boolean {
  const digits = numberStr.replace(/\D/g, '').split('').map(Number);
  if (digits.length !== 11 || digits[0] === 0) {
    return false;
  }

  const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const evenSum = digits[1] + digits[3] + digits[5] + digits[7];

  const digit10 = (oddSum * 7 - evenSum) % 10;
  const positiveDigit10 = (digit10 + 10) % 10;
  if (digits[9] !== positiveDigit10) {
    return false;
  }

  const totalSum = digits.slice(0, 10).reduce((a, b) => a + b, 0);
  if (digits[10] !== totalSum % 10) {
    return false;
  }

  return true;
}

const API_KEY_REGEXES = [
  /\b(sk-(?:proj-)?[a-zA-Z0-9_-]{20,})\b/g,
  /\b(gsk_[a-zA-Z0-9_-]{20,})\b/g,
  /\b(AIzaSy[a-zA-Z0-9_-]{33})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\bBearer\s+([a-zA-Z0-9_.-]{20,})\b/gi,
];

const IBAN_REGEX = /\bTR[0-9]{2}[\s]?[0-9]{4}[\s]?[0-9]{4}[\s]?[0-9]{4}[\s]?[0-9]{4}[\s]?[0-9]{4}[\s]?[0-9]{2}\b/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?90[\s.-]?)?(?:\(?0?5\d{2}\)?[\s.-]?)\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g;
const DIGIT_CHUNK_REGEX = /\b(?:\d[\s.-]?){11,19}\b/g;

/**
 * Client-side fast DLP redaction utility
 */
export function redactSensitiveData(text: string, config: Partial<DlpConfig> = {}): string {
  if (!text) return '';

  const cfg = { ...DEFAULT_DLP_CONFIG, ...config };
  let result = text;

  // 1. API Keys
  if (cfg.redact_api_keys) {
    for (const regex of API_KEY_REGEXES) {
      result = result.replace(regex, '[REDACTED: API_KEY]');
    }
  }

  // 2. IBAN
  if (cfg.redact_iban) {
    result = result.replace(IBAN_REGEX, '[REDACTED: IBAN]');
  }

  // 3. Credit Cards & TCKN with algorithmic checks
  if (cfg.redact_credit_cards || cfg.redact_tckn) {
    result = result.replace(DIGIT_CHUNK_REGEX, (match) => {
      const cleanDigits = match.replace(/\D/g, '');
      if (cfg.redact_tckn && cleanDigits.length === 11 && isTcknValid(cleanDigits)) {
        return '[REDACTED: TCKN]';
      }
      if (cfg.redact_credit_cards && cleanDigits.length >= 13 && cleanDigits.length <= 19 && isLuhnValid(cleanDigits)) {
        return '[REDACTED: CREDIT_CARD]';
      }
      return match;
    });
  }

  // 4. Email
  if (cfg.redact_emails) {
    result = result.replace(EMAIL_REGEX, '[REDACTED: EMAIL]');
  }

  // 5. Phone
  if (cfg.redact_phones) {
    result = result.replace(PHONE_REGEX, '[REDACTED: PHONE]');
  }

  return result;
}

/**
 * Native Tauri backed DLP redaction (falls back to JS engine)
 */
export async function redactSensitiveDataNative(
  text: string,
  config?: Partial<DlpConfig>
): Promise<string> {
  try {
    return await invoke<string>('redact_sensitive_text', {
      text,
      config: config ? { ...DEFAULT_DLP_CONFIG, ...config } : null,
    });
  } catch {
    return redactSensitiveData(text, config);
  }
}
