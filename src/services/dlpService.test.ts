import { describe, it, expect, vi } from 'vitest';
import {
  isLuhnValid,
  isTcknValid,
  redactSensitiveData,
  redactSensitiveDataNative,
} from './dlpService';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: { text: string }) => {
    if (cmd === 'redact_sensitive_text') {
      return redactSensitiveData(args.text);
    }
    throw new Error('Unknown command');
  }),
}));

describe('dlpService', () => {
  describe('isLuhnValid', () => {
    it('should validate valid card numbers', () => {
      expect(isLuhnValid('4532015112830366')).toBe(true);
      expect(isLuhnValid('4532-0151-1283-0366')).toBe(true);
    });

    it('should reject invalid card numbers', () => {
      expect(isLuhnValid('4532015112830367')).toBe(false);
      expect(isLuhnValid('12345')).toBe(false);
    });
  });

  describe('isTcknValid', () => {
    it('should validate standard valid TCKN algorithms', () => {
      expect(isTcknValid('10000000146')).toBe(true);
    });

    it('should reject invalid TCKN numbers', () => {
      expect(isTcknValid('10000000147')).toBe(false);
      expect(isTcknValid('01234567890')).toBe(false);
      expect(isTcknValid('123')).toBe(false);
    });
  });

  describe('redactSensitiveData', () => {
    it('should redact API keys correctly', () => {
      const input = 'OpenAI: sk-proj-1234567890abcdef1234567890, Groq: gsk_abcdef1234567890abcdef1234567890';
      const output = redactSensitiveData(input);
      expect(output).not.toContain('sk-proj-1234567890abcdef1234567890');
      expect(output).not.toContain('gsk_abcdef1234567890abcdef1234567890');
      expect(output).toContain('[REDACTED: API_KEY]');
    });

    it('should redact TR IBAN correctly', () => {
      const input = 'Lütfen ödemeyi TR330006100519786457841234 hesabına yapın.';
      const output = redactSensitiveData(input);
      expect(output).not.toContain('TR330006100519786457841234');
      expect(output).toContain('[REDACTED: IBAN]');
    });

    it('should redact emails and phones', () => {
      const input = 'İletişim: contact@company.com ve 0542 123 45 67';
      const output = redactSensitiveData(input);
      expect(output).not.toContain('contact@company.com');
      expect(output).not.toContain('0542 123 45 67');
      expect(output).toContain('[REDACTED: EMAIL]');
      expect(output).toContain('[REDACTED: PHONE]');
    });

    it('should respect custom config toggles', () => {
      const input = 'İletişim: contact@company.com';
      const output = redactSensitiveData(input, { redact_emails: false });
      expect(output).toContain('contact@company.com');
    });
  });

  describe('redactSensitiveDataNative', () => {
    it('should invoke native tauri command or fallback', async () => {
      const input = 'Gizli anahtar: sk-abcdef12345678901234567890';
      const output = await redactSensitiveDataNative(input);
      expect(output).toContain('[REDACTED: API_KEY]');
    });
  });
});
