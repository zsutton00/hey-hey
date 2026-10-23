import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AgentSessionStatus as PrismaAgentSessionStatus,
  AgentSessionType as PrismaAgentSessionType,
  EntityType,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { AnyTransactionClient } from '../../prisma/prisma.service';
import {
  ConversationStatus,
  CreateConversationDto,
  CreateTaskDto,
  WorkStatus,
} from '../../generated';
import { AgentSessionService } from '../agent-session.service';
import { ConversationService } from '../conversation.service';
import {
  ConversationId,
  DesignDocId,
  OrganizationId,
  PlanId,
  ProjectId,
  TaskId,
  UserId,
  WorkflowId,
} from '../../types';
import { TaskService } from '../tasks/task.service';

export interface MaterializePlanFromDesignDocRunParams {
  /** An already-materialized design doc to LINK to the new plan. */
  designDocId: DesignDocId;
  /** The doc's rendered markdown, carried on the conversation context. */
  designDocMarkdown: string;
  planTitle: string;
  /** FEATURE task that anchors the canonical PLAN work item. */
  parentFeatureId: TaskId;
  /** The user the run is created on behalf of (plan owner / session user). */
  requestorId: UserId;
  projectId: ProjectId;
  organizationId: OrganizationId;
  /** Stable target identity reserved by grouped proposal authoring. */
  conversationId?: ConversationId;
}

export interface MaterializedPlanFromDesignDocRun {
  planId: PlanId;
  agentSessionId: string;
  conversationId: ConversationId;
}

export interface MaterializeExistingPlanFromDesignDocSetupParams {
  planId: PlanId;
  designDocMarkdown: string;
  planTitle: string;
  parentFeatureId?: TaskId;
  requestorId: UserId;
  projectId: ProjectId;
  organizationId: OrganizationId;
}

/**
 * Single source of truth for how a PlanFromDesignDoc run is born.
 *
 * Both the original launch path
 * ({@link ProposalApprovalService.enactCreateConversation}, which materializes
 * a fresh design doc from `create_plan` markdown) and the restart relaunch path
 * ({@link PlanGenerationRestartService}, which reuses the preserved design doc)
 * resolve a `designDocId` their own way, then delegate the identical creation
 * sequence here.
 *
 * Lives in the `@Global` {@link PlanModule} so both callers — one in the
 * proposal domain, one in the plan domain — can inject it without an import
 * cycle.
 */
@Injectable()
export class PlanFromDesignDocLauncherService {
  private readonly logger = new Logger(PlanFromDesignDocLauncherService.name);

