import { Injectable, Logger } from '@nestjs/common';
import { OrganizationId, UserId } from '../types';
import { OrganizationRole } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface SecurityEvent {
  eventType: string;
  userId: UserId;
  organizationId: OrganizationId;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface BulkInviteSecurityMetadata extends Record<string, unknown> {
  batchSize: number;
  uniqueEmails: number;
  requestedRoles: OrganizationRole[];
  inviterRole: OrganizationRole;
  successfulInvites: number;
  failedInvites: number;
  processingTimeMs: number;
}

@Injectable()
export class SecurityLoggerService {
  private readonly logger = new Logger(SecurityLoggerService.name);
  private readonly failureTracker = new Map<
    string,
    { count: number; lastAttempt: Date; emails: Set<string> }
  >();
  private readonly bulkOperationTracker = new Map<
    string,
    { count: number; firstAttempt: Date; totalEmails: number }
  >();

  /**
   * Log a security event with structured data and correlation ID
   */
  logSecurityEvent(event: SecurityEvent): string {
    const correlationId = event.correlationId || this.generateCorrelationId();
    const logEntry = {
      eventType: event.eventType,
      userId: event.userId,
      organizationId: event.organizationId,
      timestamp: event.timestamp || new Date(),
      metadata: event.metadata || {},
      sessionId: event.sessionId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      correlationId,
      severity: event.severity || this.determineSeverity(event.eventType),
    };

    // Log at appropriate level based on severity
    switch (logEntry.severity) {
      case 'CRITICAL':
        this.logger.error(`SECURITY_EVENT: ${event.eventType}`, logEntry);
        break;
      case 'HIGH':
        this.logger.warn(`SECURITY_EVENT: ${event.eventType}`, logEntry);
        break;
      case 'MEDIUM':
        this.logger.warn(`SECURITY_EVENT: ${event.eventType}`, logEntry);
        break;
      case 'LOW':
        this.logger.log(`SECURITY_EVENT: ${event.eventType}`, logEntry);
        break;
    }

    return correlationId;
  }

  /**
   * Log bulk invitation attempt with detailed metadata and anomaly detection
   */
  logBulkInviteAttempt(
    userId: UserId,
    organizationId: OrganizationId,
    metadata: BulkInviteSecurityMetadata,
  ): string {
    // Track bulk operation patterns for anomaly detection
    this.trackBulkOperation(userId, organizationId, metadata.batchSize);

    const correlationId = this.logSecurityEvent({
      eventType: 'BULK_INVITE_ATTEMPT',
      userId,
      organizationId,
      metadata: {
        ...metadata,
        operationId: this.generateOperationId(userId, organizationId),
      },
    });

    return correlationId;
  }

  /**
   * Log successful bulk invitation completion
   */
  logBulkInviteSuccess(
    userId: UserId,
    organizationId: OrganizationId,
    metadata: BulkInviteSecurityMetadata,
    correlationId?: string,
  ): string {
    return this.logSecurityEvent({
      eventType: 'BULK_INVITE_SUCCESS',
      userId,
      organizationId,
      metadata,
      correlationId,
    });
  }

  /**
   * Log failed invitation attempts (security concern)
   */
  logBulkInviteFailure(
    userId: UserId,
    organizationId: OrganizationId,
    errorType: string,
    metadata: Partial<BulkInviteSecurityMetadata>,
    correlationId?: string,
  ): string {
    return this.logSecurityEvent({
      eventType: 'BULK_INVITE_FAILURE',
      userId,
      organizationId,
      metadata: {
        ...metadata,
        errorType,
      },
      correlationId,
    });
  }

  /**
   * Log role escalation attempts (high security risk)
   */
  logRoleEscalationAttempt(
    userId: UserId,
    organizationId: OrganizationId,
    attemptedRole: OrganizationRole,
    inviterRole: OrganizationRole,
  ): void {
    this.logSecurityEvent({
      eventType: 'ROLE_ESCALATION_ATTEMPT',
      userId,
      organizationId,
      metadata: {
        attemptedRole,
        inviterRole,
        severity: 'HIGH',
      },
    });
  }

  /**
   * Log excessive batch size attempts (potential DoS)
   */
  logExcessiveBatchAttempt(
    userId: UserId,
    organizationId: OrganizationId,
    requestedSize: number,
    maxAllowed: number,
  ): void {
    this.logSecurityEvent({
      eventType: 'EXCESSIVE_BATCH_ATTEMPT',
      userId,
      organizationId,
      metadata: {
        requestedSize,
        maxAllowed,
        severity: 'MEDIUM',
      },
    });
  }

  /**
   * Log invalid email format attempts (potential enumeration)
   */
  logInvalidEmailAttempt(
    userId: UserId,
    organizationId: OrganizationId,
    invalidEmailCount: number,
    totalEmails: number,
  ): void {
    this.logSecurityEvent({
      eventType: 'INVALID_EMAIL_ATTEMPT',
      userId,
      organizationId,
      metadata: {
        invalidEmailCount,
        totalEmails,
        severity: 'LOW',
      },
    });
  }

  /**
   * Log individual member invitation events
   */
  logMemberInvited(
    userId: UserId,
    organizationId: OrganizationId,
    invitedEmail: string,
    assignedRole: OrganizationRole,
  ): void {
    this.logSecurityEvent({
      eventType: 'MEMBER_INVITED',
      userId,
      organizationId,
      metadata: {
        invitedEmail: this.maskEmail(invitedEmail),
        assignedRole,
      },
    });
  }

  /**
   * Log rate limiting events
   */
  logRateLimitExceeded(
    userId: UserId,
    organizationId: OrganizationId,
    endpoint: string,
    currentRate: number,
    limit: number,
  ): void {
    this.logSecurityEvent({
      eventType: 'RATE_LIMIT_EXCEEDED',
      userId,
      organizationId,
      metadata: {
        endpoint,
        currentRate,
        limit,
        severity: 'MEDIUM',
      },
    });
  }

  /**
   * Generate correlation ID for tracking related events
   */
  private generateCorrelationId(): string {
    return `corr-${randomUUID()}`;
  }

  /**
   * Generate operation ID for bulk operations
   */
  private generateOperationId(
    userId: UserId,
    organizationId: OrganizationId,
  ): string {
    const timestamp = Date.now();
    return `op-${userId}-${organizationId}-${timestamp}`;
  }

  /**
   * Determine severity based on event type
   */
  private determineSeverity(
    eventType: string,
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const severityMap: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> =
      {
        ROLE_ESCALATION_ATTEMPT: 'CRITICAL',
        MALICIOUS_EMAIL_ATTEMPT: 'HIGH',
        EXCESSIVE_BATCH_ATTEMPT: 'HIGH',
        BULK_INVITE_FAILURE: 'MEDIUM',
        RATE_LIMIT_EXCEEDED: 'MEDIUM',
        INVALID_EMAIL_ATTEMPT: 'LOW',
        BULK_INVITE_ATTEMPT: 'LOW',
        BULK_INVITE_SUCCESS: 'LOW',
        MEMBER_INVITED: 'LOW',
      };
    return severityMap[eventType] || 'MEDIUM';
  }

  /**
   * Track bulk operation patterns for anomaly detection
   */
  private trackBulkOperation(
    userId: UserId,
    organizationId: OrganizationId,
    batchSize: number,
  ): void {
    const key = `${userId}-${organizationId}`;
    const now = new Date();
    const existing = this.bulkOperationTracker.get(key);

    if (existing) {
      existing.count += 1;
      existing.totalEmails += batchSize;

      // Check for suspicious patterns (more than 5 bulk operations in 1 hour)
      const timeSinceFirst = now.getTime() - existing.firstAttempt.getTime();
      if (timeSinceFirst < 3600000 && existing.count > 5) {
        // 1 hour in ms
        this.logSecurityEvent({
          eventType: 'SUSPICIOUS_BULK_PATTERN',
          userId,
          organizationId,
          severity: 'HIGH',
          metadata: {
            operationsInHour: existing.count,
            totalEmailsInHour: existing.totalEmails,
            pattern: 'EXCESSIVE_BULK_OPERATIONS',
          },
        });
      }
    } else {
      this.bulkOperationTracker.set(key, {
        count: 1,
        firstAttempt: now,
        totalEmails: batchSize,
      });
    }

    // Clean up old entries (older than 24 hours)
    this.cleanupTrackers();
  }

  /**
   * Track failed invitation attempts for anomaly detection
   */
  private trackFailedAttempts(
    userId: UserId,
    organizationId: OrganizationId,
    emails: string[],
  ): void {
    const key = `${userId}-${organizationId}`;
    const now = new Date();
    const existing = this.failureTracker.get(key);

    if (existing) {
      existing.count += emails.length;
      existing.lastAttempt = now;
      emails.forEach((email) => existing.emails.add(email));

      // Check for suspicious patterns (more than 20 failed invites in 1 hour)
      const timeSinceFirst = now.getTime() - existing.lastAttempt.getTime();
      if (timeSinceFirst < 3600000 && existing.count > 20) {
        // 1 hour in ms
        this.logSecurityEvent({
          eventType: 'SUSPICIOUS_FAILURE_PATTERN',
          userId,
          organizationId,
          severity: 'HIGH',
          metadata: {
            failedInvitesInHour: existing.count,
            uniqueEmailsAttempted: existing.emails.size,
            pattern: 'EXCESSIVE_FAILED_INVITES',
          },
        });
      }
    } else {
      this.failureTracker.set(key, {
        count: emails.length,
        lastAttempt: now,
        emails: new Set(emails),
      });
    }
  }

  /**
   * Clean up tracking data older than 24 hours
   */
  private cleanupTrackers(): void {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Clean bulk operation tracker
    for (const [key, data] of this.bulkOperationTracker.entries()) {
      if (data.firstAttempt < twentyFourHoursAgo) {
        this.bulkOperationTracker.delete(key);
      }
    }

    // Clean failure tracker
    for (const [key, data] of this.failureTracker.entries()) {
      if (data.lastAttempt < twentyFourHoursAgo) {
        this.failureTracker.delete(key);
      }
    }
  }

  /**
   * Determine if an event type represents high security risk (deprecated - use determineSeverity)
   */
  private isHighRiskEvent(eventType: string): boolean {
    return (
      this.determineSeverity(eventType) === 'HIGH' ||
      this.determineSeverity(eventType) === 'CRITICAL'
    );
  }

  /**
   * Mask email addresses for privacy compliance
   */
  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) {
      return email;
    }
    if (localPart.length <= 2) {
      return `${localPart[0]}***@${domain}`;
    }
    return `${localPart.substring(0, 2)}***@${domain}`;
  }
}
