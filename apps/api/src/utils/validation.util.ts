import { BadRequestException } from '@nestjs/common';

/**
 * RFC 5322 compliant email regex
 * This is a simplified version that covers most common cases
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Validates email format
 * @param email Email address to validate
 * @returns true if valid, false otherwise
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Check basic format
  if (!EMAIL_REGEX.test(email)) {
    return false;
  }

  // Additional checks
  if (email.length > 254) {
    // Max email length per RFC
    return false;
  }

  const [localPart] = email.split('@');
  if (!localPart || localPart.length > 64) {
    // Max local part length
    return false;
  }

  // Check for consecutive dots
  if (email.includes('..')) {
    return false;
  }

  return true;
}

/**
 * Validates email and throws if invalid
 * @param email Email address to validate
 * @throws BadRequestException if email is invalid
 */
export function validateEmailOrThrow(email: string): void {
  if (!isValidEmail(email)) {
    throw new BadRequestException('Invalid email format');
  }
}

/**
 * Validates multiple emails
 * @param emails Array of email addresses
 * @returns Object with valid and invalid emails
 */
export function validateEmails(emails: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const email of emails) {
    if (isValidEmail(email)) {
      valid.push(email);
    } else {
      invalid.push(email);
    }
  }

  return { valid, invalid };
}