  constructor(
    private readonly taskService: TaskService,
    @Inject(forwardRef(() => AgentSessionService))
    private readonly agentSessionService: AgentSessionService,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * Materialize a fresh PlanFromDesignDoc run inside the caller's transaction:
   * plan (DRAFT) → LINK the design doc → PLAN_GENERATION agent session
   * (NOT_STARTED) → plan-from-design-doc conversation (NOT_STARTED) → bind the
   * conversation to the session. Returns the created ids.
   *
   * The design doc must already exist; this method only LINKs it (the caller
   * decides whether to create it fresh from markdown or reuse a preserved one).
   * The conversation is born at NOT_STARTED so the run lands on the From Design
   * Doc opening review gate rather than mid-generation.
   */
  async materializeRunInTransaction(
    tx: AnyTransactionClient,
    params: MaterializePlanFromDesignDocRunParams,
  ): Promise<MaterializedPlanFromDesignDocRun> {
    const {
      designDocId,
      designDocMarkdown,
      planTitle,
      parentFeatureId,
      requestorId,
      projectId,
      organizationId,
      conversationId: reservedConversationId,
    } = params;

    const createPlan = {
      name: planTitle,
      type: 'PLAN',
      parentTaskId: parentFeatureId,
      assigneeId: requestorId,
      status: WorkStatus.Backlog,
      sections: [
        { key: 'outcome', content: planTitle },
        { key: 'description', content: designDocMarkdown },
        {
          key: 'planConfiguration',
          content: {
            schemaVersion: 'plan-configuration.v1',
            planType: 'STANDARD',
            worktreeBranch: null,
          },
        },
      ],
    } satisfies CreateTaskDto;
    const plan = await this.taskService.createInTransaction(
      tx,
      organizationId,
      null,
      createPlan,
      projectId,
    );
    const planId = plan.id as string as PlanId;

    const setup = await this.materializeSetupForPlanInTransaction(tx, {
      planId,
      designDocMarkdown,
      planTitle,
      parentFeatureId,
      requestorId,
      projectId,
      organizationId,
      ...(reservedConversationId
        ? { conversationId: reservedConversationId }
        : {}),
    });

    return { planId, ...setup };
  }

  /**
   * Arms a replacement setup for an existing canonical plan. Unlike
   * materializeRunInTransaction this deliberately does not create or relink
   * the Plan: reset owns those records and only needs a fresh parked
   * session/conversation pair.
   */
  async materializeForExistingWorkItemInTransaction(
    tx: AnyTransactionClient,
    params: MaterializeExistingPlanFromDesignDocSetupParams,
  ): Promise<Omit<MaterializedPlanFromDesignDocRun, 'planId'>> {
    return this.materializeSetupForPlanInTransaction(tx, {
      ...params,
    });
  }

  private async materializeSetupForPlanInTransaction(
    tx: AnyTransactionClient,
    params: MaterializeExistingPlanFromDesignDocSetupParams & {
      conversationId?: ConversationId;
    },
  ): Promise<Omit<MaterializedPlanFromDesignDocRun, 'planId'>> {
    const {
      planId,
      designDocMarkdown,
      planTitle,
      parentFeatureId,
      requestorId,
      projectId,
      organizationId,
      conversationId: reservedConversationId,
    } = params;

    // Create the PLAN_GENERATION agent session before the conversation so the
    // conversationId column can be patched in the same tx once the conversation
    // row exists (the 1:1 link the UI mounts on).
    const agentSession = await this.agentSessionService.createInTransaction(
      tx,
      {
        organization: { connect: { id: organizationId } },
        project: { connect: { id: projectId } },
        user: { connect: { id: requestorId } },
        entityType: 'TASK',
        entityId: planId,
        type: PrismaAgentSessionType.PLAN_GENERATION,
        status: PrismaAgentSessionStatus.NOT_STARTED,
        sessionDate: new Date(),
        title: planTitle,
      },
      organizationId,
    );
    const agentSessionId = agentSession.id;

    {
      await tx.agentSessionWorkItemAssociation.create({
        data: {
          organizationId,
          projectId,
          coordinatorType: PrismaAgentSessionType.PLAN_GENERATION,
          workItemType: 'PLAN',
          workItemId: planId,
          agentSessionId,
        },
      });
    }

    // CreateConversationDto is a discriminated union keyed on the workflowName
    // literal; the object below narrows to the plan-from-design-doc variant.
    // The `context` carries the original create_plan inputs — plan-shaping nodes
    // resolve planId/designDocId/parentFeatureId from the persisted entity graph
    // at execution time (PlanFromDesignDocSeedService), not from this context.
    const workflowId = uuidv4() as WorkflowId;
    const conversationDto: CreateConversationDto = {
      projectId,
      organizationId,
      workflowId,
      initiatedBy: 'SYSTEM',
      workflowName: 'plan-from-design-doc',
      workflowAboutType: 'task',
      workflowAboutId: planId,
      title: planTitle,
      status: ConversationStatus.NotStarted,
      context: {
        designDocMarkdown,
        planTitle,
        ...(parentFeatureId ? { parentFeatureId } : {}),
      },
    };

    const conversation =
      await this.conversationService.createConversationInTransaction(
        tx,
        conversationDto,
        organizationId,
        reservedConversationId,
        requestorId,
      );
    const conversationId = conversation.id as ConversationId;

    // Attach the conversation to the agent session. The conditional update guard
    // (conversationId IS NULL) surfaces any concurrent attach attempt.
    const linkResult = await tx.agentSession.updateMany({
      where: { id: agentSessionId, conversationId: null },
      data: { conversationId },
    });
    if (linkResult.count !== 1) {
      throw new ConflictException(
        'PLAN_GENERATION agent session already has a conversation',
      );
    }

    this.logger.log('[launcher] Materialized plan-from-design-doc run', {
      organizationId,
      projectId,
      planId,
      agentSessionId,
      conversationId,
    });

    return { agentSessionId, conversationId };
  }
}
