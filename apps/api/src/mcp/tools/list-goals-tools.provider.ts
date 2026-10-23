import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import {
  EntityContextService,
  type ListGoalsResponseDto,
} from '../../services/entity-context/entity-context.service';
import { WorkStatus } from '../../generated';
import type { OrganizationId, ProjectId } from '../../types';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveProjectId,
} from './mcp-tool.utils';

const LIST_GOALS_TOOL_NAME = 'list_goals';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

// Mirrors the MCP→WorkStatus mapping in search-tools.provider.ts so
// list_goals and search_goals normalize the same simplified status
// surface (BACKLOG / IN_PROGRESS / IN_REVIEW / DONE / CANCELLED) onto
// the underlying WorkStatus enum.
const MCP_TO_WORK_STATUSES: Record<string, WorkStatus[]> = {
  BACKLOG: [
    WorkStatus.Generated,
    WorkStatus.Backlog,
    WorkStatus.RefiningDescription,
    WorkStatus.RefiningDetails,
    WorkStatus.RefiningAcceptanceCriteria,
    WorkStatus.GeneratingDescription,
    WorkStatus.GeneratingDetails,
    WorkStatus.GeneratingDescriptionAndDetails,
    WorkStatus.GeneratingAcceptanceCriteria,
    WorkStatus.GeneratingAll,
    WorkStatus.OnHold,
  ],
  IN_PROGRESS: [WorkStatus.Active],
  IN_REVIEW: [WorkStatus.Verifying],
  DONE: [WorkStatus.Completed],
  CANCELLED: [WorkStatus.Cancelled],
};

const listGoalsParameters = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(
      `Maximum number of goals to return per page. Defaults to ` +
        `${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}.`,
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      'Offset into the full result set. Use with hasMore and total to ' +
        'paginate.',
    ),
  status: z
    .enum(['BACKLOG', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'])
    .optional()
    .describe(
      'Filter goals by simplified status. BACKLOG covers all not-yet-active ' +
        'states (generated, refining, on hold); IN_PROGRESS is active work; ' +
        'IN_REVIEW is the verification phase; DONE / CANCELLED are terminal.',
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

const goalListItemSchema = z.object({
  id: z.string().describe('Goal task ID.'),
  name: z.string().describe('Goal name.'),
  status: z
    .string()
    .describe(
      'Underlying WorkStatus value (e.g. ACTIVE, COMPLETED). ' +
        'Use the simplified `status` filter to query by lifecycle stage.',
    ),
  dueDate: z
    .string()
    .nullable()
    .describe(
      'Target date as an ISO 8601 datetime, or null for an undated Goal.',
    ),
});

const listGoalsOutput = z.object({
  items: z
    .array(goalListItemSchema)
    .describe(
      'Goals in the current pagination window, ordered by dueDate ' +
        'ascending then name ascending — soonest-deadline first.',
    ),
  total: z
    .number()
    .int()
    .min(0)
    .describe('Total number of goals in the project (across all pages).'),
  hasMore: z
    .boolean()
    .describe(
      'True when more goals exist beyond this window ' +
        '(offset + items.length < total).',
    ),
  limit: z.number().int().min(1).describe('Limit applied to this request.'),
  offset: z.number().int().min(0).describe('Offset applied to this request.'),
});

type ListGoalsOutput = z.infer<typeof listGoalsOutput>;

@Injectable()
export class ListGoalsToolsProvider {
  private readonly logger = new Logger(ListGoalsToolsProvider.name);

  constructor(private readonly entityContextService: EntityContextService) {}

  @Tool({
    name: LIST_GOALS_TOOL_NAME,
    description:
      'Return every GOAL-typed task in the current project as a flat ' +
      'list. Goals are flat by design (they cannot appear in the feature ' +
      'hierarchy and have no parent/child links), so the listing has no ' +
      'depth or parent fields. Items are ordered by dueDate ascending ' +
      'then name, with undated Goals after dated Goals. ' +
      "Designed as the bird's-eye counterpart to semantic search_goals: " +
      'cheap to call freely for orientation, status sweeps, and ' +
      'cross-goal reasoning. Project is inferred from the session — no ' +
      'projectId parameter needed in normal use.',
    parameters: listGoalsParameters,
    outputSchema: listGoalsOutput,
  })
  async listGoals(
    params: z.infer<typeof listGoalsParameters>,
    _context: Context,
    request: Request,
  ): Promise<ListGoalsOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const { limit, offset, status } = params;
    const { organizationId } = auth;
    const resolvedProjectId = resolveProjectId(params, request);
    if (!isProjectId(resolvedProjectId)) return resolvedProjectId;
    const projectId = resolvedProjectId;

    const mappedStatuses = status ? MCP_TO_WORK_STATUSES[status] : undefined;

    this.logger.log('list_goals called', {
      organizationId,
      projectId,
      limit,
      offset,
      status,
    });

    let result: ListGoalsResponseDto;
    try {
      result = await this.entityContextService.listGoals(
        organizationId as OrganizationId,
        projectId as ProjectId,
        limit,
        offset,
        mappedStatuses,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return mcpError(`Failed to list goals: ${message}`);
    }

    return result;
  }
}
