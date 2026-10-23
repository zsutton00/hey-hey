import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { OrganizationId, ProjectId } from '../../types';
import { PrismaService } from '../../prisma/prisma.service';
import { FlowUserMessage } from '../../types/flow-internal.types';
import { ContextAwareLogger } from '../../core/logging/context-aware-logger.service';
import { sanitizePrompt as sanitizePromptUtil } from '../llm/prompt-security.util';

// Validation schemas
const UserMessageSchema = z.object({
  text: z.string().max(10000).nullable().optional(),
  data: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
  type: z.string().nullable().optional(),
  timestamp: z.union([z.string(), z.date()]),
  metadata: z.record(z.unknown()).nullable().optional(),
});

const PromptInjectionPatterns = [
  /ignore\s+(previous|prior)\s+instructions/i,
  /disregard\s+all\s+(prior|previous)/i,
  /forget\s+everything/i,
  /system\s*:\s*you\s+are/i,
  /\{\{.*\}\}/g, // Template injection
  /<script.*?>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi, // Event handlers
];

@Injectable()
export class FlowSecurityService {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    FlowSecurityService.name,
  );
  constructor(private prisma: PrismaService) {}

  /**
   * Sanitizes text to prevent prompt injection
   */
  sanitizeText(text: string): string {
    // Check for injection patterns
    for (const pattern of PromptInjectionPatterns) {
      if (pattern.test(text)) {
        throw new BadRequestException('Potentially harmful content detected');
      }
    }

    // Remove any template syntax that could be interpreted
    let sanitized = text.replace(/\{\{.*?\}\}/g, '[TEMPLATE_REMOVED]');

    // Escape special characters that could be interpreted as instructions
    sanitized = sanitized
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    // Limit consecutive whitespace
    sanitized = sanitized.replace(/\s{3,}/g, '  ');

    return sanitized.trim();
  }

  /**
   * Sanitizes prompts before sending to LLM
   * Delegates to shared utility function for consistency
   */
  sanitizePrompt(prompt: string): string {
    return sanitizePromptUtil(prompt);
  }

  /**
   * Validates user authorization for a project
   */
  async validateProjectAccess(
    userId: string,
    projectId: ProjectId,
    organizationId: OrganizationId,
    requiredRole?: 'viewer' | 'contributor' | 'admin',
  ): Promise<void> {
    // Check if user belongs to organization
    const userOrg = await this.prisma.db.organizationMember.findFirst({
      where: {
        userId,
        organizationId,
        isActive: true,
      },
    });

    if (!userOrg) {
      throw new ForbiddenException(
        'Access denied: Not a member of this organization',
      );
    }

    // Check if project belongs to organization
    const project = await this.prisma.db.project.findFirst({
      where: {
        id: projectId,
        organizationId,
        deletedAt: null,
      },
    });

    if (!project) {
      this.logger.debug(`[] Access denied: Project not found in organization`, {
        userId,
        projectId,
        organizationId,
      });
      throw new ForbiddenException(
        'Access denied: Project not found in organization',
      );
    }

    // Check user role if specified
    if (requiredRole) {
      const hasRequiredRole = this.checkUserRole(userOrg.role, requiredRole);
      if (!hasRequiredRole) {
        throw new ForbiddenException(
          `Access denied: ${requiredRole} role required`,
        );
      }
    }
  }

  /**
   * Validates organization ownership
   */
  async validateOrganizationOwnership(
    userId: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    // Allow system users to bypass organization membership checks
    // TODO: Remove this once we have a proper system user
    if (userId === 'system') {
      return;
    }

    const userOrg = await this.prisma.db.organizationMember.findFirst({
      where: {
        userId,
        organizationId,
        isActive: true,
      },
    });

    if (!userOrg) {
      this.logger.debug(`[] Access denied: Not a member of this organization`, {
        userId,
        organizationId,
      });
      throw new ForbiddenException(
        'Access denied: Not a member of this organization',
      );
    }
  }

  /**
   * Validates flow execution permissions
   */
  async validateFlowExecution(
    userId: string,
    flowId: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    // First validate organization membership
    await this.validateOrganizationOwnership(userId, organizationId);

    // Check if flow is disabled for organization, otherwise we default open
    const flowPermission =
      await this.prisma.db.organizationFlowPermission.findFirst({
        where: {
          organizationId,
          flowId,
        },
      });

    if (flowPermission?.enabled === false) {
      throw new ForbiddenException(
        'Access denied: Flow disabled for organization',
      );
    }

    // Check rate limits
    const recentExecutions = await this.prisma.db.flowExecution.count({
      where: {
        userId,
        flowId,
        startedAt: {
          gte: new Date(Date.now() - 60 * 60 * 1000), // Last hour
        },
      },
    });

    const rateLimit = flowPermission?.rateLimit || 100;
    if (recentExecutions >= rateLimit) {
      throw new ForbiddenException('Rate limit exceeded for flow execution');
    }
  }

  /**
   * Masks sensitive data in prompts
   */
  maskSensitiveData(text: string): string {
    // Mask email addresses
    text = text.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[EMAIL_MASKED]',
    );

    // Mask phone numbers
    text = text.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE_MASKED]');

    // Mask credit card numbers
    text = text.replace(
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
      '[CC_MASKED]',
    );

    // Mask SSN
    text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_MASKED]');

    // Mask API keys and tokens (common patterns)
    text = text.replace(/\b[A-Za-z0-9]{32,}\b/g, '[TOKEN_MASKED]');

    return text;
  }

  /**
   * Masks sensitive data in prompts
   */
  maskSensitiveDataFromObject(
    obj: Record<string, string | number | boolean>,
  ): Record<string, string | number | boolean> {
    const masked = { ...obj };
    for (const [k, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        masked[k] = this.maskSensitiveData(value);
      }
    }
    return masked;
  }

  /**
   * Helper to check role hierarchy
   */
  private checkUserRole(
    userRole: string,
    requiredRole: 'viewer' | 'contributor' | 'admin',
  ): boolean {
    // Map OrganizationRole enum values to hierarchy levels
    const roleHierarchy = {
      VIEWER: 1,
      MEMBER: 2, // contributor equivalent
      ADMIN: 3,
      OWNER: 4,
      // Legacy string mappings for backwards compatibility
      viewer: 1,
      contributor: 2,
      admin: 3,
      owner: 4,
    };

    // Map required roles to OrganizationRole equivalents
    const requiredRoleMapping = {
      viewer: 'VIEWER',
      contributor: 'MEMBER',
      admin: 'ADMIN',
    };

    const userLevel =
      roleHierarchy[userRole as keyof typeof roleHierarchy] || 0;
    const mappedRequiredRole = requiredRoleMapping[requiredRole];
    const requiredLevel =
      roleHierarchy[mappedRequiredRole as keyof typeof roleHierarchy] || 0;

    return userLevel >= requiredLevel;
  }
}
