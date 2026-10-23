import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import {
  EntityContextService,
  type FeatureSyncContextDto,
} from '../../services/entity-context/entity-context.service';
import type { OrganizationId, ProjectId, TaskId } from '../../types';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveProjectId,
} from './mcp-tool.utils';

const GET_FEATURE_SYNC_CONTEXT_TOOL_NAME = 'get_feature_sync_context';

const getFeatureSyncContextParameters = z.object({
  taskId: z
    .string()
    .uuid()
    .describe('ID of the task whose ancestor feature chain to return'),
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Project ID the task belongs to. Inferred from session when omitted.',
    ),
});

const ancestorFeatureSchema = z.object({
  id: z.string().describe('Feature task ID'),
  name: z.string().describe('Feature task name'),
  description: z
    .string()
    .nullable()
    .describe(
      "The feature's full description content (materialized markdown). " +
        'Null when the feature has no description section.',
    ),
  requirements: z
    .string()
    .nullable()
    .describe(
      "The feature's full requirements content as canonical JSON. " +
        'Features use a requirements section — not acceptanceCriteria, ' +
        'which is reserved for STANDARD and BUG tasks. Null when the ' +
        'feature has no requirements section.',
    ),
  distance: z
    .number()
    .int()
    .min(1)
    .describe(
      'Number of hops from the queried task up to this ancestor. 1 is the ' +
        'nearest ancestor; the chain is ordered by distance ascending.',
    ),
});

const getFeatureSyncContextOutput = z.object({
  taskId: z.string().describe('ID of the task whose ancestors were walked'),
  ancestorFeatures: z
    .array(ancestorFeatureSchema)
    .describe(
      'FEATURE-typed ancestors of the task, in walk order (nearest first). ' +
        'Non-feature ancestors are filtered out. A task with no structural ' +
        'feature ancestor of its own that is tracked by a plan falls back to ' +
        "the plan's delivered feature and its ancestors (the delivered " +
        'feature reads as distance 1). Empty only when neither a structural ' +
        'nor a plan-resident feature chain exists.',
    ),
});

type GetFeatureSyncContextOutput = z.infer<typeof getFeatureSyncContextOutput>;

@Injectable()
export class GetFeatureSyncContextToolsProvider {
  private readonly logger = new Logger(GetFeatureSyncContextToolsProvider.name);

  constructor(private readonly entityContextService: EntityContextService) {}

  @Tool({
    name: GET_FEATURE_SYNC_CONTEXT_TOOL_NAME,
    description:
      'Feature-sync sub-agent only. Returns the ancestor FEATURE chain for ' +
      "a task with each feature's full description and requirements inline, " +
      'in walk order (nearest first). Purpose-built for hierarchy walks ' +
      'that need authoritative text — drift and enrichment checks — ' +
      'without per-entity get_full_entity round-trips. Non-feature ' +
      'ancestors (standard tasks, design docs) are filtered out. Other ' +
      'sub-agents (commit, code-review, general) continue to use the lean ' +
      'get_context and should not call this tool.',
    parameters: getFeatureSyncContextParameters,
    outputSchema: getFeatureSyncContextOutput,
  })
  async getFeatureSyncContext(
    params: z.infer<typeof getFeatureSyncContextParameters>,
    _context: Context,
    request: Request,
  ): Promise<GetFeatureSyncContextOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const { taskId } = params;
    const { organizationId } = auth;
    const resolvedProjectId = resolveProjectId(params, request);
    if (!isProjectId(resolvedProjectId)) return resolvedProjectId;
    const projectId = resolvedProjectId;

    this.logger.log('get_feature_sync_context called', {
      organizationId,
      projectId,
      taskId,
    });

    let result: FeatureSyncContextDto;
    try {
      result = await this.entityContextService.getFeatureSyncContext(
        organizationId as OrganizationId,
        projectId as ProjectId,
        taskId as TaskId,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return mcpError(error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      return mcpError(`Failed to load feature-sync context: ${message}`);
    }

    return result;
  }
}
