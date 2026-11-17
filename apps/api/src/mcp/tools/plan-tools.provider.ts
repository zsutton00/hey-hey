import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Injectable, Logger } from '@nestjs/common';
import { Context, Tool } from '@rekog/mcp-nest';
import type { Request } from 'express';
import { z } from 'zod';
import { WorkStatus, WorkflowName } from '@hey-hey/contracts/api/models';
import { PrismaService } from 'src/prisma/prisma.service';
import type {
  WorkItemChangeSetOperation,
  WorkItemChangeSetValidationRequest,
  WorkItemChangeSetIdentity,
  PlanConfigurationV1,
} from '@hey-hey/contracts/api/models';
import { PLAN_CONFIGURATION_SCHEMA_VERSION } from '../../services/tasks/plan-configuration.validator';
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

  constructor(
    private readonly proposalService: ProposalService,
    private readonly prisma: PrismaService,
  ) {}

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
      this.logger.warn(
        'create_plan_from_existing_tasks rejected: missing project context',
      );
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

    const reject = (code: string, reason: string) => {
      this.logger.warn('create_plan_from_existing_tasks rejected', {
        code,
        reason,
      });
      return mcpError(`${code}: ${reason}`);
    };
    const taskIds = params.stages.flatMap((stage) => stage.taskIds);
    if (
      taskIds.length === 0 ||
      params.stages.some((stage) => stage.taskIds.length === 0)
    ) {
      return reject('EMPTY_TASK_LIST', 'Every stage must list existing tasks.');
    }
    if (new Set(taskIds).size !== taskIds.length) {
      return reject(
        'DUPLICATE_TASK_ASSIGNMENT',
        'A task may appear only once in the Plan.',
      );
    }
    const scope = {
      organizationId: auth.organizationId,
      projectId,
      archivedAt: null,
    };
    const feature = await this.prisma.db.task.findFirst({
      where: { ...scope, id: params.parentFeatureId, type: 'FEATURE' },
      select: { id: true },
    });
    if (!feature) {
      return reject(
        'PARENT_FEATURE_NOT_FOUND',
        'The parent Feature does not exist in this project.',
      );
    }
    const prerequisites = params.taskPrerequisites ?? [];
    const rows = await this.prisma.db.task.findMany({
      where: {
        ...scope,
        id: {
          in: [
            ...new Set([
              ...taskIds,
              ...prerequisites.map((p) => p.dependsOnTaskId),
            ]),
          ],
        },
      },
      select: { id: true, type: true, parentTaskId: true },
    });
    const byId = new Map<string, (typeof rows)[number]>(
      rows.map((row) => [row.id, row]),
    );
    const features = new Set<string>();
    for (const taskId of taskIds) {
      const row = byId.get(taskId);
      if (!row) {
        return reject(
          'TASK_NOT_FOUND',
          `Task ${taskId} does not exist in this project.`,
        );
      }
      if (row.type !== 'STANDARD') {
        return reject(
          'TASK_NOT_STANDARD',
          `Work item ${taskId} is not a Standard Task.`,
        );
      }
      let parentId = row.parentTaskId;
      const seen = new Set<string>();
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = await this.prisma.db.task.findFirst({
          where: { ...scope, id: parentId },
          select: { id: true, type: true, parentTaskId: true },
        });
        if (!parent) {
          break;
        }
        if (parent.type === 'PLAN' || parent.type === 'PLAN_STAGE') {
          return reject(
            'TASK_ALREADY_IN_PLAN',
            `Task ${taskId} is already inside a Plan.`,
          );
        }
        if (parent.type === 'FEATURE') {
          features.add(parent.id);
          break;
        }
        parentId = parent.parentTaskId;
      }
    }
    for (const prerequisite of prerequisites) {
      if (!taskIds.includes(prerequisite.taskId)) {
        return reject(
          'PREREQUISITE_TASK_NOT_ADOPTED',
          'A prerequisite source must be an adopted Task.',
        );
      }
      if (prerequisite.taskId === prerequisite.dependsOnTaskId) {
        return reject('SELF_DEPENDENCY', 'A Task cannot depend on itself.');
      }
      if (!byId.has(prerequisite.dependsOnTaskId)) {
        return reject(
          'PREREQUISITE_NOT_FOUND',
          `Prerequisite ${prerequisite.dependsOnTaskId} does not exist in this project.`,
        );
      }
    }
    const temporary = (tempId: string): WorkItemChangeSetIdentity => ({
      refType: 'temporary',
      tempId,
    });
    const existing = (id: string): WorkItemChangeSetIdentity => ({
      refType: 'existing',
      id,
    });
    const root = { refType: 'temporary', tempId: 'plan' } as const;
    const operations: WorkItemChangeSetOperation[] = [
      {
        op: 'workItem.create',
        ref: root,
        type: 'PLAN',
        name: params.planTitle,
        parent: existing(params.parentFeatureId),
        // The adopted tasks already exist, so the Plan is live work from approval.
        status: WorkStatus.Active,
      },
      {
        op: 'section.replace',
        ref: root,
        key: 'planConfiguration',
        content: {
          schemaVersion: PLAN_CONFIGURATION_SCHEMA_VERSION,
          planType: 'STANDARD',
          worktreeBranch: null,
        } satisfies PlanConfigurationV1,
      },
      {
        op: 'section.replace',
        ref: root,
        key: 'outcome',
        content: params.planTitle,
      },
      {
        op: 'designDoc.create',
        ref: { refType: 'temporary', tempId: 'design-doc' },
        name: params.planTitle,
        markdown: params.designDocMarkdown,
        parent: root,
      },
    ];
    const relationship = (
      source: WorkItemChangeSetIdentity,
      target: WorkItemChangeSetIdentity,
      edgeType: 'DEPENDS_ON' | 'RELATED_TO' | 'DERIVES_FROM',
      targetEntityType: 'TASK' | 'DESIGN_DOC' = 'TASK',
    ) => {
      operations.push({
        op: 'relationship.create',
        ref: { refType: 'temporary', tempId: `edge-${operations.length}` },
        source,
        target,
        edgeType,
        targetEntityType,
      });
    };
    relationship(root, temporary('design-doc'), 'DERIVES_FROM', 'DESIGN_DOC');
    params.stages.forEach((stage, index) => {
      const ref = { refType: 'temporary', tempId: `stage-${index}` } as const;
      operations.push({
        op: 'workItem.create',
        ref,
        type: 'PLAN_STAGE',
        name: stage.title,
        parent: root,
      });
      for (const id of stage.taskIds) {
        operations.push({
          op: 'workItem.update',
          ref: existing(id),
          parent: ref,
        });
      }
      if (index > 0) {
        relationship(ref, temporary(`stage-${index - 1}`), 'DEPENDS_ON');
      }
    });
    for (const prerequisite of prerequisites) {
      relationship(
        existing(prerequisite.taskId),
        existing(prerequisite.dependsOnTaskId),
        'DEPENDS_ON',
      );
    }
    for (const id of features) {
      if (id !== params.parentFeatureId) {
        relationship(root, existing(id), 'RELATED_TO');
      }
    }
    const updates = {
      root,
      operations,
    } satisfies WorkItemChangeSetValidationRequest;

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
      if (invalidChangeSet) {
        this.logger.warn(
          'create_plan_from_existing_tasks rejected by shared admission',
          {
            issues: invalidChangeSet.issues.map((issue) => ({
              code: issue.code,
              field: issue.field,
            })),
          },
        );
        return invalidChangeSet;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`create_plan_from_existing_tasks failed: ${message}`);
      return mcpError(message);
    }
  }
}
