import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@temporalio/client';
import {
  ConversationId,
  ProjectId,
  OrganizationId,
  UserId,
  WorkflowId,
  WorkflowAboutType,
} from '../../types';
import { InjectTemporalClient } from '../../prisma/temporal.module';
import {
  UnsupportedWorkflowTypeError,
  WorkflowStartError,
} from '../../core/exceptions/workflow.exceptions';
import { StartConversationFlowWorkflowInput } from '../../workflows/conversation-flow.workflow';
import { errorToLoggable } from 'src/utils/logging.util';
import { v4 as uuidv4 } from 'uuid';
import { CreateConversationDto, WorkflowName } from 'src/generated';

export interface WorkflowConfig {
  // Local string-literal subset rather than the canonical WorkflowAboutType
  // because pre-existing entries in this registry use values ('document',
  // 'user') that the canonical union does not include. Tightening to the
  // canonical type is a separate cleanup; for now keep both unions in
  // existence and add new members here as registry entries demand.
  workflowAboutType:
    | 'task'
    | 'initiative'
    | 'project'
    | 'document'
    | 'agent-session'
    | 'user'
    | 'plan'
    | 'proposal';
  flowId: string;
  displayName: string;
  description: string;
  isSupported: boolean;
  /** Timeout for each user-wait condition inside the workflow (ms) */
  userResponseTimeoutMs?: number;
  /** Temporal workflow execution timeout (ms) */
  workflowExecutionTimeoutMs?: number;
}

export interface WorkflowStartResult {
  workflowId: string;
  conversationId?: ConversationId;
  success: boolean;
}

type WorkflowAdditionalContext<TWorkflowName extends WorkflowName> = Extract<
  CreateConversationDto,
  { workflowName: TWorkflowName }
>['context'];

const VALID_WORKFLOWS = new Set([...Object.values(WorkflowName)]);

@Injectable()
export class WorkflowTypeRegistryService {
  private readonly logger = new Logger(WorkflowTypeRegistryService.name);
  private readonly workflowConfigs: Map<WorkflowName, WorkflowConfig> =
    new Map();

  constructor(@InjectTemporalClient() private readonly temporalClient: Client) {
    this.initializeWorkflowConfigs();
  }

