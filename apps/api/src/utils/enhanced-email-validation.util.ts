import { BadRequestException } from '@nestjs/common';
import { isValidEmail } from './validation.util';
import { sanitizeEmail, isEmailSafe } from './sanitization.util';

/**
 * Enhanced email validation with multiple security layers
 */

export interface EmailValidationResult {
  isValid: boolean;
  sanitizedEmail?: string;
  errors: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  flags: EmailSecurityFlag[];
}

export interface EmailSecurityFlag {
  type:
    | 'DISPOSABLE'
    | 'SUSPICIOUS_PATTERN'
    | 'INVALID_FORMAT'
    | 'POTENTIAL_TYPOSQUATTING'
    | 'DOMAIN_RISK';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
}

/**
 * Comprehensive email validation with security analysis - optimized single-pass
 */
export function validateEmailEnhanced(email: string): EmailValidationResult {
  const result: EmailValidationResult = {
    isValid: false,
    errors: [],
    riskLevel: 'LOW',
    flags: [],
  };

  try {
    // Layer 1: Basic sanitization (done once)
    const sanitized = sanitizeEmail(email);
    result.sanitizedEmail = sanitized;

    // Extract domain once for reuse
    const domain = sanitized.split('@')[1];
    if (!domain) {
      result.errors.push('Invalid email format');
      result.flags.push({
        type: 'INVALID_FORMAT',
        severity: 'HIGH',
        description: 'Email does not conform to RFC 5322 standard',
      });
      result.riskLevel = 'HIGH';
      return result;
    }

    // Layer 2: Format validation
    if (!isValidEmail(sanitized)) {
      result.errors.push('Invalid email format');
      result.flags.push({
        type: 'INVALID_FORMAT',
        severity: 'HIGH',
        description: 'Email does not conform to RFC 5322 standard',
      });
      result.riskLevel = 'HIGH';
      return result;
    }

    // Layer 3: Security pattern detection
    if (!isEmailSafe(sanitized)) {
      result.errors.push('Email contains potentially malicious patterns');
      result.flags.push({
        type: 'SUSPICIOUS_PATTERN',
        severity: 'HIGH',
        description: 'Email contains patterns associated with security threats',
      });
      result.riskLevel = 'HIGH';
      return result;
    }

    // Layer 4: Disposable email detection (using pre-extracted domain)
    if (isDisposableEmailByDomain(domain)) {
      result.flags.push({
        type: 'DISPOSABLE',
        severity: 'MEDIUM',
        description: 'Email appears to be from a disposable email provider',
      });
      result.riskLevel =
        result.riskLevel === 'LOW' ? 'MEDIUM' : result.riskLevel;
    }

    // Layer 5: Domain risk assessment (using pre-extracted domain)
    const domainRisk = assessDomainRiskByDomain(domain);
    if (domainRisk.isRisky) {
      result.flags.push({
        type: 'DOMAIN_RISK',
        severity: domainRisk.severity,
        description: domainRisk.reason,
      });
      result.riskLevel =
        domainRisk.severity === 'HIGH'
          ? 'HIGH'
          : result.riskLevel === 'LOW'
            ? 'MEDIUM'
            : result.riskLevel;
    }

    // Layer 6: Typosquatting detection (using pre-extracted domain)
    const typoRisk = detectTyposquattingByDomain(domain);
    if (typoRisk.isRisky) {
      result.flags.push({
        type: 'POTENTIAL_TYPOSQUATTING',
        severity: 'MEDIUM',
        description: typoRisk.reason,
      });
      result.riskLevel =
        result.riskLevel === 'LOW' ? 'MEDIUM' : result.riskLevel;
    }

    result.isValid = true;
    return result;
  } catch (_error) {
    result.errors.push('Email validation failed');
    result.riskLevel = 'HIGH';
    return result;
  }
}

/**
 * Optimized disposable email detection using domain only (no re-sanitization)
 */
