import { SessionRole } from '@hey-hey/contracts/api/models';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Context, Tool } from '@rekog/mcp-nest';
import type { Request } from 'express';
import { z } from 'zod';
import { WorkItemTypeEffectiveSource } from '@hey-hey/contracts/api/models';
import { WorkItemTypeLifecycleStatus } from '@hey-hey/contracts/api/models';
import type { WorkItemTypeSummaryDto } from '@hey-hey/contracts/api/models';
import { ProjectService } from '../../services/project.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveProjectId,
} from './mcp-tool.utils';
import type { WorkItemTypeGuidanceBatchDto } from '@hey-hey/contracts/api/models';
import type { WorkItemTypeGuidanceBatchRequestDto } from '@hey-hey/contracts/api/models';
import { WorkItemTypeGuidancePurpose } from '@hey-hey/contracts/api/models';
import { workItemTypeGuidanceResponseSchema } from '../../services/tasks/work-item-type-agent-guidance.schema';
import {
  resolveWorkItemStatusAuthoring,
  statusAuthoringRequestSchema,
} from '../../services/tasks/work-item-status-inference';
import { workItemTypeStatusSchema } from '../../services/tasks/work-item-type-status.schema';
import type { WorkItemStatusAuthoringResponse } from '@hey-hey/contracts/api/models';

// MCP schema generation requires a plain ZodObject; the handler enforces
// the conditional sessionRole requirement instead of a top-level refinement.
export const getWorkItemTypeGuidanceBatchParameters = z
  .object({
    typeKeys: z
      .array(z.string())
      .min(1)
      .max(10)
      .refine((typeKeys) => new Set(typeKeys).size === typeKeys.length, {
        message: 'typeKeys must contain distinct values',
      }),
    purpose: z.nativeEnum(WorkItemTypeGuidancePurpose),
    sessionRole: z.nativeEnum(SessionRole).optional(),
  })
  .strict() satisfies z.ZodType<WorkItemTypeGuidanceBatchRequestDto>;

export const getWorkItemTypeGuidanceBatchOutput = z
  .object({
    results: z.array(workItemTypeGuidanceResponseSchema).min(1).max(10),
  })
  .strict() satisfies z.ZodType<WorkItemTypeGuidanceBatchDto>;

export const getWorkItemTypeParameters = z
  .object({
    typeKey: z
      .string()
      .min(1)
      .describe('Stable key of the work-item type to read.'),
  })
  .strict();

export const getWorkItemTypeOutput = z
  .object({
    id: z.string(),
    // The registry already validated the stored definition when it loaded it.
    // Re-narrowing it here would hide settings or make a type unreadable.
    definition: z.record(z.unknown()),
    status: z.nativeEnum(WorkItemTypeLifecycleStatus),
    projectId: z.string(),
    effectiveSource: z.nativeEnum(WorkItemTypeEffectiveSource),
  })
  .strict();

@Injectable()
export class WorkItemTypeToolsProvider {
  private readonly logger = new Logger(WorkItemTypeToolsProvider.name);

  constructor(
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    private readonly projectService: ProjectService,
  ) {}

  @Tool({
    name: 'resolve_work_item_type_statuses',
    description:
      "Validate a status list and suggest Hey Hey's standard statuses. Each status is a name plus exactly one meaning: COMPLETED, CANCELLED, IN_PROGRESS, or CUSTOM with 1-50 characters of text in the user's own words. Standard names (any case) may omit the meaning and take the standard one; every other name must state its meaning, otherwise the call is rejected naming those statuses, so ask the user which meaning each has instead of guessing. Omit statuses to receive the standard list. Pass existing statuses unchanged when editing.",
    parameters: statusAuthoringRequestSchema,
    outputSchema: z
      .object({
        suggestions: z.array(z.string()),
        statuses: z.array(workItemTypeStatusSchema),
      })
      .strict(),
  })
  async resolveStatuses(
    params: z.infer<typeof statusAuthoringRequestSchema>,
    _context: Context,
    request: Request,
  ): Promise<WorkItemStatusAuthoringResponse | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) {
      this.logger.error('resolve_work_item_type_statuses: auth rejected', {
        cause: auth,
      });

      return auth;
    }
    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) {
      this.logger.error('resolve_work_item_type_statuses: project rejected', {
        cause: projectId,
      });

      return projectId;
    }
    if (!(await this.projectService.findOne(projectId, auth.organizationId))) {
      this.logger.error('resolve_work_item_type_statuses: project not found', {
        projectId,
      });

      return mcpError('Project not found or not accessible.');
    }
    try {
      return resolveWorkItemStatusAuthoring(params);
    } catch (error) {
      this.logger.error('resolve_work_item_type_statuses: invalid statuses', {
        projectId,
        cause: error,
      });

      return mcpError(
        error instanceof Error ? error.message : 'Invalid statuses.',
      );
    }
  }

  @Tool({
    name: 'get_work_item_type_guidance_batch',
    description:
      'Read project-effective guidance for 1–10 distinct work-item type keys from one snapshot, returning one shared-purpose projection per key in request order. Purpose maintenance returns type-owned maintenance advice, which may be absent. Purpose role requires explicit sessionRole (no default) and returns identity with optional advice.',
    parameters: getWorkItemTypeGuidanceBatchParameters,
    outputSchema: getWorkItemTypeGuidanceBatchOutput,
  })
  async getWorkItemTypeGuidanceBatch(
    params: z.infer<typeof getWorkItemTypeGuidanceBatchParameters>,
    _context: Context,
    request: Request,
  ): Promise<WorkItemTypeGuidanceBatchDto | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;
    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;
    if (!(await this.projectService.findOne(projectId, auth.organizationId))) {
      return mcpError('Project not found or not accessible.');
    }
    if (
      params.purpose === WorkItemTypeGuidancePurpose.Role &&
      params.sessionRole === undefined
    ) {
      return mcpError('sessionRole is required when purpose is role.');
    }
    try {
      return this.workItemTypeRegistry.getGuidanceBatch(projectId, params);
    } catch (error) {
      if (error instanceof NotFoundException) return mcpError(error.message);
      throw error;
    }
  }

  @Tool({
    name: 'get_work_item_type',
    description:
      'Read the complete project-effective work-item type summary before editing it. ' +
      'Use the returned definition as the base for a read-modify-submit edit.',
    parameters: getWorkItemTypeParameters,
    outputSchema: getWorkItemTypeOutput,
  })
  async getWorkItemType(
    params: z.infer<typeof getWorkItemTypeParameters>,
    _context: Context,
    request: Request,
  ): Promise<WorkItemTypeSummaryDto | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;

    const project = await this.projectService.findOne(
      projectId,
      auth.organizationId,
    );
    if (!project) {
      return mcpError('Project not found or not accessible.');
    }

    const summary = this.workItemTypeRegistry.getDefinition(
      projectId,
      params.typeKey,
    );
    if (!summary || summary.status === WorkItemTypeLifecycleStatus.Archived) {
      return mcpError(
        `Work-item type '${params.typeKey}' was not found or is unavailable in this project.`,
      );
    }

    this.logger.log(
      `get_work_item_type returned '${params.typeKey}' for project ${projectId}`,
    );
    return summary;
  }
}
