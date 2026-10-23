import { reportChangedFilesTool } from '../submission-tools/report-changed-files-tool';
import {
  completionResponseHooks,
  changedFileReportingDuty,
} from '../completion-reconciliation/message-mapper';
import {
  EntityType,
  type LocalEntityConversationPromptPayload,
  type LocalEntityConversationEntity,
} from '../../shared/agent-bridge-contract/generated/api';
import type { AgenticSession } from '../../session/types';
import { HINT_WRITE_MCP_TOOLS, resolveMcpToolNames } from '../mcp-server-config';
import type { ServerLogger } from '../../server/logger';
import {
  defaultAddUserMessage,
  type PromptTypeHandlerDeps,
  type PromptTypeHandlerContext,
  type ResolveAdditionalAllowedToolsArgs,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import {
  buildEntityConversationPrompt,
  buildEntityConversationPromptSegments,
} from '../prompts/entity-conversation';
import { SearchSessionTool } from '../submission-tools/search-session-tool';
import { WorkflowAboutReader } from '../submission-tools/search-messages-proxy';
import { SubmitSessionNameTool } from '../submission-tools/submit-session-name-tool';
import type { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';
import type { PassThroughSubmissionToolDeclaration } from '../submission-tools/types';

export const GOAL_ENTITY_CONVERSATION_ALLOWED_TOOLS: readonly string[] = [
  'attach_to_goal',
  'detach_from_goal',
];

export const ENTITY_CONVERSATION_HELP_TOOLS: readonly string[] = ['search_help', 'get_help_node'];

export const ENTITY_CONVERSATION_ALLOWED_TOOLS: readonly string[] = [
  'propose_future_revision',
  'create_design_doc',
  'edit_design_doc',
  ...ENTITY_CONVERSATION_HELP_TOOLS,
];

const ENTITY_CONVERSATION_TASK_SCOPE_KEY = 'entityConversation.taskScope';

interface EntityConversationScope {
  entityId: string;
  entityType: LocalEntityConversationEntity['entityType'];
}

interface EntityConversationTaskScope {
  entityId: string;
  taskType: string;
}

const readDurableTaskScope = (session: AgenticSession): EntityConversationTaskScope | null => {
  const value = session.sessionContext?.[ENTITY_CONVERSATION_TASK_SCOPE_KEY];
  if (!value || typeof value !== 'object') return null;

  const taskScope = value as { entityId?: unknown; taskType?: unknown };
  return typeof taskScope.entityId === 'string' && typeof taskScope.taskType === 'string'
    ? { entityId: taskScope.entityId, taskType: taskScope.taskType }
    : null;
};

const WORKFLOW_ABOUT_TYPE_TO_ENTITY_TYPE: Readonly<
  Record<string, LocalEntityConversationEntity['entityType']>
> = {
  agent_session: EntityType.AgentSession,
  agentsession: EntityType.AgentSession,
  'agent-session': EntityType.AgentSession,
  artifact: EntityType.Artifact,
  bug: EntityType.Task,
  contract: EntityType.Task,
  conversation: EntityType.Conversation,
  design_doc: EntityType.DesignDoc,
  designdoc: EntityType.DesignDoc,
  'design-doc': EntityType.DesignDoc,
  feature: EntityType.Task,
  goal: EntityType.Task,
  implementation_hint: EntityType.ImplementationHint,
  implementationhint: EntityType.ImplementationHint,
  'implementation-hint': EntityType.ImplementationHint,
  initiative: EntityType.Initiative,
  message: EntityType.Message,
  project: EntityType.Project,
  proposal: EntityType.Proposal,
  report: EntityType.Report,
  service: EntityType.Service,
  task: EntityType.Task,
  task_monitor: EntityType.Task,
  taskmonitor: EntityType.Task,
  'task-monitor': EntityType.Task,
  validation_session: EntityType.ValidationSession,
  validationsession: EntityType.ValidationSession,
  'validation-session': EntityType.ValidationSession,
  diagram: EntityType.Task,
  diagram_element: EntityType.Task,
  diagramelement: EntityType.Task,
  'diagram-element': EntityType.Task,
  workflow: EntityType.Task,
  workflow_step: EntityType.Task,
  workflowstep: EntityType.Task,
  'workflow-step': EntityType.Task,
};

const normalizeEntityType = (
  entityType: string,
): LocalEntityConversationEntity['entityType'] | null => {
  const normalized = entityType.trim().toLowerCase().replace(/\s+/g, '_');
  return WORKFLOW_ABOUT_TYPE_TO_ENTITY_TYPE[normalized] ?? null;
};

const sameEntityScope = (left: EntityConversationScope, right: EntityConversationScope): boolean =>
  left.entityId === right.entityId && left.entityType === right.entityType;

const requireRunEntityScope = (
  run: AgenticSession,
  promptDeps: PromptTypeHandlerDeps,
): EntityConversationScope => {
  const entity = run.entity;
  if (!entity) {
    promptDeps.logger.error('entity_conversation.prepare.missing_run_entity', {
      runId: run.agentic_session_id,
    });
    throw new Error('entity_conversation handler requires a persisted Run entity.');
  }

  return { ...entity };
};

const assertConversationSubjectMatchesRun = async (
  run: AgenticSession,
  workflowAboutReader: WorkflowAboutReader,
  promptDeps: PromptTypeHandlerDeps,
  runScope: EntityConversationScope,
): Promise<void> => {
  const projectId = run.contextMetadata?.projectId;
  const conversationId = run.conversationId;
  if (!projectId || !conversationId) {
    promptDeps.logger.error('entity_conversation.prepare.missing_run_scope', {
      runId: run.agentic_session_id,
      hasProjectId: Boolean(projectId),
      hasConversationId: Boolean(conversationId),
    });
    throw new Error(
      'entity_conversation handler requires projectId and conversationId to verify the conversation subject.',
    );
  }

  promptDeps.logger.debug('entity_conversation.prepare.reading_durable_scope', {
    runId: run.agentic_session_id,
    projectId,
    conversationId,
  });
  const { workflowAboutId, workflowAboutType } = await workflowAboutReader.read({
    projectId,
    conversationId,
  });
  if (!workflowAboutId || !workflowAboutType) {
    promptDeps.logger.error('entity_conversation.prepare.missing_durable_scope', {
      runId: run.agentic_session_id,
      hasWorkflowAboutId: Boolean(workflowAboutId),
      hasWorkflowAboutType: Boolean(workflowAboutType),
    });
    throw new Error(
      'entity_conversation handler requires the active conversation to have workflowAboutId and workflowAboutType before building a prompt.',
    );
  }

  const entityType = normalizeEntityType(workflowAboutType);
  if (!entityType) {
    promptDeps.logger.error('entity_conversation.prepare.unsupported_durable_scope_type', {
      runId: run.agentic_session_id,
      workflowAboutType,
    });
    throw new Error(
      `entity_conversation handler does not support workflowAboutType "${workflowAboutType}".`,
    );
  }

  const conversationScope = {
    entityId: workflowAboutId,
    entityType,
  };
  if (!sameEntityScope(conversationScope, runScope)) {
    promptDeps.logger.error('entity_conversation.prepare.conversation_subject_conflict', {
      runId: run.agentic_session_id,
      runScope,
      conversationScope,
    });
    throw new Error(
      'entity_conversation conversation subject conflicts with the persisted Run entity.',
    );
  }
};

const buildPayloadFromRunEntity = (
  run: AgenticSession,
  payload: LocalEntityConversationPromptPayload,
  runScope: EntityConversationScope,
  promptDeps: PromptTypeHandlerDeps,
): LocalEntityConversationPromptPayload => {
  const payloadEntity = payload.entity;
  if (payloadEntity) {
    const payloadEntityType = normalizeEntityType(payloadEntity.entityType);
    const payloadScope = payloadEntityType
      ? { entityId: payloadEntity.entityId, entityType: payloadEntityType }
      : null;
    if (!payloadScope || !sameEntityScope(payloadScope, runScope)) {
      promptDeps.logger.error('entity_conversation.prepare.payload_scope_conflict', {
        runId: run.agentic_session_id,
        runScope,
        payloadScope: payloadScope ?? {
          entityId: payloadEntity.entityId,
          entityType: payloadEntity.entityType,
        },
      });
      throw new Error('entity_conversation payload scope conflicts with the persisted Run entity.');
    }
  }

  return {
    ...payload,
    entity: {
      ...payloadEntity,
      ...runScope,
    },
  };
};

export interface EntityConversationHandlerDependencies {
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  logger: ServerLogger;
}

export class EntityConversationHandler implements UserLaunchablePromptTypeHandler<LocalEntityConversationPromptPayload> {
  public readonly id = 'entity_conversation';
  public readonly promptType = 'entity_conversation' as const;
  public readonly service = 'optional';
  public readonly launchEntity = 'required';
  public readonly implementationReadiness = 'none';
  public readonly graphResearchGuidance = true;
  public readonly epistemicCalibration = true;
  public readonly projectAssistant = {
    allowEdgeUpdates: false,
    notifyDiscrepancies: false,
    workItemProposalMode: 'none',
  } as const;
  public readonly runnerKind = 'provider_session' as const;
  public readonly providerSessionCountsForContext = true;
  public readonly reports = [];
  public readonly mcpToolUseCase = 'general' as const;
  public readonly additionalAllowedTools = [
    ...ENTITY_CONVERSATION_ALLOWED_TOOLS,
    ...HINT_WRITE_MCP_TOOLS,
  ];
  /** Eval-launchable child: the production platform surface, read-only files. */
  public readonly childConfig = {
    adapterId: 'eval-entity-conversation',
    mcpAllowedTools: resolveMcpToolNames({
      useCase: 'general',
      additionalTools: ENTITY_CONVERSATION_ALLOWED_TOOLS,
    }),
    builtinAllowedTools: ['Read', 'Glob', 'Grep'],
    submissionTools: 'none',
    codexSandboxMode: 'read-only',
    includePriorReports: false,
  } as const;
  public readonly defaultReasoningEffort = 'high' as const;
  public readonly submissionTools: PassThroughSubmissionToolDeclaration[];
  public readonly addUserMessage = defaultAddUserMessage;
  public isCompletionOutput = completionResponseHooks.isCompletionOutput;
  public validateCompletion = completionResponseHooks.validateCompletion;
  public transformCompletionOutput = completionResponseHooks.transformCompletionOutput;
  public readonly requiresChangedFileReporting = true;
  public onInvalidCompletion = completionResponseHooks.onInvalidCompletion;
  public onComplete = completionResponseHooks.onComplete;

  private readonly workflowAboutReader: WorkflowAboutReader;

  public constructor(dependencies: EntityConversationHandlerDependencies) {
    this.workflowAboutReader = new WorkflowAboutReader({
      auth: dependencies.auth,
      apiBaseUrl: dependencies.apiBaseUrl,
    });
    this.submissionTools = [
      reportChangedFilesTool,
      new SubmitSessionNameTool({
        auth: dependencies.auth,
        apiBaseUrl: dependencies.apiBaseUrl,
        fetchImpl: dependencies.fetchImpl,
      }),
      new SearchSessionTool(
        {
          auth: dependencies.auth,
          apiBaseUrl: dependencies.apiBaseUrl,
        },
        this.workflowAboutReader,
      ),
    ];
    dependencies.logger.debug('entity_conversation.submission_tools.initialized', {
      toolNames: this.submissionTools.map((tool) => tool.name),
    });
  }

  public async prepare(
    run: AgenticSession,
    payload: LocalEntityConversationPromptPayload,
    promptDeps: PromptTypeHandlerDeps,
    context?: PromptTypeHandlerContext,
  ) {
    const runScope = requireRunEntityScope(run, promptDeps);
    const scopedPayload = buildPayloadFromRunEntity(run, payload, runScope, promptDeps);
    await assertConversationSubjectMatchesRun(run, this.workflowAboutReader, promptDeps, runScope);
    const authoritativeTaskType =
      runScope.entityType === EntityType.Task &&
      context?.loadedEntityContext?.kind === 'entity' &&
      'type' in context.loadedEntityContext.entity &&
      typeof context.loadedEntityContext.entity.type === 'string'
        ? context.loadedEntityContext.entity.type
        : undefined;
    const preparedPayload =
      authoritativeTaskType === undefined || scopedPayload.entity.taskType === authoritativeTaskType
        ? scopedPayload
        : {
            ...scopedPayload,
            entity: {
              ...scopedPayload.entity,
              taskType: authoritativeTaskType,
            },
          };
    promptDeps.logger.info('entity_conversation.prepare.run_entity_verified', {
      runId: run.agentic_session_id,
      entityId: runScope.entityId,
      entityType: runScope.entityType,
      entityTitle: preparedPayload.entity.title ?? null,
      taskType: preparedPayload.entity.taskType ?? null,
      usedPayloadTitle: Boolean(preparedPayload.entity.title),
    });
    const taskScope =
      runScope.entityType === EntityType.Task && preparedPayload.entity.taskType
        ? {
            [ENTITY_CONVERSATION_TASK_SCOPE_KEY]: {
              entityId: runScope.entityId,
              taskType: preparedPayload.entity.taskType,
            } satisfies EntityConversationTaskScope,
          }
        : undefined;
    return {
      payload: preparedPayload,
      ...(taskScope ? { sessionContext: taskScope } : {}),
    };
  }

  public resolveAdditionalAllowedTools({
    session,
    payload,
  }: ResolveAdditionalAllowedToolsArgs<LocalEntityConversationPromptPayload>) {
    const durableTaskScope = readDurableTaskScope(session);
    const taskType =
      payload?.entity?.taskType ??
      (durableTaskScope && durableTaskScope.entityId === session.entity?.entityId
        ? durableTaskScope.taskType
        : undefined);
    const isGoalScopedTask = session.entity?.entityType === EntityType.Task && taskType === 'GOAL';

    if (isGoalScopedTask) {
      return [...ENTITY_CONVERSATION_ALLOWED_TOOLS, ...GOAL_ENTITY_CONVERSATION_ALLOWED_TOOLS];
    }

    return ENTITY_CONVERSATION_ALLOWED_TOOLS;
  }

  public buildPrompt(
    payload: LocalEntityConversationPromptPayload,
    context?: PromptTypeHandlerContext,
  ): string {
    return buildEntityConversationPrompt(
      payload,
      context?.loadedEntityContext,
      context?.startedPromptTypes,
    );
  }

  public buildPromptSegments(
    payload: LocalEntityConversationPromptPayload,
    context?: PromptTypeHandlerContext,
  ) {
    return buildEntityConversationPromptSegments(
      payload,
      context?.loadedEntityContext,
      context?.startedPromptTypes,
    );
  }

  public buildStartingMessage(payload: LocalEntityConversationPromptPayload): string | null {
    const title = payload.entity.title;
    const entityType = payload.entity.entityType.toLowerCase();
    if (title && entityType) {
      return `Starting conversation about ${entityType} ${title}...`;
    }
    if (title) {
      return `Starting conversation about ${title}...`;
    }
    return 'Getting started...';
  }
}
