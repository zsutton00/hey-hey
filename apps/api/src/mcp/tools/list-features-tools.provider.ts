import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import {
  EntityContextService,
  type ListFeaturesResponseDto,
} from '../../services/entity-context/entity-context.service';
import type { OrganizationId, ProjectId } from '../../types';
import { featureTagSchema } from '../../types/feature-tag.types';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveProjectId,
} from './mcp-tool.utils';

const LIST_FEATURES_TOOL_NAME = 'list_features';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const listFeaturesParameters = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(
      `Maximum number of features to return per page. Defaults to ` +
        `${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}.`,
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      'Offset into the full pre-order DFS result set. Use with hasMore ' +
        'and total to paginate.',
    ),
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Project ID. Inferred from the session (X-Project-ID header) when ' +
        'omitted — matches every other MCP tool.',
    ),
});

const featureListItemSchema = z.object({
  id: z.string().describe('Feature task ID.'),
  name: z.string().describe('Feature task name.'),
  parentFeatureId: z
    .string()
    .nullable()
    .describe(
      'Parent FEATURE task ID, or null when this feature is a root in ' +
        "the project's feature hierarchy.",
    ),
  depth: z
    .number()
    .int()
    .min(0)
    .describe(
      'Depth in the hierarchy. 0 for roots, 1 for direct children, etc. ' +
        'When indented by depth the list reads as a tree.',
    ),
  tag: featureTagSchema
    .optional()
    .describe(
      'Coarse-grained classification of what this feature delivers ' +
        '(product, frontend, backend, infra, design, AI). Absent for ' +
        'pre-tag features that have not yet been back-filled.',
    ),
});

const listFeaturesOutput = z.object({
  items: z
    .array(featureListItemSchema)
    .describe(
      'Features in the current pagination window, ordered pre-order DFS ' +
        'across the full result set. Reading top-to-bottom shows the ' +
        'hierarchy as it would render when indented by depth.',
    ),
  total: z
    .number()
    .int()
    .min(0)
    .describe('Total number of features in the project (across all pages).'),
  hasMore: z
    .boolean()
    .describe(
      'True when more features exist beyond this window ' +
        '(offset + items.length < total).',
    ),
  limit: z.number().int().min(1).describe('Limit applied to this request.'),
  offset: z.number().int().min(0).describe('Offset applied to this request.'),
});

type ListFeaturesOutput = z.infer<typeof listFeaturesOutput>;

@Injectable()
export class ListFeaturesToolsProvider {
  private readonly logger = new Logger(ListFeaturesToolsProvider.name);

  constructor(private readonly entityContextService: EntityContextService) {}

  @Tool({
    name: LIST_FEATURES_TOOL_NAME,
    description:
      'Return every FEATURE-typed task in the current project as a flat ' +
      'list, ordered pre-order DFS so reading top-to-bottom shows the ' +
      'hierarchy. Each entry carries id, name, parentFeatureId (null ' +
      'for roots), and depth — enough to rebuild the tree in O(n) ' +
      "without a nested wire format. Designed as the bird's-eye " +
      'counterpart to semantic search_features: cheap to call freely ' +
      'for orientation, planning, and cross-feature reasoning. ' +
      'Project is inferred from the session — no projectId parameter ' +
      'needed in normal use.',
    parameters: listFeaturesParameters,
    outputSchema: listFeaturesOutput,
  })
  async listFeatures(
    params: z.infer<typeof listFeaturesParameters>,
    _context: Context,
    request: Request,
  ): Promise<ListFeaturesOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const { limit, offset } = params;
    const { organizationId } = auth;
    const resolvedProjectId = resolveProjectId(params, request);
    if (!isProjectId(resolvedProjectId)) return resolvedProjectId;
    const projectId = resolvedProjectId;

    this.logger.log('list_features called', {
      organizationId,
      projectId,
      limit,
      offset,
    });

    let result: ListFeaturesResponseDto;
    try {
      result = await this.entityContextService.listFeatures(
        organizationId as OrganizationId,
        projectId as ProjectId,
        limit,
        offset,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return mcpError(`Failed to list features: ${message}`);
    }

    return result;
  }
}
