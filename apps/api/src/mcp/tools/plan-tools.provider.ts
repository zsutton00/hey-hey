import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Injectable, Logger } from '@nestjs/common';
import { Context, Tool } from '@rekog/mcp-nest';
import type { Request } from 'express';
import { z } from 'zod';
import { WorkflowName } from '@hey-hey/contracts/api/models';
import { PLAN_FROM_EXISTING_TASKS_KIND } from '../../services/plan/plan-from-existing-tasks.schema';
import { ProposalService } from '../../services/proposal/proposal.service';
import type { StampedCreateProposalDto } from '../../services/proposal/proposal.types';
import type { ProjectId, TaskId } from '../../types';
import { extractAuthContext, isAuthContext, mcpError } from './mcp-tool.utils';
import { ORCHESTRATION_TOOL_NAMES } from './proposal-tool-names';
import { buildProvenanceEnvelope, influenceSchema } from './provenance';
import { extractRequestorContext } from './requestor-context';
import {
  invalidProposalChangeSetFromError,
  invalidProposalChangeSetOutputSchema,
} from './proposal-group-tool.schemas';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const createPlanParameters = z.object({
  ragEnabled: z.boolean().optional(),
  applicationEligible: z.boolean().optional(),
  designDocMarkdown: z
    .string()
    .min(1)
    .describe(
      'Design-doc body drafted by the calling agent. The agent drafts ' +
        'using these PRD-facing sections: Problem Statement & Context / Goals ' +
        'and Non-Goals / Target Users & Use Cases / User Experience (UX) & ' +
        'Design / User Stories & Acceptance Criteria / Success Metrics / ' +
        'Assumptions, Constraints & Dependencies / Technical Requirements ' +
        '(Technical Approach / Implementation Breakdown / Integration ' +
        'Contracts / Detailed Data Flows and Downstream Task Convergence).',
    ),
  planTitle: z.string().min(1).describe('User-visible plan name'),
  eli5: z
    .string()
    .min(1)
    .max(150)
    .describe(
      'Required proposal-owned explanation for a reviewer (150 characters maximum).',
    ),
  parentFeatureId: z
    .string()
    .uuid()
    .describe(
      'The feature this plan anchors under. Pick the most relevant single ' +
        'feature even if the plan touches several — anchor under the ' +
        'primary one and use `create_edge` (RELATED_TO) afterwards to link ' +
        'the additional features the plan also affects.',
    ),
  reason: z.string().optional().describe('Why this plan is being proposed'),
  influences: z
    .array(influenceSchema)
    .max(100)
    .optional()
    .describe(
      'Entities that influenced this proposal. Each entry declares ' +
        'the entity ID, reason type (explicit_mention, implied, derived), ' +
        'and a brief reasoning explanation.',
    ),
  generatedWithVersion: z
    .string()
    .max(255)
    .optional()
    .describe('Model or tool version used to generate this proposal'),
});

export const createPlanFromExistingTasksParameters = z.object({
  ragEnabled: z.boolean().optional(),
  applicationEligible: z.boolean().optional(),
  planTitle: z.string().min(1).describe('User-visible plan name'),
  designDocMarkdown: z
    .string()
    .min(1)
    .describe('Design-doc body attached to the new Plan.'),
  eli5: z
    .string()
    .min(1)
    .max(150)
    .describe(
      'Required proposal-owned explanation for a reviewer (150 characters maximum).',
    ),
  parentFeatureId: z
    .string()
    .uuid()
    .describe('The feature the new Plan is created under.'),
  stages: z
    .array(
      z.object({
        title: z.string().min(1),
        taskIds: z
          .array(z.string().uuid())
          .min(1)
          .describe('Existing Task ids adopted into this stage.'),
      }),
    )
    .min(1)
    .describe(
      'Ordered stages. Each stage depends on the stage before it. Every Task ' +
        'is adopted once, keeps its identity and status, and moves under its stage.',
    ),
  taskPrerequisites: z
    .array(
      z.object({
        taskId: z.string().uuid(),
        dependsOnTaskId: z.string().uuid(),
      }),
    )
    .optional()
    .describe(
      'Explicit Task prerequisites only; stage order never implies one. ' +
        'The prerequisite may be a Task outside the Plan.',
    ),
  reason: z.string().optional().describe('Why this plan is being proposed'),
  influences: z.array(influenceSchema).max(100).optional(),
  generatedWithVersion: z.string().max(255).optional(),
});

export const createPlanOutput = z.object({
  id: z.string().describe('Proposal ID'),
  status: z.string().describe('Proposal status (e.g. DRAFT)'),
  action: z.string().describe('Proposal action (CREATE)'),
  targetEntityType: z
    .string()
    .describe(
      'Target entity type (CONVERSATION, or TASK for existing-task Plans)',
    ),
  targetEntityId: z
    .string()
    .describe(
      'Always the nil UUID until the proposal is approved; the real ' +
        'conversation id is assigned at enactment time and is not returned ' +
        'from this call.',
    ),
  fields: z
    .array(z.string())
    .describe('List of fields included in the proposal'),
  createdAt: z.string().describe('When the proposal was created'),
});

const createPlanResultOutput = z.union([
  invalidProposalChangeSetOutputSchema,
  createPlanOutput,
]);

type CreatePlanOutput = z.infer<typeof createPlanResultOutput>;

@Injectable()
export class PlanToolsProvider {
  private readonly logger = new Logger(PlanToolsProvider.name);

