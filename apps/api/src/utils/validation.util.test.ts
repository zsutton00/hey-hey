import { isValidEmail, validateEmails } from './validation.util';

describe('Email Validation Utility', () => {
  describe('isValidEmail', () => {
    test('should validate correct email formats', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name@domain.co.uk')).toBe(true);
      expect(isValidEmail('user+tag@example.org')).toBe(true);
    });

    test('should reject invalid email formats', () => {
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('invalid-email')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('@domain.com')).toBe(false);
      expect(isValidEmail('user..name@domain.com')).toBe(false);
    });

    test('should reject emails that are too long', () => {
      const longEmail = 'a'.repeat(250) + '@example.com';
      expect(isValidEmail(longEmail)).toBe(false);
    });

    test('should reject non-string inputs', () => {
      expect(isValidEmail(null as any)).toBe(false);
      expect(isValidEmail(undefined as any)).toBe(false);
      expect(isValidEmail(123 as any)).toBe(false);
    });
  });

  describe('validateEmails', () => {
    test('should separate valid and invalid emails', () => {
      const emails = [
        'valid@example.com',
        'invalid-email',
        'another@domain.org',
        'bad@',
      ];

      const result = validateEmails(emails);

      expect(result.valid).toEqual(['valid@example.com', 'another@domain.org']);
      expect(result.invalid).toEqual(['invalid-email', 'bad@']);
    });

    test('should handle empty array', () => {
      const result = validateEmails([]);
      expect(result.valid).toEqual([]);
      expect(result.invalid).toEqual([]);
    });
  });
});
