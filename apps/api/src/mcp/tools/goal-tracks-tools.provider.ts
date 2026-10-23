import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import {
  AttachToGoalResponseDto,
  DetachFromGoalResponseDto,
  EntityType,
} from '../../generated';
import { GoalTracksService } from '../../services/tasks/goal-tracks.service';
import type { ProjectId, TaskId } from '../../types';
import {
  AuthContext,
  extractAuthContext,
  isAgentSessionId,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveAgentSessionId,
  resolveProjectId,
} from './mcp-tool.utils';
import { GOAL_TRACKS_TOOL_NAMES } from './proposal-tool-names';
import { validateAuthoringRootProof } from './authoring-guidance';

const ATTACH_TOOL_NAME = GOAL_TRACKS_TOOL_NAMES.ATTACH_TO_GOAL;
const DETACH_TOOL_NAME = GOAL_TRACKS_TOOL_NAMES.DETACH_FROM_GOAL;

const TARGET_ENTITY_TYPE_VALUES = ['TASK', 'DESIGN_DOC'] as const;

const attachToGoalParameters = z.object({
  authoringRootProof: z
    .string()
    .optional()
    .describe(
      'Reusable proof returned by get_authoring_guidance(). Required for this topology mutation.',
    ),
  goalId: z
    .string()
    .uuid()
    .describe(
      'ID of the source task that will track the entity. The source ' +
        "task's type must be one the work-item config marks as an " +
        'eligible tracking source (today only GOAL); other types are ' +
        'rejected at the boundary with a type-named 400.',
    ),
  targetEntityId: z
    .string()
    .uuid()
    .describe('ID of the entity to attach to the goal.'),
  targetEntityType: z
    .enum(TARGET_ENTITY_TYPE_VALUES)
    .describe(
      "Type of the target entity. The source type's config names which " +
        'target entity types and (for TASK targets) which target task ' +
        'subtypes are permitted; today a GOAL source accepts TASK ' +
        '(FEATURE / STANDARD / BUG) and PLAN, and rejects DESIGN_DOC.',
    ),
});

const detachFromGoalParameters = z.object({
  authoringRootProof: z
    .string()
    .optional()
    .describe(
      'Reusable proof returned by get_authoring_guidance(). Required for this topology mutation.',
    ),
  goalId: z
    .string()
    .uuid()
    .describe(
      'ID of the source task to detach from. The source task\'s type ' +
        'must be one the work-item config marks as an eligible tracking ' +
        'source (today only GOAL); other types are rejected at the ' +
        'boundary with a type-named 400.',
    ),
  targetEntityId: z
    .string()
    .uuid()
    .describe('ID of the entity to detach from the goal.'),
  targetEntityType: z
    .enum(TARGET_ENTITY_TYPE_VALUES)
    .describe('Type of the target entity to detach.'),
});

const trackedEntitySnapshotSchema = z.object({
  targetEntityId: z.string(),
  targetEntityType: z.string(),
  title: z.string(),
  status: z.string().optional(),
  dueDate: z.string().nullable().optional(),
});