  constructor(private readonly proposalService: ProposalService) {}

  @Tool({
    name: ORCHESTRATION_TOOL_NAMES.CREATE_PLAN,
    description:
      'Propose a CREATE proposal for a plan from a design-doc markdown ' +
      'body. See get_tool_guidance({ toolName: "create_plan" }) for the ' +
      'authoring conventions.',
    parameters: createPlanParameters,
    outputSchema: createPlanResultOutput,
  })
  async createPlan(
    params: z.infer<typeof createPlanParameters>,
    _context: Context,
    request: Request,
  ): Promise<CreatePlanOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const conversationId = request.headers['x-conversation-id'] as
      | string
      | undefined;
    const projectId = request.headers['x-project-id'] as string | undefined;

    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    const requestorContext = extractRequestorContext(
      auth,
      request,
      ORCHESTRATION_TOOL_NAMES.CREATE_PLAN,
      conversationId,
    );

    const provenance = buildProvenanceEnvelope(
      requestorContext,
      params.influences,
      params.generatedWithVersion,
    );

    const updates: Record<string, unknown> = {
      designDocMarkdown: params.designDocMarkdown,
      planTitle: params.planTitle,
      parentFeatureId: params.parentFeatureId,
      workflowName: WorkflowName.PlanFromDesignDoc,
    };

    const dto: StampedCreateProposalDto = {
      ragEnabled: params.ragEnabled,
      applicationEligible: params.applicationEligible,
      type: 'SINGLE',
      action: 'CREATE',
      targetEntityId: NIL_UUID,
      targetEntityType: 'CONVERSATION',
      title: params.planTitle,
      eli5: params.eli5,
      updates,
      requestorContext,
      influences: provenance.influences,
      ...(provenance.generatedWithVersion
        ? { generatedWithVersion: provenance.generatedWithVersion }
        : {}),
      ...(conversationId ? { conversationId } : {}),
    };

    try {
      const proposal = await this.proposalService.create(
        auth.organizationId,
        projectId as ProjectId,
        auth.user.userId,
        dto,
      );

      this.logger.log(
        `create_plan proposal created: ${proposal.id} for project ${projectId}`,
      );

      return {
        id: proposal.id,
        status: proposal.status,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        fields: Object.keys(updates),
        createdAt: proposal.createdAt,
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`create_plan failed: ${message}`);
      return mcpError(message);
    }
  }

  @Tool({
    name: ORCHESTRATION_TOOL_NAMES.CREATE_PLAN_FROM_EXISTING_TASKS,
    description:
      'Propose a Plan built from existing Tasks: one reviewable proposal that, ' +
      'once approved, creates the Plan, its design doc and stages and moves the ' +
      'listed Tasks under them. Nothing is created or moved by this call. ' +
      'See get_tool_guidance({ toolName: "create_plan_from_existing_tasks" }) for guidance.',
    parameters: createPlanFromExistingTasksParameters,
    outputSchema: createPlanResultOutput,
  })
  async createPlanFromExistingTasks(
    params: z.infer<typeof createPlanFromExistingTasksParameters>,
    _context: Context,
    request: Request,
  ): Promise<CreatePlanOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const conversationId = request.headers['x-conversation-id'] as
      | string
      | undefined;
    const projectId = request.headers['x-project-id'] as string | undefined;
    if (!projectId) {
      return mcpError(
        'Missing project context. Ensure X-Project-ID header is set.',
      );
    }

    const requestorContext = extractRequestorContext(
      auth,
      request,
      ORCHESTRATION_TOOL_NAMES.CREATE_PLAN_FROM_EXISTING_TASKS,
      conversationId,
    );
    const provenance = buildProvenanceEnvelope(
      requestorContext,
      params.influences,
      params.generatedWithVersion,
    );

    const updates: Record<string, unknown> = {
      proposalKind: PLAN_FROM_EXISTING_TASKS_KIND,
      planTitle: params.planTitle,
      designDocMarkdown: params.designDocMarkdown,
      parentFeatureId: params.parentFeatureId,
      stages: params.stages,
      ...(params.taskPrerequisites
        ? { taskPrerequisites: params.taskPrerequisites }
        : {}),
    };

    const dto: StampedCreateProposalDto = {
      ragEnabled: params.ragEnabled,
      applicationEligible: params.applicationEligible,
      type: 'SINGLE',
      action: 'CREATE',
      targetEntityId: NIL_UUID,
      targetEntityType: 'TASK',
      title: params.planTitle,
      eli5: params.eli5,
      updates,
      requestorContext,
      influences: provenance.influences,
      ...(provenance.generatedWithVersion
        ? { generatedWithVersion: provenance.generatedWithVersion }
        : {}),
      ...(conversationId ? { conversationId } : {}),
    };

    try {
      const proposal = await this.proposalService.create(
        auth.organizationId,
        projectId as ProjectId,
        auth.user.userId,
        dto,
      );
      this.logger.log(
        `create_plan_from_existing_tasks proposal created: ${proposal.id} for project ${projectId}`,
      );
      return {
        id: proposal.id,
        status: proposal.status,
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        fields: Object.keys(updates),
        createdAt: proposal.createdAt,
      };
    } catch (error: unknown) {
      const invalidChangeSet = invalidProposalChangeSetFromError(error);
      if (invalidChangeSet) return invalidChangeSet;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`create_plan_from_existing_tasks failed: ${message}`);
      return mcpError(message);
    }
  }
}