function isDisposableEmailByDomain(domain: string): boolean {
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
 * Optimized domain risk assessment using domain only (no re-sanitization)
 */
function assessDomainRiskByDomain(domain: string): {
  isRisky: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
} {
  // Check for suspicious domain patterns
  const suspiciousDomains = [
    // Common attack patterns
    /.*-secure\.com$/i,
    /.*-verification\.com$/i,
    /.*-update\.org$/i,
    /.*paypal.*\.tk$/i,
    /.*amazon.*\.ml$/i,
    /.*apple.*\.ga$/i,
  ];

  for (const pattern of suspiciousDomains) {
    if (pattern.test(domain)) {
      return {
        isRisky: true,
        severity: 'HIGH',
        reason: 'Domain matches known phishing patterns',
      };
    }
  }

  // Check for very new or unusual TLDs that might indicate risk
  const riskyTlds = ['.tk', '.ml', '.ga', '.cf', '.gq'];
  if (riskyTlds.some((tld) => domain.endsWith(tld))) {
    return {
      isRisky: true,
      severity: 'MEDIUM',
      reason: 'Domain uses TLD commonly associated with abuse',
    };
  }

  // Check domain length (very long domains can be suspicious)
  if (domain.length > 50) {
    return {
      isRisky: true,
      severity: 'MEDIUM',
      reason: 'Unusually long domain name',
    };
  }

  return { isRisky: false, severity: 'LOW', reason: '' };
}

/**
 * Optimized typosquatting detection using domain only (no re-sanitization)
 */
function detectTyposquattingByDomain(domain: string): {
  isRisky: boolean;
  reason: string;
} {
  // Common legitimate domains to check against
  const legitimateDomains = [
    'gmail.com',
    'yahoo.com',
    'outlook.com',
    'hotmail.com',
    'amazon.com',
    'apple.com',
    'google.com',
    'microsoft.com',
    'facebook.com',
    'twitter.com',
    'linkedin.com',
  ];

  for (const legitDomain of legitimateDomains) {
    if (isTyposquattingCandidate(domain, legitDomain)) {
      return {
        isRisky: true,
        reason: `Domain appears to be typosquatting ${legitDomain}`,
      };
    }
  }

  return { isRisky: false, reason: '' };
}

/**
 * Validate multiple emails with batch processing and analysis
 */
export function validateEmailsBatch(emails: string[]): {
  results: EmailValidationResult[];
  summary: {
    totalEmails: number;
    validEmails: number;
    highRiskEmails: number;
    mediumRiskEmails: number;
    lowRiskEmails: number;
    commonFlags: EmailSecurityFlag[];
  };
} {
  const results = emails.map((email) => validateEmailEnhanced(email));

  const summary = {
    totalEmails: emails.length,
    validEmails: results.filter((r) => r.isValid).length,
    highRiskEmails: results.filter((r) => r.riskLevel === 'HIGH').length,
    mediumRiskEmails: results.filter((r) => r.riskLevel === 'MEDIUM').length,
    lowRiskEmails: results.filter((r) => r.riskLevel === 'LOW').length,
    commonFlags: analyzeCommonFlags(results),
  };

  return { results, summary };
}

/**
 * Check if a domain is a potential typosquatting candidate
 */
function isTyposquattingCandidate(domain: string, legitimate: string): boolean {
  // Skip if domains are identical
  if (domain === legitimate) return false;

  // Check for character substitution (gmail.com vs gmai1.com)
  if (domain.length === legitimate.length) {
    let differences = 0;
    for (let i = 0; i < domain.length; i++) {
      if (domain[i] !== legitimate[i]) {
        differences++;
      }
    }
    // If only 1-2 character differences, might be typosquatting
    return differences >= 1 && differences <= 2;
  }

  // Check for character insertion/deletion (gmail.com vs gmaail.com)
  const lengthDiff = Math.abs(domain.length - legitimate.length);
  if (lengthDiff === 1) {
    const shorter = domain.length < legitimate.length ? domain : legitimate;
    const longer = domain.length < legitimate.length ? legitimate : domain;

    // Try removing each character from longer string to see if it matches shorter
    for (let i = 0; i < longer.length; i++) {
      const modified = longer.slice(0, i) + longer.slice(i + 1);
      if (modified === shorter) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Analyze common security flags across a batch of emails
 */
function analyzeCommonFlags(
  results: EmailValidationResult[],
): EmailSecurityFlag[] {
  const flagCounts = new Map<
    string,
    { count: number; flag: EmailSecurityFlag }
  >();

  results.forEach((result) => {
    result.flags.forEach((flag) => {
      const key = `${flag.type}-${flag.severity}`;
      if (flagCounts.has(key)) {
        const existing = flagCounts.get(key);
        if (existing) {
          existing.count++;
        }
      } else {
        flagCounts.set(key, { count: 1, flag });
      }
    });
  });

  // Return flags that appear in more than 20% of emails
  const threshold = Math.max(1, Math.floor(results.length * 0.2));
  return Array.from(flagCounts.values())
    .filter((item) => item.count >= threshold)
    .map((item) => item.flag);
}

/**
 * Check if email batch has concerning patterns
 */
export function detectBatchAnomalies(
  validationResults: EmailValidationResult[],
): {
  hasAnomalies: boolean;
  anomalies: string[];
  riskScore: number;
} {
  const anomalies: string[] = [];
  let riskScore = 0;

  const highRiskCount = validationResults.filter(
    (r) => r.riskLevel === 'HIGH',
  ).length;
  const mediumRiskCount = validationResults.filter(
    (r) => r.riskLevel === 'MEDIUM',
  ).length;

  // Check for high percentage of risky emails
  const riskPercentage =
    (highRiskCount + mediumRiskCount) / validationResults.length;
  if (riskPercentage > 0.5) {
    anomalies.push('High percentage of risky email addresses in batch');
    riskScore += 30;
  }

  // Check for many disposable emails
  const disposableCount = validationResults.filter((r) =>
    r.flags.some((f) => f.type === 'DISPOSABLE'),
  ).length;
  if (disposableCount > validationResults.length * 0.3) {
    anomalies.push('Unusually high number of disposable email addresses');
    riskScore += 20;
  }

  // Check for potential coordinated attack patterns
  const domains = validationResults
    .filter((r) => r.sanitizedEmail)
    .map((r) => r.sanitizedEmail?.split('@')[1])
    .filter((domain): domain is string => domain !== undefined);
  const uniqueDomains = new Set(domains);

  if (domains.length > 5 && uniqueDomains.size === 1) {
    anomalies.push(
      'All emails from single domain - potential coordinated account creation',
    );
    riskScore += 25;
  }

  return {
    hasAnomalies: anomalies.length > 0,
    anomalies,
    riskScore: Math.min(100, riskScore),
  };
}