const agentEdgeResponseSchema = z.object({
  id: z.string(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  type: z.string(),
  reasoning: z.string(),
  createdBySessionId: z.string(),
  lastModifiedBySessionId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const attachToGoalOutput = z.object({
  edge: agentEdgeResponseSchema,
  target: trackedEntitySnapshotSchema,
  created: z.boolean(),
});

const detachFromGoalOutput = z.object({
  deleted: z.boolean(),
  targetEntityId: z.string(),
  targetEntityType: z.string(),
});

type AttachOutput = z.infer<typeof attachToGoalOutput>;
type DetachOutput = z.infer<typeof detachFromGoalOutput>;

function requireToken(auth: AuthContext): string | CallToolResult {
  if (!auth.token) {
    return mcpError('Authentication token required for goal track operations.');
  }
  return auth.token;
}

function isToken(value: string | CallToolResult): value is string {
  return typeof value === 'string';
}

@Injectable()
export class GoalTracksToolsProvider {
  private readonly logger = new Logger(GoalTracksToolsProvider.name);

  constructor(private readonly goalTracksService: GoalTracksService) {}

  @Tool({
    name: ATTACH_TOOL_NAME,
    description:
      'Attach an entity to a tracking-source task by creating a TRACKS ' +
      'edge. The boundary handler enforces a config-driven allow-list: ' +
      "the source task's type must be one the work-item config marks " +
      'as eligible to own tracking links (today only GOAL), and the ' +
      "target must be permitted by that source type's config (today a " +
      'GOAL source accepts FEATURE / STANDARD / BUG tasks and PLAN; ' +
      'DESIGN_DOC and GOAL targets are rejected with a clear 400 that ' +
      'names the offending type). Idempotent: re-attaching the same ' +
      'target returns the existing edge with created=false. Project is ' +
      'resolved from the X-Project-ID header; agent session from ' +
      'X-Agent-Session-ID.',
    parameters: attachToGoalParameters,
    outputSchema: attachToGoalOutput,
  })
  async attachToGoal(
    params: z.infer<typeof attachToGoalParameters>,
    _context: Context,
    request: Request,
  ): Promise<AttachOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;

    const rootProofError = validateAuthoringRootProof({
      toolName: ATTACH_TOOL_NAME,
      token: params.authoringRootProof,
      required: true,
    });
    if (rootProofError) return mcpError(rootProofError);

    const sessionId = resolveAgentSessionId(request);
    if (!isAgentSessionId(sessionId)) return sessionId;

    const token = requireToken(auth);
    if (!isToken(token)) return token;

    this.logger.log('attach_to_goal called', {
      organizationId: auth.organizationId,
      projectId,
      goalId: params.goalId,
      targetEntityId: params.targetEntityId,
      targetEntityType: params.targetEntityType,
    });

    try {
      const result: AttachToGoalResponseDto =
        await this.goalTracksService.attachToGoal(
          auth.organizationId,
          projectId as ProjectId,
          params.goalId as TaskId,
          {
            targetEntityId: params.targetEntityId,
            targetEntityType: params.targetEntityType as EntityType,
          },
          sessionId,
          token,
        );
      return result as AttachOutput;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`attach_to_goal failed: ${message}`);
      return mcpError(`attach_to_goal failed: ${message}`);
    }
  }

  @Tool({
    name: DETACH_TOOL_NAME,
    description:
      'Remove a TRACKS edge owned by a tracking-source task. The source ' +
      "task's type must be one the work-item config marks as eligible " +
      'to own tracking links (today only GOAL); ineligible sources are ' +
      'rejected at the boundary with a clear 400 that names the ' +
      'offending type. Idempotent: detaching an entity that is not ' +
      'currently tracked returns deleted=false. Project is resolved ' +
      'from the X-Project-ID header.',
    parameters: detachFromGoalParameters,
    outputSchema: detachFromGoalOutput,
  })
  async detachFromGoal(
    params: z.infer<typeof detachFromGoalParameters>,
    _context: Context,
    request: Request,
  ): Promise<DetachOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;

    const rootProofError = validateAuthoringRootProof({
      toolName: DETACH_TOOL_NAME,
      token: params.authoringRootProof,
      required: true,
    });
    if (rootProofError) return mcpError(rootProofError);

    const token = requireToken(auth);
    if (!isToken(token)) return token;

    this.logger.log('detach_from_goal called', {
      organizationId: auth.organizationId,
      projectId,
      goalId: params.goalId,
      targetEntityId: params.targetEntityId,
      targetEntityType: params.targetEntityType,
    });

    try {
      const result: DetachFromGoalResponseDto =
        await this.goalTracksService.detachFromGoal(
          auth.organizationId,
          projectId as ProjectId,
          params.goalId as TaskId,
          {
            targetEntityId: params.targetEntityId,
            targetEntityType: params.targetEntityType as EntityType,
          },
          token,
        );
      return result as DetachOutput;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`detach_from_goal failed: ${message}`);
      return mcpError(`detach_from_goal failed: ${message}`);
    }
  }
}