  private initializeWorkflowConfigs(): void {
    this.workflowConfigs.set(WorkflowName.Onboarding, {
      workflowAboutType: 'project',
      flowId: WorkflowName.Onboarding,
      displayName: 'Project Onboarding',
      description: 'Interactive project onboarding with initiative generation',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.RepositoryImport, {
      workflowAboutType: 'project',
      flowId: WorkflowName.RepositoryImport,
      displayName: 'Repository Import',
      description: 'Analyze an existing Service repository and import Features',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.WorkTrackerImport, {
      workflowAboutType: 'project',
      flowId: WorkflowName.WorkTrackerImport,
      displayName: 'Work Tracker Import',
      description: 'Import existing Jira or Linear work as Features',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.InitiativeRefinement, {
      workflowAboutType: 'initiative',
      flowId: WorkflowName.InitiativeRefinement,
      displayName: 'Initiative Refinement',
      description: 'Collaborative initiative refinement and editing',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.TaskGeneration, {
      workflowAboutType: 'initiative',
      flowId: WorkflowName.TaskGeneration,
      displayName: 'Task Generation',
      description: 'Interactive task generation and management',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.TaskPrioritization, {
      workflowAboutType: 'project',
      flowId: WorkflowName.TaskPrioritization,
      displayName: 'Task Prioritization',
      description:
        'Single-pass workflow that ranks the next 10 tasks across initiatives',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.TaskRefinement, {
      workflowAboutType: 'task',
      flowId: WorkflowName.TaskRefinement,
      displayName: 'Task Refinement',
      description: 'Interactive task refinement',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.Adr, {
      workflowAboutType: 'document',
      flowId: WorkflowName.Adr,
      displayName: 'Design Document Refinement',
      description: 'Collaborative refinement workflow for design documents',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.BrainstormRefinement, {
      workflowAboutType: 'document',
      flowId: WorkflowName.BrainstormRefinement,
      displayName: 'Brainstorm Refinement',
      description: 'Collaborative refinement workflow for brainstorm documents',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.DecisionRefinement, {
      workflowAboutType: 'document',
      flowId: WorkflowName.DecisionRefinement,
      displayName: 'Decision Refinement',
      description: 'Collaborative refinement workflow for decision documents',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.AgentSession, {
      workflowAboutType: 'agent-session',
      flowId: WorkflowName.AgentSession,
      displayName: 'Agent Session Conversation',
      description: 'Non-Temporal conversation stream for agent sessions',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.EntityConversation, {
      workflowAboutType: 'project',
      flowId: WorkflowName.EntityConversation,
      displayName: 'Entity Conversation',
      description: 'Agentic conversation about a specific entity',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.ProjectConversation, {
      workflowAboutType: 'project',
      flowId: WorkflowName.ProjectConversation,
      displayName: 'Project Conversation',
      description: 'Agentic conversation about an entire project',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.DailySession, {
      workflowAboutType: 'user',
      flowId: WorkflowName.DailySession,
      displayName: 'Daily Session',
      description:
        'Non-Temporal conversation stream for CLI-driven daily sessions',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.AgentTaskRefining, {
      workflowAboutType: 'task',
      flowId: WorkflowName.AgentTaskRefining,
      displayName: 'Agent Task Refining',
      description: 'Non-Temporal agent session for task refinement',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.AgentEntityConversation, {
      workflowAboutType: 'project',
      flowId: WorkflowName.AgentEntityConversation,
      displayName: 'Agent Entity Conversation',
      description: 'Non-Temporal agent session for entity-scoped conversation',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.GoalPm, {
      workflowAboutType: 'task',
      flowId: WorkflowName.GoalPm,
      displayName: 'Goal PM',
      description: 'Non-Temporal standing routing conversation for a goal',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.OpenItemsTriage, {
      workflowAboutType: 'agent-session',
      flowId: WorkflowName.OpenItemsTriage,
      displayName: 'Open Items Triage',
      description:
        'Non-Temporal standing Open Items triage conversation for one user in a project',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.FeatureTreeConversation, {
      workflowAboutType: 'project',
      flowId: WorkflowName.FeatureTreeConversation,
      displayName: 'Feature Tree Conversation',
      description:
        'Project-scoped conversational agent for exploring and restructuring the feature hierarchy — structural rebalancing, project insights, and competitive analysis. Launched from the Features page "Discuss" action.',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.AgentProjectConversation, {
      workflowAboutType: 'project',
      flowId: WorkflowName.AgentProjectConversation,
      displayName: 'Agent Project Conversation',
      description: 'Non-Temporal agent session for project-scoped conversation',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.AgentDesignDocRefining, {
      workflowAboutType: 'document',
      flowId: WorkflowName.AgentDesignDocRefining,
      displayName: 'Agent Design Doc Refining',
      description: 'Non-Temporal agent session for design doc refinement',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.AgentSearch, {
      workflowAboutType: 'agent-session',
      flowId: WorkflowName.AgentSearch,
      displayName: 'Agent Search',
      description:
        'Non-Temporal agent session for AdvancedSearch agent-search chat',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.SessionMonitor, {
      workflowAboutType: 'agent-session',
      flowId: WorkflowName.SessionMonitor,
      displayName: 'Session Monitor',
      description:
        'Non-Temporal CLI agent session that evaluates a session report and authors a single SESSION_MONITOR continuation-decision message (CONTINUED or DEFERRED) on behalf of the user',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.TaskMonitor, {
      workflowAboutType: 'agent-session',
      flowId: WorkflowName.TaskMonitor,
      displayName: 'Task Monitor',
      description:
        'Non-Temporal CLI agent session that coordinates one TASK_MONITOR work item through the shared monitor runtime',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.AgentProposalRefining, {
      workflowAboutType: 'proposal',
      flowId: WorkflowName.AgentProposalRefining,
      displayName: 'Agent Proposal Refining',
      description:
        'Non-Temporal agent session for iterative proposal refinement',
      isSupported: false,
    });

    this.workflowConfigs.set(WorkflowName.FeatureSync, {
      workflowAboutType: 'agent-session',
      flowId: WorkflowName.FeatureSync,
      displayName: 'Feature Sync',
      description:
        'Initial feature-sync stage run at the start of a coding session',
      isSupported: true,
    });

    this.workflowConfigs.set(WorkflowName.PlanFromDesignDoc, {
      workflowAboutType: 'task',
      flowId: WorkflowName.PlanFromDesignDoc,
      displayName: 'Plan from Design Doc',
      description:
        'CLI-driven plan generation seeded by an existing design-doc markdown blob. The design-doc and plan are materialized when create_plan is approved; the workflow drives plan shaping through to task review against the already-existing plan.',
      isSupported: true,
    });
  }

  getWorkflowConfig(workflowName: WorkflowName): WorkflowConfig | null {
    return this.workflowConfigs.get(workflowName) || null;
  }

  getSupportedWorkflowConfigs(): WorkflowConfig[] {
    return Array.from(this.workflowConfigs.values()).filter(
      (config) => config.isSupported,
    );
  }

  getAllSupportedWorkflowTypes(): WorkflowName[] {
    return Array.from(this.workflowConfigs.keys()).filter((workflowName) => {
      const config = this.workflowConfigs.get(workflowName);
      return config?.isSupported === true;
    });
  }

  isWorkflowTypeSupported(workflowName: string): boolean {
    const config = this.workflowConfigs.get(workflowName as WorkflowName);
    return config?.isSupported === true;
  }

  isNonTemporalBackedWorkflow(workflowName?: string | null): boolean {
    return (
      workflowName === WorkflowName.AgentSession ||
      workflowName === WorkflowName.DailySession ||
      workflowName === WorkflowName.AgentTaskRefining ||
      workflowName === WorkflowName.AgentEntityConversation ||
      workflowName === WorkflowName.GoalPm ||
      workflowName === WorkflowName.OpenItemsTriage ||
      workflowName === WorkflowName.AgentProjectConversation ||
      workflowName === WorkflowName.AgentDesignDocRefining ||
      workflowName === WorkflowName.AgentSearch ||
      workflowName === WorkflowName.AgentProposalRefining ||
      workflowName === WorkflowName.FeatureTreeConversation ||
      workflowName === WorkflowName.SessionMonitor ||
      workflowName === WorkflowName.TaskMonitor
    );
  }

  /**
   * Deferred-start opt-out the conversation engine consults at create time.
   * When this returns true, ConversationWorkflowService.createConversation
   * inserts the conversation row with status NOT_STARTED and skips the
   * opener + Temporal start sequence. A caller (e.g. the create_plan proposal
   * enactor or the CLI) then invokes startConversationWorkflow explicitly
   * once any prerequisite materialization has committed.
   */
  shouldDeferAutostart(workflowName?: string | null): boolean {
    const deferred = workflowName === WorkflowName.PlanFromDesignDoc;
    this.logger.debug(
      `[shouldDeferAutostart] workflowName=${workflowName ?? '(none)'} deferred=${deferred}`,
    );
    return deferred;
  }

  validateWorkflowName(workflowName: string): WorkflowName {
    if (!VALID_WORKFLOWS.has(workflowName as WorkflowName)) {
      throw new UnsupportedWorkflowTypeError(
        `Unsupported workflow type: ${workflowName}. Supported types are: ${[...VALID_WORKFLOWS].join(', ')}`,
      );
    }
    return workflowName as WorkflowName;
  }

  async startWorkflowByType<TWorkflowName extends WorkflowName>(
    workflowName: TWorkflowName,
    conversationId: ConversationId | null,
    projectId: ProjectId,
    organizationId: OrganizationId,
    userId: UserId | null | undefined,
    title: string | null | undefined,
    workflowAboutType: WorkflowAboutType,
    workflowAboutId: string,
    workflowIdOverride?: WorkflowId,
    additionalContext?: WorkflowAdditionalContext<TWorkflowName>,
  ): Promise<WorkflowStartResult> {
    const config = this.getWorkflowConfig(workflowName);
    if (!config) {
      throw new UnsupportedWorkflowTypeError(
        `Workflow configuration not found for type: ${workflowName}`,
        workflowName,
      );
    }

    if (!config.isSupported) {
      throw new UnsupportedWorkflowTypeError(
        `Workflow type ${workflowName} is currently not supported`,
        workflowName,
      );
    }

    try {
      const workflowId = await this.startSpecificWorkflow(
        workflowName,
        conversationId,
        projectId,
        organizationId,
        userId ?? undefined,
        title ?? undefined,
        workflowAboutType,
        workflowAboutId,
        workflowIdOverride,
        additionalContext,
      );

      return {
        workflowId,
        conversationId: conversationId ?? undefined,
        success: true,
      };
    } catch (error) {
      throw new WorkflowStartError(
        `Failed to start workflow ${workflowName}: ${error instanceof Error ? error.message : String(errorToLoggable(error))}`,
        undefined,
      );
    }
  }

  private async startSpecificWorkflow<TWorkflowName extends WorkflowName>(
    workflowName: TWorkflowName,
    conversationId: ConversationId | null,
    projectId: ProjectId,
    organizationId: OrganizationId,
    userId: UserId | undefined,
    title: string | undefined,
    workflowAboutType: WorkflowAboutType,
    workflowAboutId: string,
    workflowIdOverride?: WorkflowId,
    additionalContext?: WorkflowAdditionalContext<TWorkflowName>,
  ): Promise<string> {
    const workflowId = (workflowIdOverride ?? uuidv4()) as WorkflowId;
    const config = this.getWorkflowConfig(workflowName);

    if (!config) {
      throw new UnsupportedWorkflowTypeError(
        `Workflow configuration not found for type: ${workflowName}`,
        workflowName,
      );
    }

    // Build proper StartConversationFlowWorkflowInput based on workflow type
    const startConversationFlowInput: StartConversationFlowWorkflowInput = {
      projectId,
      workflowId,
      organizationId,
      flowId: config.flowId,
      userId: userId || ('system' as UserId),
      initiatedBy: userId ? 'USER' : 'SYSTEM',
      triggerEvent: '',
      title: title || config.displayName,
      workflowName,
      workflowAboutType,
      workflowAboutId,
      userResponseTimeout: config.userResponseTimeoutMs,
    };

    if (conversationId) {
      startConversationFlowInput.conversationId = conversationId;
    }
    if (additionalContext) {
      startConversationFlowInput.additionalContext = Object.fromEntries(
        Object.entries(additionalContext),
      );
    }

    const startOptions: Parameters<
      typeof this.temporalClient.workflow.start
    >[1] = {
      args: [startConversationFlowInput],
      taskQueue: 'conversation-queue',
      workflowId,
    };
    if (config.workflowExecutionTimeoutMs) {
      startOptions.workflowExecutionTimeout = config.workflowExecutionTimeoutMs;
    }

    await this.temporalClient.workflow.start(
      'conversationFlowWorkflow',
      startOptions,
    );

    return workflowId;
  }
}
