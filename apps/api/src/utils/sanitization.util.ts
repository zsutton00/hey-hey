import { BadRequestException } from '@nestjs/common';

/**
 * Email sanitization utilities for security hardening
 */

/**
 * Sanitize email address to prevent injection attacks
 * @param email Raw email input
 * @returns Sanitized email address
 */
export function sanitizeEmail(email: string): string {
  if (typeof email !== 'string') {
    throw new BadRequestException('Email must be a string');
  }

  // Remove leading/trailing whitespace
  let sanitized = email.trim();

  // Convert to lowercase for consistency
  sanitized = sanitized.toLowerCase();

  // Remove any null bytes (potential injection)
  sanitized = sanitized.replace(/\0/g, '');

  // Remove any control characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

  // Remove any Unicode direction override characters (potential spoofing)
  sanitized = sanitized.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');

  // Remove any suspicious characters that could be used for injection
  sanitized = sanitized.replace(/[<>'"&]/g, '');

  // Limit length to prevent buffer overflow attacks
  if (sanitized.length > 254) {
    throw new BadRequestException('Email address too long');
  }

  // Check for multiple @ symbols (invalid email format)
  const atCount = (sanitized.match(/@/g) || []).length;
  if (atCount !== 1) {
    throw new BadRequestException('Invalid email format');
  }

  // Check for consecutive dots (invalid email format)
  if (sanitized.includes('..')) {
    throw new BadRequestException('Invalid email format');
  }

  // Check for leading/trailing dots in local part
  const [localPart, domain] = sanitized.split('@');
  if (!localPart || !domain) {
    throw new BadRequestException('Invalid email format');
  }
  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    throw new BadRequestException('Invalid email format');
  }

  // Check for leading/trailing dots in domain
  if (domain.startsWith('.') || domain.endsWith('.')) {
    throw new BadRequestException('Invalid email format');
  }

  return sanitized;
}

/**
 * Sanitize an array of email addresses
 * @param emails Array of email addresses
 * @returns Array of sanitized email addresses
 */
export function sanitizeEmails(emails: string[]): string[] {
  if (!Array.isArray(emails)) {
    throw new BadRequestException('Emails must be an array');
  }

  if (emails.length === 0) {
    throw new BadRequestException('Email array cannot be empty');
  }

  return emails.map((email) => sanitizeEmail(email));
}

/**
 * Check for potentially malicious email patterns
 * @param email Email address to check
 * @returns true if email appears safe, false if suspicious
 */
export function isEmailSafe(email: string): boolean {
  // Check for common injection patterns
  const suspiciousPatterns = [
    /\bjavascript:/i,
    /\bdata:/i,
    /\bvbscript:/i,
    /\bon\w+\s*=/i, // onload=, onclick=, etc.
    /<script/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /\beval\s*\(/i,
    /\bsetTimeout\s*\(/i,
    /\bsetInterval\s*\(/i,
  ];

  return !suspiciousPatterns.some((pattern) => pattern.test(email));
}

/**
 * Normalize email address for consistent storage
 * @param email Email address
 * @returns Normalized email address
 */
export function normalizeEmail(email: string): string {
  const sanitized = sanitizeEmail(email);

  // Additional normalization for Gmail addresses
  const [localPart, domain] = sanitized.split('@');
  if (!localPart || !domain) {
    throw new BadRequestException('Invalid email format');
  }

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    // Remove dots from Gmail local part (they're ignored)
    const normalizedLocal = localPart.replace(/\./g, '');

    // Remove everything after + (Gmail alias)
    const withoutAlias = normalizedLocal.split('+')[0];

    return `${withoutAlias}@gmail.com`;
  }

  return sanitized;
}

/**
 * Extract domain from email address safely
 * @param email Email address
 * @returns Domain part of email
 */
export function extractEmailDomain(email: string): string {
  const sanitized = sanitizeEmail(email);
  const domain = sanitized.split('@')[1];

  if (!domain) {
    throw new BadRequestException('Invalid email format');
  }

  return domain;
}

/**
 * Check if email domain is from a disposable email provider
 * @param email Email address
 * @returns true if domain appears to be disposable
 */
export function isDisposableEmail(email: string): boolean {
  const domain = extractEmailDomain(email);

  // Common disposable email domains (not exhaustive)
  const disposableDomains = [
    '10minutemail.com',
    'tempmail.org',
    'guerrillamail.com',
    'mailinator.com',
    'temp-mail.org',
    'yopmail.com',
    'throwaway.email',
    'getnada.com',
  ];

  return disposableDomains.includes(domain);
}

/**
 * Sanitize artifact title to prevent invalid names and security issues
 * @param title Raw title input (can be undefined, null, or string)
 * @param fallbackTitle Optional fallback title if input is invalid
 * @returns Sanitized title string
 */
export function sanitizeArtifactTitle(
  title: string | undefined | null,
  fallbackTitle = 'Untitled Artifact',
): string {
  // Handle null/undefined input
  if (!title || typeof title !== 'string') {
    return fallbackTitle;
  }

  // Remove leading/trailing whitespace
  let sanitized = title.trim();

  // If empty after trimming, use fallback
  if (!sanitized) {
    return fallbackTitle;
  }

  // Remove null bytes (potential injection)
  sanitized = sanitized.replace(/\0/g, '');

  // Remove control characters except tabs and newlines (convert to spaces)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Convert tabs and newlines to spaces
  sanitized = sanitized.replace(/[\t\n\r]/g, ' ');

  // Remove Unicode direction override characters (potential spoofing)
  sanitized = sanitized.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');

  // Remove potentially dangerous HTML tags and script content
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // Remove remaining angle brackets
  sanitized = sanitized.replace(/[<>]/g, '');

  // Collapse multiple spaces into single spaces
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Trim again after cleanup
  sanitized = sanitized.trim();

  // Limit length to reasonable title size (prevent database issues)
  const maxLength = 200;
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength).trim();
    // Ensure we don't cut off mid-word
    const lastSpaceIndex = sanitized.lastIndexOf(' ');
    if (lastSpaceIndex > maxLength * 0.8) {
      sanitized = sanitized.substring(0, lastSpaceIndex);
    }
    sanitized = sanitized + '...';
  }

  // If all sanitization resulted in empty string, use fallback
  if (!sanitized) {
    return fallbackTitle;
  }

  return sanitized;
}

/**
 * Generate a safe artifact title from question text
 * @param questionText Question text that may come from LLM
 * @returns Safe title for artifact
 */
export function generateQAPairTitle(
  questionText: string | undefined | null,
): string {
  if (!questionText || typeof questionText !== 'string') {
    return 'Q&A Response';
  }

  const sanitizedQuestion = sanitizeArtifactTitle(
    questionText,
    'Unknown Question',
  );
  return `Response to "${sanitizedQuestion}"`;
}
