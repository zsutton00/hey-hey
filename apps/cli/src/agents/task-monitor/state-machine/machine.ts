import { protectedRequestReason } from './context';
import { z } from 'zod/v4';
import { and, assign, setup } from 'xstate';
import { currentJudgmentRequest } from './current-judgment-request';
import { ReportType, TaskMonitorReasoningEffort, WorkStatus } from '@hey-hey/contracts/api/models';
import type { TaskMonitorJudgmentResponse } from '@hey-hey/contracts/agent-bridge';

import {
  defineMachine,
  type MachineDefinition,
  type MachineIdentity,
  type MachineLogicState,
  type MachineRegistry,
  type MachineRuntime,
  type MachineStateStore,
  type MachineStateStoreCodec,
} from '../../../state-machine';
import type {
  TaskMonitorConversationInputContext,
  TaskMonitorExecutionNode,
  TaskMonitorHumanDecisionEvidence,
  TaskMonitorInterventionDecision,
  TaskMonitorLaunchDeclaration,
  TaskMonitorLaunchFailure,
  TaskMonitorMachineContext,
  TaskMonitorPendingIntervention,
  TaskMonitorPlanGuidanceProjection,
  TaskMonitorQueuedIntervention,
  TaskMonitorRequestedLaunchConfig,
  TaskMonitorRetryableLaunch,
  TaskMonitorReviewRequest,
  TaskMonitorSettledRun,
  TaskMonitorTerminalPolicy,
  TaskMonitorWorktree,
} from './context';
import { coordinatorValidationRecovery } from '../task-monitor-coordinator-recovery';
import { taskMonitorCoordinationLocalStateFromContext } from '../task-monitor-coordination';
import {
  deliverTaskMonitorReviewEffect,
  deliverTaskMonitorConversationMessageEffect,
  coordinateTaskMonitorWorkFromContext,
  haltTaskMonitorControlEffect,
  loadTaskMonitorEffect,
  projectTaskMonitorControlStatusEffect,
  projectTaskMonitorLaunchRecoveryEffect,
  reconcileTaskMonitorConversationResponseEffect,
  type TaskMonitorMachineEffect,
} from './effects';
import {
  appendConversationMessage,
  claimConversationMessage,
  settleConversationMessage,
  storeConversationTurn,
} from './input';
import { taskMonitorEventFromVerifiedCommand, taskMonitorEventFromVerifiedInput } from './events';
import type {
  TaskMonitorMachineEffectOutcome,
  TaskMonitorMachineEvent,
  VerifiedTaskMonitorInput,
} from './events';
import {
  matchesCoordinatedWork,
  matchesExhaustedWork,
  matchesLoadedTaskMonitor,
  matchesSelectedOperation,
  matchesSelectedLaunch,
  matchesSelectedWork,
  matchesLaunchFailure,
  matchesTaskMonitor,
} from './guards';
import { taskMonitorWorkStates } from './states';
import { toOpenApiMessageId } from '../../../shared/api/identifierAdapters';
import {
  canOpenExactActionIntervention,
  canOpenMonitorOwnedIntervention,
  isServiceScopeExactAction,
  matchesFailedServiceScopeApplication,
  nextQueuedIsServiceScope,
  canOpenUserRequiredIntervention,
  canQueueExactActionIntervention,
  hasQueuedHumanHeldIntervention,
  hasQueuedMonitorOwnedIntervention,
  hasQueuedUserRequiredIntervention,
  isMonitorOwnedExactAction,
  matchesQueuedHumanDecision,
  matchesQueuedMonitorEscalation,
  matchesQueuedServiceScopeEscalation,
  dropQueuedRequest,
  escalateQueuedRequest,
  swapInAnsweredQueuedRequest,
  retireUndeliveredIntervention,
  handQueuedRequestsToHumanOnStop,
  stopProjectionParameters,
  STOP_ESCALATION_REASON,
  pendingInterventionFromRequest,
  queuedInterventions,
  matchesPendingMonitorDecision,
  hasMonitorHeldProviderRequest,
  matchesPendingMonitorEscalation,
  matchesPendingServiceScopeEscalation,
  matchesApplyingDecision,
  matchesPendingInterventionProjection,
  matchesPendingHumanDecision,
  taskMonitorHaltedInterventionEvents,
  taskMonitorInterventionStates,
} from './intervention';
import {
  matchesActiveSettledRun,
  matchesActiveReviewRequest,
  matchesCommittedReviewRequest,
  matchesResolvedJudgment,
  matchesResolvedCoordinationJudgment,
  matchesSettledRunEvaluation,
  matchesCoordinationOutcome,
} from './supervision';

const TASK_MONITOR_MACHINE_TYPE = 'TASK_MONITOR' as const;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type ContractShape<Value> = Value extends readonly (infer Item)[]
  ? ContractShape<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: ContractShape<Value[Key]> }
    : Value;
type KeysMatch<Left, Right> = [keyof Left] extends [keyof Right]
  ? [keyof Right] extends [keyof Left]
    ? true
    : false
  : false;
type ShapesMatch<Left, Right> =
  KeysMatch<Left, Right> extends true
    ? [ContractShape<Left>] extends [ContractShape<Right>]
      ? [ContractShape<Right>] extends [ContractShape<Left>]
        ? true
        : false
      : false
    : false;
type ExpandTypeUnion<Shape> = Shape extends { type: infer Type }
  ? Type extends string
    ? Omit<Shape, 'type'> & { type: Type }
    : never
  : never;
type Expect<Value extends true> = Value;

const providerSchema = z.enum(['claude', 'codex', 'opencode']);
const effortSchema = z.enum(TaskMonitorReasoningEffort);
const methodSchema = z.enum(['plan', 'open', 'quick']);
const worktreeSchema = z
  .object({ enabled: z.boolean(), branch: z.string().optional() })
  .strict() satisfies z.ZodType<TaskMonitorWorktree>;
const terminalPolicySchema = z
  .object({ mode: z.enum(['AGENT_DECIDES', 'REQUIRE_REVIEW']) })
  .strict() satisfies z.ZodType<TaskMonitorTerminalPolicy>;
const normalizeUserGuidance = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};
const launchConfigSchema = z
  .object({
    taskId: z.string(),
    method: methodSchema,
    provider: providerSchema,
    model: z.string(),
    reasoningEffort: effortSchema,
    fastMode: z.boolean().optional(),
    worktree: worktreeSchema.optional(),
  })
  .strict() satisfies z.ZodType<TaskMonitorRequestedLaunchConfig>;
const executionNodeSchema = z
  .object({
    taskId: z.string(),
    dependsOnTaskIds: z.array(z.string()),
    method: methodSchema,
    provider: providerSchema,
    model: z.string(),
    reasoningEffort: effortSchema,
    fastMode: z.boolean().optional(),
    agentSessionId: z.string().nullable(),
  })
  .strict() satisfies z.ZodType<TaskMonitorExecutionNode>;
const planGuidancePlanSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    outcome: z.string(),
  })
  .strict()
  .transform((value): TaskMonitorPlanGuidanceProjection['plan'] => ({
    id: value.id,
    title: value.title,
    ...(value.description === undefined ? {} : { description: value.description }),
    outcome: value.outcome,
  })) satisfies z.ZodType<TaskMonitorPlanGuidanceProjection['plan']>;
const planGuidanceDesignDocSchema = z
  .object({ id: z.string(), title: z.string(), sections: z.record(z.string(), z.string()) })
  .strict() satisfies z.ZodType<TaskMonitorPlanGuidanceProjection['designDoc']>;
const planGuidanceStageSchema = z
  .object({ id: z.string(), title: z.string(), description: z.string().optional() })
  .strict()
  .transform((value): TaskMonitorPlanGuidanceProjection['stage'] => ({
    id: value.id,
    title: value.title,
    ...(value.description === undefined ? {} : { description: value.description }),
  })) satisfies z.ZodType<TaskMonitorPlanGuidanceProjection['stage']>;
const planGuidanceStepSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
  })
  .strict()
  .transform((value): TaskMonitorPlanGuidanceProjection['step'] => ({
    id: value.id,
    title: value.title,
    ...(value.description === undefined ? {} : { description: value.description }),
  })) satisfies z.ZodType<TaskMonitorPlanGuidanceProjection['step']>;
const planGuidanceSchema = z
  .object({
    plan: planGuidancePlanSchema,
    designDoc: planGuidanceDesignDocSchema.optional(),
    stage: planGuidanceStageSchema,
    step: planGuidanceStepSchema,
  })
  .strict()
  .transform(
    (value): TaskMonitorPlanGuidanceProjection => ({
      plan: value.plan,
      ...(value.designDoc === undefined ? {} : { designDoc: value.designDoc }),
      stage: value.stage,
      step: value.step,
    }),
  ) satisfies z.ZodType<TaskMonitorPlanGuidanceProjection>;
const launchDeclarationSchema = z
  .object({
    authorityCommandId: z.string().optional(),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    taskId: z.string(),
    taskTitle: z.string(),
    taskType: z.string(),
    taskDescription: z.string(),
    taskAcceptanceCriteria: z.string().nullable(),
    cursor: z.number().int().nonnegative(),
    method: methodSchema,
    provider: providerSchema,
    model: z.string(),
    reasoningEffort: effortSchema,
    fastMode: z.boolean().optional(),
    serviceIds: z.array(z.string()),
    worktree: worktreeSchema.optional(),
    userGuidance: z.string().nullable(),
    planGuidance: planGuidanceSchema.nullable(),
    executionOrder: z.array(z.string()),
    dependsOnTaskIds: z.array(z.string()),
    terminalPolicy: terminalPolicySchema,
    kindKey: z.string().min(1).nullable().optional(),
  })
  .strict() satisfies z.ZodType<TaskMonitorLaunchDeclaration>;

const workStateSchema = z.enum([
  'LOADING_MONITOR',
  'COORDINATING',
  'VALIDATING_LAUNCH',
  'RECONCILING_TASK_ACTIVATION',
  'RECONCILING_MONITOR_PROJECTION',
  'LAUNCH_READY',
  'CREATING_AGENT_SESSION',
  'CREATING_CONVERSATION',
  'STARTING_RUN',
  'RECONCILING_AGENT_SESSION_CREATION',
  'RECONCILING_CONVERSATION_CREATION',
  'RECONCILING_RUN_START',
  'PERSISTING_LAUNCH',
  'PROJECTING_STARTED',
  'OBSERVING_RUN',
  'EVALUATING_RUN',
  'REQUESTING_REVIEW',
  'AWAITING_REVIEW',
  'REVIEW_REQUEST_FAILED',
  'MONITOR_LOAD_FAILED',
  'LAUNCH_JUDGMENT',
  'OUTCOME_JUDGMENT',
  'SUPERVISION_FAILED',
  'RETRYABLE_LAUNCH',
  'ADMITTING_LAUNCH_RETRY',
]);

const humanEvidenceSchema = z
  .object({ userId: z.string(), authenticatedAt: z.string().datetime() })
  .strict() satisfies z.ZodType<TaskMonitorHumanDecisionEvidence>;
const interventionDecisionSchema = z
  .object({
    resolution: z.enum(['APPROVE', 'DENY']),
    decidedAt: z.string().datetime(),
    human: humanEvidenceSchema.nullable(),
    monitorRationale: z.string().nullable().default(null),
  })
  .strict() satisfies z.ZodType<TaskMonitorInterventionDecision>;
const requestKindSchema = z.enum(['PROVIDER_PERMISSION', 'SERVICE_SCOPE']);
const pendingInterventionSchema = z
  .object({
    interventionId: z.string(),
    providerActionId: z.string(),
    providerSessionId: z.string(),
    runId: z.string(),
    agentSessionId: z.string(),
    action: z.string(),
    target: z.string(),
    fingerprint: z.string(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    userRequired: z.boolean().optional(),
    requestKind: requestKindSchema.optional(),
    owner: z.enum(['MONITOR', 'HUMAN']).optional(),
    escalationReason: z.string().nullable().optional(),
    escalatedAt: z.string().nullable().optional(),
    decision: interventionDecisionSchema.nullable(),
    applicationFailure: z.string().nullable(),
  })
  .strict() satisfies z.ZodType<TaskMonitorPendingIntervention>;
const queuedInterventionSchema = z
  .object({
    interventionId: z.string(),
    providerActionId: z.string(),
    providerSessionId: z.string(),
    runId: z.string(),
    agentSessionId: z.string(),
    action: z.string(),
    target: z.string(),
    fingerprint: z.string(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    userRequired: z.boolean().optional(),
    requestKind: requestKindSchema.optional(),
    owner: z.enum(['MONITOR', 'HUMAN']).optional(),
    escalationReason: z.string().nullable().optional(),
    escalatedAt: z.string().nullable().optional(),
  })
  .strict() satisfies z.ZodType<TaskMonitorQueuedIntervention>;
const settledRunSchema = z
  .object({
    runId: z.string(),
    agentSessionId: z.string(),
    settledAt: z.string().datetime(),
    outcome: z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
    turnId: z.string(),
    promptType: z.string(),
    terminalOutcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
    completedAssistantMessageId: z.string().nullable(),
    reports: z.array(z.object({ reportId: z.string(), reportType: z.enum(ReportType) }).strict()),
    reviewRequestId: z.string().nullable().default(null),
  })
  .strict() satisfies z.ZodType<TaskMonitorSettledRun>;
const reviewRequestSchema = z
  .object({
    requestId: z.string(),
    coordinatorRunId: z.string(),
    agentSessionId: z.string(),
    rationale: z.string(),
    failureContext: z.string().nullable(),
  })
  .strict() satisfies z.ZodType<TaskMonitorReviewRequest>;
const launchFailureSchema = z
  .object({
    code: z.literal('BRANCH_CHECKED_OUT_IN_HOST_REPOSITORY'),
    message: z.string(),
    serviceId: z.string(),
    repositoryPath: z.string(),
    branch: z.string(),
    authority: z.enum(['PLAN', 'TASK_MONITOR']),
    correctionMode: z.enum(['PLAN_LOCKED', 'USER_EDITABLE']),
    correctiveAction: z.string(),
    fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict() satisfies z.ZodType<TaskMonitorLaunchFailure>;
const retryableLaunchSchema = z
  .object({
    taskId: z.string(),
    cursor: z.number().int().nonnegative(),
    agentSessionId: z.string(),
    conversationId: z.string(),
    failedOperation: z.literal('RUN_START'),
    failureReason: z.string(),
    failure: launchFailureSchema.optional(),
  })
  .strict() satisfies z.ZodType<TaskMonitorRetryableLaunch>;
const persistedTaskMonitorValueSchema = z.json();
type PersistedTaskMonitorValue = z.infer<typeof persistedTaskMonitorValueSchema>;

const normalizeLegacyReviewPolicy = (
  value: PersistedTaskMonitorValue,
): PersistedTaskMonitorValue => {
  if (Array.isArray(value)) {
    return value.map(normalizeLegacyReviewPolicy);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      if (
        (key === 'terminalPolicy' || key === 'terminalSupervision') &&
        nestedValue !== null &&
        !Array.isArray(nestedValue) &&
        typeof nestedValue === 'object' &&
        nestedValue['mode'] === 'SKIP_REVIEW'
      ) {
        return [key, { ...nestedValue, mode: 'AGENT_DECIDES' }];
      }
      const normalizedValue = normalizeLegacyReviewPolicy(nestedValue);
      return [key, normalizedValue];
    }),
  );
};

const isPersistedObject = (
  value: PersistedTaskMonitorValue | undefined,
): value is { [key: string]: PersistedTaskMonitorValue } =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object';

const migrateLegacyPlanGuidanceInLaunch = (
  value: PersistedTaskMonitorValue,
): PersistedTaskMonitorValue => {
  if (!isPersistedObject(value)) return value;
  const guidance = value['planGuidance'];
  if (!isPersistedObject(guidance)) return value;
  const step = guidance['step'];
  if (!isPersistedObject(step) || !('rationale' in step)) return value;
  const taskId = value['taskId'];
  if (typeof taskId !== 'string') {
    throw new Error('Legacy Plan guidance migration requires its launch Task ID.');
  }

  const currentStep = Object.fromEntries(
    Object.entries(step).filter(([field]) => field !== 'rationale'),
  );
  // Old guidance identifies the auxiliary PlanStep row. The launch already
  // carries the real execution Task identity; never reinterpret the old ID.
  return { ...value, planGuidance: { ...guidance, step: { ...currentStep, id: taskId } } };
};

const migrateLegacyPlanGuidanceInContext = (
  value: PersistedTaskMonitorValue,
): PersistedTaskMonitorValue => {
  if (!isPersistedObject(value)) return value;
  const launch = value['launch'];
  return isPersistedObject(launch)
    ? { ...value, launch: migrateLegacyPlanGuidanceInLaunch(launch) }
    : value;
};

const migrateLegacyPlanGuidanceInEffect = (
  value: PersistedTaskMonitorValue,
): PersistedTaskMonitorValue => {
  if (!isPersistedObject(value)) return value;
  const launch = value['launch'];
  return isPersistedObject(launch)
    ? { ...value, launch: migrateLegacyPlanGuidanceInLaunch(launch) }
    : value;
};

const migrateLegacyPlanGuidanceInOutcome = (
  value: PersistedTaskMonitorValue,
): PersistedTaskMonitorValue => {
  if (!isPersistedObject(value)) return value;
  const launch = value['launch'];
  return isPersistedObject(launch)
    ? { ...value, launch: migrateLegacyPlanGuidanceInLaunch(launch) }
    : value;
};

const migrateLegacyPlanGuidanceInAcceptedIngress = (
  value: PersistedTaskMonitorValue,
): PersistedTaskMonitorValue => {
  if (!isPersistedObject(value)) return value;
  const effects = value['effects'];
  const context = value['context'];
  const migrated = {
    ...value,
    ...(context === undefined ? {} : { context: migrateLegacyPlanGuidanceInContext(context) }),
    ...(Array.isArray(effects) ? { effects: effects.map(migrateLegacyPlanGuidanceInEffect) } : {}),
  };
  return migrated;
};

const migrateLegacyPlanGuidanceInCommittedEffect = (
  value: PersistedTaskMonitorValue,
): PersistedTaskMonitorValue => {
  if (!isPersistedObject(value)) return value;
  const execution = value['execution'];
  const effect = value['effect'];
  const migrated =
    effect === undefined ? value : { ...value, effect: migrateLegacyPlanGuidanceInEffect(effect) };
  if (!isPersistedObject(execution) || execution['status'] !== 'settled') {
    return migrated;
  }
  const settlement = execution['settlement'];
  if (!isPersistedObject(settlement)) return migrated;
  const outcome = settlement['outcome'];
  if (outcome === undefined) return migrated;
  return {
    ...migrated,
    ...(isPersistedObject(settlement)
      ? {
          execution: {
            ...execution,
            settlement: {
              ...settlement,
              outcome: migrateLegacyPlanGuidanceInOutcome(outcome),
            },
          },
        }
      : {}),
  };
};

const migrateLegacyPlanGuidanceStepRationale = (
  value: PersistedTaskMonitorValue,
): PersistedTaskMonitorValue => {
  if (!isPersistedObject(value)) return value;
  const acceptedIngress = value['acceptedIngress'];
  const effects = value['effects'];
  const context = value['context'];
  return {
    ...value,
    ...(context === undefined ? {} : { context: migrateLegacyPlanGuidanceInContext(context) }),
    ...(Array.isArray(acceptedIngress)
      ? { acceptedIngress: acceptedIngress.map(migrateLegacyPlanGuidanceInAcceptedIngress) }
      : {}),
    ...(Array.isArray(effects)
      ? { effects: effects.map(migrateLegacyPlanGuidanceInCommittedEffect) }
      : {}),
  };
};
const conversationInputSchema = z
  .object({
    queuedMessageIds: z.array(z.string()),
    active: z
      .object({
        messageId: z.string(),
        effectId: z.string(),
        runId: z.string().nullable(),
        turnId: z.string().nullable(),
        assistantMessageId: z.string().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict() satisfies z.ZodType<TaskMonitorConversationInputContext>;

const taskMonitorStateSchema = z.union([
  z.literal('ABSENT'),
  z.literal('HALTED'),
  z.literal('COMPLETED'),
  z
    .object({
      RUNNING: z
        .object({
          control: z.enum(['ACTIVE', 'PAUSING', 'PAUSED', 'RESUMING']),
          work: workStateSchema,
          intervention: z.enum([
            'CLEAR',
            'PENDING',
            'APPLYING_DECISION',
            'APPLICATION_FAILED',
            'APPLICATION_STALE',
            'APPLICATION_CANCELLED',
            'APPLICATION_UNCERTAIN',
          ]),
          input: z.enum(['WAITING_FOR_INPUT', 'READING_INPUT', 'RESPONDING_INPUT']),
        })
        .strict(),
    })
    .strict(),
]);

const validationFailureSchema = z
  .object({ code: z.string(), message: z.string(), issues: z.array(z.string()) })
  .strict();
const correctionSchema = z
  .object({ attempt: z.number().int().min(1).max(2), validationFailure: validationFailureSchema })
  .strict();

const taskMonitorContextSchema = z
  .object({
    taskMonitorId: z.string(),
    organizationId: z.string().nullable(),
    projectId: z.string().nullable(),
    kindKey: z.string().min(1).nullable().optional(),
    authorityCommandId: z.string().nullable().optional(),
    coordinationCause: z
      .enum(['START', 'RESUME', 'CONTINUE', 'JUDGMENT_RESOLVED'])
      .nullable()
      .optional(),
    coordinationCorrelationId: z.string().nullable().optional(),
    requestedLaunchConfig: launchConfigSchema.nullable(),
    executionPlan: z.array(executionNodeSchema),
    cursor: z.number().int().nonnegative().nullable(),
    selectedTaskId: z.string().nullable(),
    userGuidance: z.string().nullable(),
    worktree: worktreeSchema.nullable(),
    terminalPolicy: terminalPolicySchema.nullable(),
    launch: launchDeclarationSchema.nullable(),
    agentSessionId: z.string().nullable(),
    activeRunAgentSessionId: z.string().nullable(),
    conversationId: z.string().nullable(),
    retryableLaunch: retryableLaunchSchema.nullable().optional(),
    coordinatorConversationId: z.string().nullable(),
    pendingIntervention: pendingInterventionSchema.nullable(),
    queuedInterventions: z.array(queuedInterventionSchema).optional(),
    undeliveredInterventions: z.array(pendingInterventionSchema).optional(),
    settledRun: settledRunSchema.nullable(),
    reviewRequest: reviewRequestSchema.nullable().default(null),
    input: conversationInputSchema,
    failureReason: z.string().nullable(),
    pendingJudgment: z
      .object({ request: z.string(), requestMessageId: z.string().nullable() })
      .strict()
      .nullable()
      .optional(),
    coordinatorRecovery: z
      .lazy(() => coordinatorRecoverySchema)
      .nullable()
      .optional(),
  })
  .strict() satisfies z.ZodType<TaskMonitorMachineContext>;

const coordinationLocalStateSchema = z
  .object({
    control: z.enum(['ACTIVE', 'PAUSING', 'PAUSED', 'RESUMING']),
    work: z.string().min(1),
    userGuidance: z.string().nullable(),
    selectedTaskId: z.string().nullable(),
    activeRunAgentSessionId: z.string().nullable(),
    activeRunId: z.string().nullable(),
    conversationId: z.string().nullable(),
    reviewRequestId: z.string().nullable(),
    pendingJudgmentReason: z.string().nullable(),
    committedEffectId: z.string().nullable(),
    settledRun: z
      .object({
        runId: z.string(),
        settledAt: z.string(),
        outcome: z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
        turnId: z.string(),
        promptType: z.string(),
        terminalOutcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
        completedAssistantMessageId: z.string().nullable(),
        reports: z.array(
          z.object({ reportId: z.string(), reportType: z.enum(ReportType) }).strict(),
        ),
      })
      .nullable(),
  })
  .strict();

const loadEffectSchema = z
  .object({
    type: z.literal('LOAD_TASK_MONITOR'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    requestedLaunchConfig: launchConfigSchema,
  })
  .strict();
const coordinateEffectSchema = z
  .object({
    correction: correctionSchema.optional(),
    type: z.literal('COORDINATE_TASK_MONITOR_WORK'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    kindKey: z.string().min(1).nullable().default(null),
    executionPlan: z.array(executionNodeSchema),
    cursor: z.number().int().nonnegative(),
    cause: z.enum(['START', 'RESUME', 'CONTINUE', 'JUDGMENT_RESOLVED']).optional(),
    correlationId: z.string().optional(),
    authorityCommandId: z.string().optional(),
    coordination: coordinationLocalStateSchema.optional(),
    settledTurn: z
      .object({
        turnId: z.string(),
        promptType: z.string(),
        terminalOutcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
        completedAssistantMessage: z
          .object({ messageId: z.string(), content: z.string() })
          .nullable(),
        reports: z.array(z.object({ reportId: z.string(), reportType: z.string() }).strict()),
      })
      .optional(),
    judgment: z
      .object({
        requestMessageId: z.string().transform(toOpenApiMessageId),
        label: z.string(),
        conclusion: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();
const validateEffectSchema = z
  .object({
    type: z.literal('VALIDATE_TASK_MONITOR_LAUNCH'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    kindKey: z.string().min(1).nullable().default(null),
    authorityCommandId: z.string().optional(),
    requestedLaunchConfig: launchConfigSchema,
    executionPlan: z.array(executionNodeSchema),
    cursor: z.number().int().nonnegative(),
    taskId: z.string(),
    userGuidance: z.string().nullable(),
    worktree: worktreeSchema.nullable(),
    terminalPolicy: terminalPolicySchema,
  })
  .strict();
const reconcileEffectSchema = z
  .object({
    type: z.literal('RECONCILE_TASK_MONITOR_LAUNCH'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    kindKey: z.string().min(1).nullable().default(null),
    taskId: z.string(),
    cursor: z.number().int().nonnegative(),
    operation: z.enum([
      'TASK_ACTIVATION',
      'MONITOR_PROJECTION',
      'AGENT_SESSION_CREATION',
      'CONVERSATION_CREATION',
      'RUN_START',
    ]),
    agentSessionId: z.string().optional(),
    conversationId: z.string().optional(),
    retry: retryableLaunchSchema.optional(),
  })
  .strict();
const createSessionEffectSchema = z
  .object({ type: z.literal('CREATE_TASK_MONITOR_AGENT_SESSION'), launch: launchDeclarationSchema })
  .strict();
const createConversationEffectSchema = z
  .object({
    type: z.literal('CREATE_TASK_MONITOR_CONVERSATION'),
    launch: launchDeclarationSchema,
    agentSessionId: z.string(),
  })
  .strict();
const startRunEffectSchema = z
  .object({
    type: z.literal('START_TASK_MONITOR_RUN'),
    launch: launchDeclarationSchema,
    agentSessionId: z.string(),
    conversationId: z.string(),
  })
  .strict();
const persistLaunchEffectSchema = z
  .object({
    type: z.literal('PERSIST_TASK_MONITOR_LAUNCH'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    taskId: z.string(),
    cursor: z.number().int().nonnegative(),
    agentSessionId: z.string(),
  })
  .strict();
const startedProjectionEffectSchema = z
  .object({
    type: z.literal('PROJECT_TASK_MONITOR_STARTED'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    taskId: z.string(),
    taskTitle: z.string(),
  })
  .strict();
const launchRecoveryProjectionEffectSchema = z
  .object({
    type: z.literal('PROJECT_TASK_MONITOR_LAUNCH_RECOVERY'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    taskId: z.string(),
    agentSessionId: z.string(),
    conversationId: z.string(),
    failure: launchFailureSchema,
  })
  .strict();
const haltControlEffectSchema = z
  .object({
    type: z.literal('HALT_TASK_MONITOR_CONTROL'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    activeRunAgentSessionId: z.string().nullable(),
    failureContext: z.string(),
  })
  .strict();
const controlStatusProjectionEffectSchema = z
  .object({
    type: z.literal('PROJECT_TASK_MONITOR_CONTROL_STATUS'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    status: z.enum([WorkStatus.Active, WorkStatus.OnHold]),
  })
  .strict();
const deliverConversationMessageEffectSchema = z
  .object({
    type: z.literal('DELIVER_TASK_MONITOR_CONVERSATION_MESSAGE'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
  })
  .strict();
const reconcileConversationResponseEffectSchema = z
  .object({
    type: z.literal('RECONCILE_TASK_MONITOR_CONVERSATION_RESPONSE'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
    runId: z.string(),
    turnId: z.string(),
  })
  .strict();
const applyDecisionEffectSchema = z
  .object({
    type: z.literal('APPLY_TASK_MONITOR_DECISION'),
    operation: z.enum(['RELEASE_EXACT_ACTION', 'REJECT_EXACT_ACTION']),
    providerDecision: z.enum(['approve', 'always_approve', 'deny', 'whitelist']),
    taskMonitorId: z.string(),
    interventionId: z.string(),
    providerActionId: z.string(),
    providerSessionId: z.string(),
    runId: z.string(),
    agentSessionId: z.string(),
    action: z.string(),
    target: z.string(),
    fingerprint: z.string(),
    decidedAt: z.string().datetime(),
    requestKind: requestKindSchema.optional(),
    human: humanEvidenceSchema.nullable(),
    monitorRationale: z.string().nullable().default(null),
  })
  .strict();
const decideMonitorPermissionEffectSchema = z
  .object({
    type: z.literal('DECIDE_TASK_MONITOR_PERMISSION'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    conversationId: z.string().nullable(),
    interventionId: z.string(),
    providerActionId: z.string(),
    runId: z.string(),
    agentSessionId: z.string(),
    action: z.string(),
    target: z.string(),
    fingerprint: z.string(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    requestKind: requestKindSchema.optional(),
    monitorPaused: z.literal(true).optional(),
    dueAt: z.string().datetime().optional(),
  })
  .strict();
const watchMonitorPermissionDeadlineEffectSchema = z
  .object({
    type: z.literal('WATCH_TASK_MONITOR_PERMISSION_DEADLINE'),
    taskMonitorId: z.string(),
    interventionId: z.string(),
    providerActionId: z.string(),
    runId: z.string(),
    agentSessionId: z.string(),
    requestKind: requestKindSchema.optional(),
    dueAt: z.string().datetime(),
  })
  .strict();
const recordMonitorPermissionDecisionEffectSchema = z
  .object({
    type: z.literal('RECORD_TASK_MONITOR_PERMISSION_DECISION'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    conversationId: z.string().nullable(),
    interventionId: z.string(),
    providerActionId: z.string(),
    action: z.string(),
    target: z.string(),
    decision: z.enum(['APPROVED', 'DENIED', 'ESCALATED']),
    rationale: z.string(),
  })
  .strict();
const interventionProjectionEffectSchema = z
  .object({
    type: z.literal('PROJECT_TASK_MONITOR_INTERVENTION'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    conversationId: z.string(),
    interventionId: z.string(),
    providerActionId: z.string(),
    runId: z.string(),
    agentSessionId: z.string(),
    action: z.string(),
    target: z.string(),
    fingerprint: z.string(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    alsoProject: z
      .array(
        z
          .object({
            interventionId: z.string(),
            providerActionId: z.string(),
            runId: z.string(),
            agentSessionId: z.string(),
            action: z.string(),
            target: z.string(),
            fingerprint: z.string(),
            createdAt: z.string().datetime(),
            expiresAt: z.string().datetime().nullable(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
const settledRunEvaluationEffectSchema = z
  .object({
    correction: correctionSchema.optional(),
    type: z.literal('EVALUATE_TASK_MONITOR_SETTLED_RUN'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    kindKey: z.string().min(1).nullable().default(null),
    authorityCommandId: z.string().optional(),
    runId: z.string(),
    agentSessionId: z.string(),
    settledAt: z.string().datetime(),
    outcome: z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
    turnId: z.string(),
    promptType: z.string(),
    terminalOutcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
    completedAssistantMessageId: z.string().nullable(),
    reports: z.array(z.object({ reportId: z.string(), reportType: z.enum(ReportType) }).strict()),
    reviewRequestId: z.string().nullable().default(null),
    judgment: z
      .object({
        requestMessageId: z.string().transform(toOpenApiMessageId),
        label: z.string(),
        conclusion: z.string(),
      })
      .strict()
      .optional() satisfies z.ZodType<TaskMonitorJudgmentResponse | undefined>,
  })
  .strict();
const coordinatorRecoverySchema = z
  .object({
    evaluation: z.union([coordinateEffectSchema, settledRunEvaluationEffectSchema]),
    correctionAttempt: z.number().int().min(0).max(2),
    failure: validationFailureSchema,
    pendingCorrection: z.boolean(),
    requestId: z.string(),
    requestMessageId: z.string().nullable(),
    conversationId: z.string().nullable(),
    deliveryFailure: z.string().nullable(),
  })
  .strict();
const outcomeJudgmentProjectionEffectSchema = z
  .object({
    type: z.literal('PROJECT_TASK_MONITOR_OUTCOME_JUDGMENT'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    requestId: z.string(),
    failure: validationFailureSchema,
  })
  .strict();
const deliverReviewEffectSchema = z
  .object({
    type: z.literal('DELIVER_TASK_MONITOR_REVIEW'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    runId: z.string(),
    agentSessionId: z.string(),
    requestId: z.string(),
    coordinatorRunId: z.string(),
    rationale: z.string(),
  })
  .strict();
const taskMonitorEffectSchema = z.discriminatedUnion('type', [
  outcomeJudgmentProjectionEffectSchema,
  loadEffectSchema,
  coordinateEffectSchema,
  validateEffectSchema,
  reconcileEffectSchema,
  createSessionEffectSchema,
  createConversationEffectSchema,
  startRunEffectSchema,
  persistLaunchEffectSchema,
  startedProjectionEffectSchema,
  launchRecoveryProjectionEffectSchema,
  controlStatusProjectionEffectSchema,
  deliverConversationMessageEffectSchema,
  reconcileConversationResponseEffectSchema,
  haltControlEffectSchema,
  interventionProjectionEffectSchema,
  decideMonitorPermissionEffectSchema,
  watchMonitorPermissionDeadlineEffectSchema,
  recordMonitorPermissionDecisionEffectSchema,
  settledRunEvaluationEffectSchema,
  deliverReviewEffectSchema,
  applyDecisionEffectSchema,
]) satisfies z.ZodType<TaskMonitorMachineEffect>;

const loadedOutcomeSchema = z
  .object({
    type: z.literal('MONITOR_LOADED'),
    taskMonitorId: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    executionPlan: z.array(executionNodeSchema),
    cursor: z.number().int().nonnegative(),
    worktree: worktreeSchema.nullable(),
    terminalPolicy: terminalPolicySchema,
    kindKey: z.string().min(1).nullable().default(null),
  })
  .strict();
const taskMonitorEffectOutcomeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('COORDINATOR_CORRECTION_DEFERRED'),
      taskMonitorId: z.string(),
      evaluation: z.union([coordinateEffectSchema, settledRunEvaluationEffectSchema]),
    })
    .strict(),
  z
    .object({
      type: z.literal('COORDINATOR_DECISION_INVALID'),
      taskMonitorId: z.string(),
      runId: z.string(),
      agentSessionId: z.string(),
      attemptId: z.string(),
      evaluation: z.union([coordinateEffectSchema, settledRunEvaluationEffectSchema]),
      failure: validationFailureSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('OUTCOME_JUDGMENT_PROJECTED'),
      taskMonitorId: z.string(),
      requestId: z.string(),
      messageId: z.string(),
      conversationId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('OUTCOME_JUDGMENT_PROJECTION_FAILED'),
      taskMonitorId: z.string(),
      requestId: z.string(),
      reason: z.string(),
    })
    .strict(),
  loadedOutcomeSchema,
  z
    .object({
      type: z.literal('LAUNCH_RECOVERY_PROJECTED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      agentSessionId: z.string(),
      fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      messageId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('LAUNCH_RECOVERY_PROJECTION_FAILED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      agentSessionId: z.string(),
      fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('CONVERSATION_TURN_STARTED'),
      taskMonitorId: z.string(),
      messageId: z.string(),
      runId: z.string(),
      turnId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('CONVERSATION_RESPONSE_PERSISTED'),
      taskMonitorId: z.string(),
      messageId: z.string(),
      runId: z.string(),
      turnId: z.string(),
      assistantMessageId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('CONVERSATION_DELIVERY_FAILED'),
      taskMonitorId: z.string(),
      messageId: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('MONITOR_LOAD_FAILED'),
      taskMonitorId: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('WORK_SELECTED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      cursor: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('WORK_EXHAUSTED'),
      taskMonitorId: z.string(),
      cursor: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('COORDINATION_FAILED'),
      taskMonitorId: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('LAUNCH_VALIDATED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      cursor: z.number().int().nonnegative(),
      launch: launchDeclarationSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('LAUNCH_VALIDATION_FAILED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      cursor: z.number().int().nonnegative(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('LAUNCH_VALIDATION_UNCERTAIN'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      cursor: z.number().int().nonnegative(),
      operation: z.enum(['TASK_ACTIVATION', 'MONITOR_PROJECTION']),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('AGENT_SESSION_CREATED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      agentSessionId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('CONVERSATION_CREATED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      agentSessionId: z.string(),
      conversationId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('RUN_STARTED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      agentSessionId: z.string(),
      conversationId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('TASK_MONITOR_LAUNCH_PERSISTED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      agentSessionId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('LAUNCH_RETRY_ADMITTED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      cursor: z.number().int().nonnegative(),
      agentSessionId: z.string(),
      conversationId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('LAUNCH_RETRY_REJECTED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      cursor: z.number().int().nonnegative(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('TASK_MONITOR_LAUNCH_PERSISTENCE_FAILED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.enum(['LAUNCH_OPERATION_FAILED', 'LAUNCH_OPERATION_CANCELLED']),
      taskMonitorId: z.string(),
      taskId: z.string(),
      operation: z.enum(['AGENT_SESSION_CREATION', 'CONVERSATION_CREATION', 'RUN_START']),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('LAUNCH_OPERATION_UNCERTAIN'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      cursor: z.number().int().nonnegative(),
      operation: z.enum(['AGENT_SESSION_CREATION', 'CONVERSATION_CREATION', 'RUN_START']),
      agentSessionId: z.string(),
      conversationId: z.string().optional(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('OPERATION_FOUND'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      cursor: z.number().int().nonnegative(),
      operation: z.enum([
        'TASK_ACTIVATION',
        'MONITOR_PROJECTION',
        'AGENT_SESSION_CREATION',
        'CONVERSATION_CREATION',
        'RUN_START',
      ]),
      agentSessionId: z.string().optional(),
      conversationId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('OPERATION_ABSENT'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      cursor: z.number().int().nonnegative(),
      operation: z.enum([
        'TASK_ACTIVATION',
        'MONITOR_PROJECTION',
        'AGENT_SESSION_CREATION',
        'CONVERSATION_CREATION',
        'RUN_START',
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal('RECONCILIATION_FAILED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      cursor: z.number().int().nonnegative(),
      operation: z.enum([
        'TASK_ACTIVATION',
        'MONITOR_PROJECTION',
        'AGENT_SESSION_CREATION',
        'CONVERSATION_CREATION',
        'RUN_START',
      ]),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('TASK_STARTED_PROJECTED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('TASK_STARTED_PROJECTION_FAILED'),
      taskMonitorId: z.string(),
      taskId: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('TASK_MONITOR_STOP_SUCCEEDED'),
      taskMonitorId: z.string(),
      stoppedAt: z.string().datetime().optional(),
    })
    .strict(),
  z
    .object({
      type: z.enum([
        'TASK_MONITOR_STOP_FAILED',
        'TASK_MONITOR_STOP_CANCELLED',
        'TASK_MONITOR_STOP_UNCERTAIN',
      ]),
      taskMonitorId: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('TASK_MONITOR_CONTROL_STATUS_PROJECTED'),
      taskMonitorId: z.string(),
      status: z.enum([WorkStatus.Active, WorkStatus.OnHold]),
    })
    .strict(),
  z
    .object({
      type: z.enum([
        'TASK_MONITOR_CONTROL_STATUS_PROJECTION_FAILED',
        'TASK_MONITOR_CONTROL_STATUS_PROJECTION_CANCELLED',
        'TASK_MONITOR_CONTROL_STATUS_PROJECTION_UNCERTAIN',
      ]),
      taskMonitorId: z.string(),
      status: z.enum([WorkStatus.Active, WorkStatus.OnHold]),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('SUPERVISION_CONTINUES_OBSERVING'),
      taskMonitorId: z.string(),
      runId: z.string(),
      agentSessionId: z.string(),
      nextAgentSessionId: z.string().optional(),
      nextConversationId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('REVIEW_REQUEST_COMMITTED'),
      taskMonitorId: z.string(),
      runId: z.string(),
      agentSessionId: z.string(),
      requestId: z.string(),
      coordinatorRunId: z.string(),
      rationale: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('REVIEW_REQUEST_ACCEPTED'),
      taskMonitorId: z.string(),
      runId: z.string(),
      agentSessionId: z.string(),
      requestId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('REVIEW_REQUEST_FAILED'),
      taskMonitorId: z.string(),
      runId: z.string(),
      agentSessionId: z.string(),
      requestId: z.string(),
      reason: z.string(),
      ambiguous: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('COORDINATION_CONTINUES'),
      taskMonitorId: z.string(),
      runId: z.string(),
      agentSessionId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.enum(['LAUNCH_JUDGMENT_REQUIRED', 'SUPERVISION_FAILED', 'SUPERVISION_HALTED']),
      taskMonitorId: z.string(),
      runId: z.string(),
      agentSessionId: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('OUTCOME_JUDGMENT_REQUIRED'),
      taskMonitorId: z.string(),
      runId: z.string(),
      agentSessionId: z.string(),
      reason: z.string(),
      requestMessageId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('SUPERVISION_COMPLETED'),
      taskMonitorId: z.string(),
      runId: z.string(),
      agentSessionId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('INTERVENTION_PROJECTED'),
      taskMonitorId: z.string(),
      interventionId: z.string(),
      providerActionId: z.string(),
      messageId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('INTERVENTION_PROJECTION_FAILED'),
      taskMonitorId: z.string(),
      interventionId: z.string(),
      providerActionId: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('MONITOR_PERMISSION_DECIDED'),
      taskMonitorId: z.string(),
      interventionId: z.string(),
      providerActionId: z.string(),
      fingerprint: z.string(),
      resolution: z.enum(['APPROVE', 'DENY']),
      providerDecision: z.enum(['approve', 'deny']),
      rationale: z.string(),
      decidedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal('MONITOR_PERMISSION_ESCALATED'),
      taskMonitorId: z.string(),
      interventionId: z.string(),
      providerActionId: z.string(),
      reason: z.string(),
      escalatedAt: z.string().datetime().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('PERMISSION_DEADLINE_ARMED'),
      taskMonitorId: z.string(),
      interventionId: z.string(),
      providerActionId: z.string(),
      dueAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      type: z.literal('PERMISSION_DECISION_RECORDED'),
      taskMonitorId: z.string(),
      interventionId: z.string(),
      providerActionId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('PERMISSION_DECISION_RECORD_FAILED'),
      taskMonitorId: z.string(),
      interventionId: z.string(),
      providerActionId: z.string(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('DECISION_APPLIED'),
      taskMonitorId: z.string(),
      interventionId: z.string(),
      providerActionId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.enum([
        'DECISION_APPLICATION_STALE',
        'DECISION_APPLICATION_FAILED',
        'DECISION_APPLICATION_CANCELLED',
        'DECISION_APPLICATION_UNCERTAIN',
      ]),
      taskMonitorId: z.string(),
      interventionId: z.string(),
      providerActionId: z.string(),
      reason: z.string(),
    })
    .strict(),
]) satisfies z.ZodType<TaskMonitorMachineEffectOutcome>;

type _TaskMonitorContextSchemaMatches = Expect<
  Equal<
    ContractShape<z.output<typeof taskMonitorContextSchema>>,
    ContractShape<TaskMonitorMachineContext>
  >
>;
type _TaskMonitorEffectSchemaMatches = Expect<
  Equal<
    ContractShape<z.output<typeof taskMonitorEffectSchema>>,
    ContractShape<TaskMonitorMachineEffect>
  >
>;
type TaskMonitorOutcomeSchemaOutput = z.output<typeof taskMonitorEffectOutcomeSchema>;
type TaskMonitorOutcomeType = TaskMonitorMachineEffectOutcome['type'];
type TaskMonitorOutcomeMismatch = {
  [Type in TaskMonitorOutcomeType]: ShapesMatch<
    Extract<ExpandTypeUnion<TaskMonitorOutcomeSchemaOutput>, { type: Type }>,
    Extract<TaskMonitorMachineEffectOutcome, { type: Type }>
  > extends true
    ? never
    : Type;
}[TaskMonitorOutcomeType];
type _TaskMonitorOutcomeSchemaMatches = Expect<Equal<TaskMonitorOutcomeMismatch, never>>;

const haltControlParameters = ({
  context,
  event,
}: {
  context: TaskMonitorMachineContext;
  event: TaskMonitorMachineEvent;
}) => {
  if (event.type !== 'STOP') throw new Error('Expected STOP.');
  return haltTaskMonitorControlEffect(context, event);
};

const pausedStatusProjectionParameters = ({ context }: { context: TaskMonitorMachineContext }) =>
  projectTaskMonitorControlStatusEffect(context, WorkStatus.OnHold);

const activeStatusProjectionParameters = ({ context }: { context: TaskMonitorMachineContext }) =>
  projectTaskMonitorControlStatusEffect(context, WorkStatus.Active);

const resumeCoordinationParameters = ({ context }: { context: TaskMonitorMachineContext }) => {
  const correlationId = context.coordinationCorrelationId ?? context.authorityCommandId;
  if (!correlationId) throw new Error('Task Monitor Resume has no admitted correlation.');
  return coordinateTaskMonitorWorkFromContext(context, {
    cause: 'RESUME',
    cursor: context.cursor ?? 0,
    correlationId,
    coordination: taskMonitorCoordinationLocalStateFromContext(context, 'ACTIVE', 'COORDINATING'),
    ...(context.settledRun
      ? {
          settledTurn: {
            turnId: context.settledRun.turnId,
            promptType: context.settledRun.promptType,
            terminalOutcome: context.settledRun.terminalOutcome,
            completedAssistantMessage: null,
            reports: context.settledRun.reports.map(({ reportId, reportType }) => ({
              reportId,
              reportType,
            })),
          },
        }
      : {}),
  });
};

const receivedConversationMessageParameters = ({
  context,
  event,
}: {
  context: TaskMonitorMachineContext;
  event: TaskMonitorMachineEvent;
}) => {
  if (event.type !== 'CONVERSATION_MESSAGE_RECEIVED') {
    throw new Error('Expected CONVERSATION_MESSAGE_RECEIVED.');
  }
  if (context.organizationId !== event.organizationId || context.projectId !== event.projectId) {
    throw new Error('Canonical Task Monitor conversation input owner does not match context.');
  }
  return {
    type: 'DELIVER_TASK_MONITOR_CONVERSATION_MESSAGE' as const,
    taskMonitorId: context.taskMonitorId,
    organizationId: event.organizationId,
    projectId: event.projectId,
    conversationId: event.conversationId,
    messageId: event.messageId,
  };
};

const queuedConversationMessageParameters = ({
  context,
}: {
  context: TaskMonitorMachineContext;
}) => {
  const messageId = context.input.queuedMessageIds[0];
  if (!messageId) throw new Error('Task Monitor conversation queue is empty.');
  return deliverTaskMonitorConversationMessageEffect(context, messageId);
};

const taskMonitorMachine = setup({
  types: {
    context: {} as TaskMonitorMachineContext,
    events: {} as TaskMonitorMachineEvent,
    input: {} as MachineIdentity,
  },
  guards: {
    matchesTaskMonitor,
    matchesLoadedTaskMonitor,
    matchesCoordinatedWork,
    matchesExhaustedWork,
    matchesSelectedWork,
    matchesLaunchFailure,
    matchesTaskActivationOperation: (arguments_) =>
      matchesSelectedOperation('TASK_ACTIVATION', arguments_),
    matchesMonitorProjectionOperation: (arguments_) =>
      matchesSelectedOperation('MONITOR_PROJECTION', arguments_),
    matchesAgentSessionCreationOperation: (arguments_) =>
      matchesSelectedOperation('AGENT_SESSION_CREATION', arguments_),
    matchesConversationCreationOperation: (arguments_) =>
      matchesSelectedOperation('CONVERSATION_CREATION', arguments_),
    matchesRunStartOperation: (arguments_) => matchesSelectedOperation('RUN_START', arguments_),
    matchesRunStartFailure: ({ context, event }) =>
      (event.type === 'LAUNCH_OPERATION_FAILED' || event.type === 'LAUNCH_OPERATION_CANCELLED') &&
      event.operation === 'RUN_START' &&
      matchesSelectedLaunch({ context, event }),
    matchesRetryableLaunch: ({ context, event }) =>
      context.retryableLaunch != null &&
      (event.type === 'LAUNCH_RETRY_ADMITTED' || event.type === 'LAUNCH_RETRY_REJECTED') &&
      event.taskMonitorId === context.taskMonitorId &&
      event.taskId === context.retryableLaunch.taskId &&
      event.cursor === context.retryableLaunch.cursor,
    matchesSelectedLaunch,
    canOpenExactActionIntervention,
    canOpenMonitorOwnedIntervention,
    isServiceScopeExactAction,
    nextQueuedIsServiceScope,
    matchesFailedServiceScopeApplication,
    canOpenUserRequiredIntervention,
    canQueueExactActionIntervention,
    hasQueuedMonitorOwnedIntervention,
    hasQueuedUserRequiredIntervention,
    hasQueuedHumanHeldIntervention,
    isMonitorOwnedExactAction,
    matchesQueuedMonitorEscalation,
    matchesQueuedServiceScopeEscalation,
    matchesQueuedHumanDecision,
    matchesPendingMonitorDecision,
    hasMonitorHeldProviderRequest,
    matchesPendingMonitorEscalation,
    matchesPendingServiceScopeEscalation,
    matchesPendingHumanDecision,
    matchesPendingInterventionProjection,
    matchesApplyingDecision,
    notRecoveringCoordinator: ({ context }) => context.coordinatorRecovery == null,
    canDeliverSettledCorrection: ({ context }) =>
      context.coordinatorRecovery?.pendingCorrection === true &&
      context.coordinatorRecovery.evaluation.type === 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
    canDeliverCoordinationCorrection: ({ context }) =>
      context.coordinatorRecovery?.pendingCorrection === true &&
      context.coordinatorRecovery.evaluation.type === 'COORDINATE_TASK_MONITOR_WORK',
    matchesRecoveryProjection: ({ context, event }) =>
      (event.type === 'OUTCOME_JUDGMENT_PROJECTED' ||
        event.type === 'OUTCOME_JUDGMENT_PROJECTION_FAILED') &&
      event.taskMonitorId === context.taskMonitorId &&
      event.requestId === context.coordinatorRecovery?.requestId,
    matchesActiveSettledRun,
    matchesActiveReviewRequest,
    matchesCommittedReviewRequest,
    matchesResolvedJudgment,
    matchesResolvedCoordinationJudgment,
    matchesSettledRunEvaluation,
    matchesCoordinationOutcome,
    resumeNeedsCoordination: ({ context, event }) =>
      event.type === 'TASK_MONITOR_CONTROL_STATUS_PROJECTED' &&
      event.taskMonitorId === context.taskMonitorId &&
      event.status === WorkStatus.Active &&
      context.coordinationCause === 'RESUME',
  },
  actions: {
    projectTaskMonitorOutcomeJudgment: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    storeDeferredCorrection: assign({
      coordinatorRecovery: ({ context, event }) =>
        event.type === 'COORDINATOR_CORRECTION_DEFERRED' &&
        context.coordinatorRecovery &&
        event.evaluation.correction?.attempt === context.coordinatorRecovery.correctionAttempt
          ? {
              ...context.coordinatorRecovery,
              evaluation: event.evaluation,
              pendingCorrection: true,
            }
          : context.coordinatorRecovery,
    }),
    clearCoordinatorRecovery: assign({
      coordinatorRecovery: null,
      failureReason: null,
      pendingJudgment: null,
    }),
    clearPendingCorrection: assign({
      coordinatorRecovery: ({ context }) =>
        context.coordinatorRecovery
          ? { ...context.coordinatorRecovery, pendingCorrection: false }
          : null,
    }),
    storeCoordinatorRecovery: assign({
      coordinatorRecovery: ({ context, event }) => {
        if (event.type !== 'COORDINATOR_DECISION_INVALID') return context.coordinatorRecovery;
        const policy = coordinatorValidationRecovery(
          event.evaluation.correction?.attempt ?? 0,
          event.failure,
        );
        return {
          evaluation:
            policy.kind === 'CORRECT'
              ? { ...event.evaluation, correction: policy.correction }
              : event.evaluation,
          correctionAttempt: policy.kind === 'CORRECT' ? policy.correction.attempt : 2,
          pendingCorrection: policy.kind === 'CORRECT',
          failure: event.failure,
          requestId: event.attemptId,
          requestMessageId: null,
          conversationId: null,
          deliveryFailure: null,
        };
      },
      // A recovery request replaces any earlier question the user was asked.
      pendingJudgment: null,
      failureReason: ({ context, event }) =>
        event.type === 'COORDINATOR_DECISION_INVALID'
          ? event.failure.message
          : context.failureReason,
    }),
    storeRecoveryProjection: assign({
      coordinatorRecovery: ({ context, event }) =>
        context.coordinatorRecovery && event.type === 'OUTCOME_JUDGMENT_PROJECTED'
          ? {
              ...context.coordinatorRecovery,
              requestMessageId: event.messageId,
              conversationId: event.conversationId,
              deliveryFailure: null,
            }
          : context.coordinatorRecovery,
      coordinatorConversationId: ({ context, event }) =>
        event.type === 'OUTCOME_JUDGMENT_PROJECTED'
          ? event.conversationId
          : context.coordinatorConversationId,
    }),
    storeRecoveryProjectionFailure: assign({
      coordinatorRecovery: ({ context, event }) =>
        context.coordinatorRecovery && event.type === 'OUTCOME_JUDGMENT_PROJECTION_FAILED'
          ? { ...context.coordinatorRecovery, deliveryFailure: event.reason }
          : context.coordinatorRecovery,
    }),
    loadTaskMonitor: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    coordinateTaskMonitorWork: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    /**
     * Resume starts a fresh assessment, so the correction counter restarts. A
     * request already posted stays the one the user is asked to answer until the
     * reassessment resolves or replaces it; it moves to the ordinary pending request
     * so its identity, display and coordinator input survive.
     */
    admitResumeCoordination: assign({
      pendingJudgment: ({ context }) => {
        const current = currentJudgmentRequest(context);

        return current?.posted
          ? { request: current.request, requestMessageId: current.requestMessageId }
          : null;
      },
      failureReason: ({ context }) =>
        currentJudgmentRequest(context)?.posted ? null : context.failureReason,
      coordinatorRecovery: null,
      coordinationCause: 'RESUME',
      coordinationCorrelationId: ({ context, event }) =>
        event.type === 'RESUME'
          ? (event.commandId ?? context.authorityCommandId ?? null)
          : context.coordinationCorrelationId,
    }),
    clearCoordinationAdmission: assign({
      coordinationCause: null,
      coordinationCorrelationId: null,
    }),
    validateTaskMonitorLaunch: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    reconcileTaskMonitorLaunch: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    createTaskMonitorAgentSession: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    createTaskMonitorConversation: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    startTaskMonitorRun: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    persistTaskMonitorLaunch: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    projectTaskMonitorStarted: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    projectTaskMonitorLaunchRecovery: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    haltTaskMonitorControl: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    projectTaskMonitorControlStatus: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    applyTaskMonitorDecision: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    projectTaskMonitorIntervention: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    decideTaskMonitorPermission: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    watchTaskMonitorPermissionDeadline: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    recordTaskMonitorPermissionDecision: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    evaluateTaskMonitorSettledRun: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    deliverTaskMonitorReview: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    deliverTaskMonitorConversationMessage: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    reconcileTaskMonitorConversationResponse: (arguments_, params: TaskMonitorMachineEffect) => {
      void arguments_;
      void params;
    },
    appendConversationMessage: assign({
      input: ({ context, event }) =>
        event.type === 'CONVERSATION_MESSAGE_RECEIVED'
          ? appendConversationMessage(context, event)
          : context.input,
    }),
    claimReceivedConversationMessage: assign({
      input: ({ context, event }) =>
        event.type === 'CONVERSATION_MESSAGE_RECEIVED'
          ? claimConversationMessage(context, event.messageId)
          : context.input,
    }),
    claimQueuedConversationMessage: assign({
      input: ({ context }) => {
        const messageId = context.input.queuedMessageIds[0];
        return messageId ? claimConversationMessage(context, messageId) : context.input;
      },
    }),
    storeConversationTurn: assign({
      input: ({ context, event }) =>
        event.type === 'CONVERSATION_TURN_STARTED'
          ? storeConversationTurn(context, event)
          : context.input,
    }),
    storeCoordinatorConversation: assign({
      coordinatorConversationId: ({ context, event }) =>
        event.type === 'CONVERSATION_MESSAGE_RECEIVED'
          ? event.conversationId
          : context.coordinatorConversationId,
    }),
    settleConversationMessage: assign({
      input: ({ context, event }) =>
        event.type === 'CONVERSATION_RESPONSE_PERSISTED' ||
        event.type === 'CONVERSATION_DELIVERY_FAILED'
          ? settleConversationMessage(context, event)
          : context.input,
    }),
    storeLoadedMonitor: assign({
      executionPlan: ({ context, event }) =>
        event.type === 'MONITOR_LOADED' ? event.executionPlan : context.executionPlan,
      cursor: ({ context, event }) =>
        event.type === 'MONITOR_LOADED' ? event.cursor : context.cursor,
      worktree: ({ context, event }) =>
        event.type === 'MONITOR_LOADED' ? event.worktree : context.worktree,
      terminalPolicy: ({ context, event }) =>
        event.type === 'MONITOR_LOADED' ? event.terminalPolicy : context.terminalPolicy,
      kindKey: ({ context, event }) =>
        event.type === 'MONITOR_LOADED' ? event.kindKey : (context.kindKey ?? null),
      failureReason: null,
    }),
    storeSelectedWork: assign({
      selectedTaskId: ({ context, event }) =>
        event.type === 'WORK_SELECTED' ? event.taskId : context.selectedTaskId,
      cursor: ({ context, event }) =>
        event.type === 'WORK_SELECTED' ? event.cursor : context.cursor,
      launch: null,
      agentSessionId: null,
      activeRunAgentSessionId: null,
      conversationId: null,
      retryableLaunch: null,
      settledRun: null,
      failureReason: null,
      coordinatorRecovery: null,
      pendingJudgment: null,
    }),
    storeCursor: assign({
      cursor: ({ context, event }) =>
        event.type === 'WORK_EXHAUSTED' ? event.cursor : context.cursor,
      selectedTaskId: null,
      launch: null,
      failureReason: null,
      coordinatorRecovery: null,
      pendingJudgment: null,
    }),
    storeValidatedLaunch: assign({
      launch: ({ context, event }) =>
        event.type === 'LAUNCH_VALIDATED' ? event.launch : context.launch,
      failureReason: null,
    }),
    storePersistedLaunch: assign({
      executionPlan: ({ context, event }) => {
        if (event.type !== 'TASK_MONITOR_LAUNCH_PERSISTED') {
          return context.executionPlan;
        }

        return context.executionPlan.map((entry) =>
          entry.taskId === event.taskId
            ? { ...entry, agentSessionId: event.agentSessionId }
            : entry,
        );
      },
    }),
    storeAgentSession: assign({
      agentSessionId: ({ context, event }) =>
        'agentSessionId' in event && typeof event.agentSessionId === 'string'
          ? event.agentSessionId
          : context.agentSessionId,
      failureReason: null,
    }),
    storeConversation: assign({
      agentSessionId: ({ context, event }) =>
        'agentSessionId' in event && typeof event.agentSessionId === 'string'
          ? event.agentSessionId
          : context.agentSessionId,
      conversationId: ({ context, event }) =>
        'conversationId' in event && event.conversationId !== undefined
          ? event.conversationId
          : context.conversationId,
      failureReason: null,
    }),
    storeRetryableLaunch: assign({
      retryableLaunch: ({ context, event }) =>
        event.type === 'LAUNCH_FAILURE_REPORTED' &&
        context.cursor !== null &&
        context.agentSessionId !== null &&
        context.conversationId !== null
          ? {
              taskId: event.taskId,
              cursor: event.cursor,
              agentSessionId: event.agentSessionId,
              conversationId: event.conversationId,
              failedOperation: 'RUN_START',
              failureReason: event.failure.message,
              failure: event.failure,
            }
          : (event.type === 'LAUNCH_OPERATION_FAILED' ||
                event.type === 'LAUNCH_OPERATION_CANCELLED') &&
              event.operation === 'RUN_START' &&
              context.cursor !== null &&
              context.agentSessionId !== null &&
              context.conversationId !== null
            ? {
                taskId: event.taskId,
                cursor: context.cursor,
                agentSessionId: context.agentSessionId,
                conversationId: context.conversationId,
                failedOperation: 'RUN_START',
                failureReason: event.reason,
              }
            : context.retryableLaunch,
      activeRunAgentSessionId: ({ context, event }) =>
        event.type === 'LAUNCH_FAILURE_REPORTED' ? null : context.activeRunAgentSessionId,
      failureReason: ({ context, event }) =>
        event.type === 'LAUNCH_FAILURE_REPORTED'
          ? event.failure.message
          : 'reason' in event
            ? event.reason
            : context.failureReason,
    }),
    clearRetryableLaunch: assign({ retryableLaunch: null, failureReason: null }),
    storeActiveRun: assign({
      activeRunAgentSessionId: ({ context, event }) =>
        event.type === 'RUN_STARTED'
          ? event.agentSessionId
          : event.type === 'OPERATION_FOUND' &&
              event.operation === 'RUN_START' &&
              event.agentSessionId !== undefined
            ? event.agentSessionId
            : context.activeRunAgentSessionId,
      failureReason: null,
    }),
    storePendingIntervention: assign({
      pendingIntervention: ({ context, event }) =>
        event.type === 'EXACT_ACTION_REQUIRED'
          ? pendingInterventionFromRequest(event)
          : context.pendingIntervention,
    }),
    queueExactActionIntervention: assign({
      queuedInterventions: ({ context, event }) =>
        event.type === 'EXACT_ACTION_REQUIRED'
          ? [
              ...queuedInterventions(context),
              {
                interventionId: event.interventionId,
                providerActionId: event.providerActionId,
                providerSessionId: event.providerSessionId,
                runId: event.runId,
                agentSessionId: event.agentSessionId,
                action: event.action,
                target: event.target,
                fingerprint: event.fingerprint,
                createdAt: event.createdAt,
                expiresAt: event.expiresAt,
                userRequired: event.userRequired === true,
                ...(event.userRequired
                  ? {
                      owner: 'HUMAN' as const,
                      escalationReason: protectedRequestReason,
                      escalatedAt: event.createdAt,
                    }
                  : {}),
                ...(event.requestKind ? { requestKind: event.requestKind } : {}),
              },
            ]
          : queuedInterventions(context),
    }),
    promoteQueuedIntervention: assign(({ context }) => {
      const [next, ...rest] = queuedInterventions(context);
      return next === undefined
        ? {}
        : { pendingIntervention: pendingInterventionFromRequest(next), queuedInterventions: rest };
    }),
    escalateQueuedRequest: assign(escalateQueuedRequest),
    dropQueuedRequest: assign(dropQueuedRequest),
    swapInAnsweredQueuedRequest: assign(swapInAnsweredQueuedRequest),
    storeMonitorInterventionDecision: assign({
      pendingIntervention: ({ context, event }) =>
        event.type === 'MONITOR_PERMISSION_DECIDED' && context.pendingIntervention !== null
          ? {
              ...context.pendingIntervention,
              decision: {
                resolution: event.resolution,
                decidedAt: event.decidedAt,
                human: null,
                monitorRationale: event.rationale,
              },
              applicationFailure: null,
            }
          : context.pendingIntervention,
    }),
    storeInterventionEscalation: assign({
      pendingIntervention: ({ context, event }) =>
        event.type === 'MONITOR_PERMISSION_ESCALATED' && context.pendingIntervention !== null
          ? {
              ...context.pendingIntervention,
              owner: 'HUMAN',
              escalationReason: event.reason,
              escalatedAt: event.escalatedAt ?? null,
            }
          : context.pendingIntervention,
    }),
    stampStopEscalationTime: assign({
      pendingIntervention: ({ context, event }) =>
        event.type === 'TASK_MONITOR_STOP_SUCCEEDED' &&
        context.pendingIntervention?.owner === 'HUMAN' &&
        context.pendingIntervention.escalatedAt === null
          ? { ...context.pendingIntervention, escalatedAt: event.stoppedAt ?? null }
          : context.pendingIntervention,
      queuedInterventions: ({ context, event }) =>
        event.type === 'TASK_MONITOR_STOP_SUCCEEDED'
          ? queuedInterventions(context).map((request) =>
              request.owner === 'HUMAN' && request.escalatedAt === null
                ? { ...request, escalatedAt: event.stoppedAt ?? null }
                : request,
            )
          : queuedInterventions(context),
    }),
    handRequestsToHumanOnStop: assign({
      pendingIntervention: ({ context }) =>
        context.pendingIntervention === null ||
        context.pendingIntervention.decision !== null ||
        context.pendingIntervention.owner === 'HUMAN' ||
        context.pendingIntervention.requestKind === 'SERVICE_SCOPE'
          ? context.pendingIntervention
          : {
              ...context.pendingIntervention,
              owner: 'HUMAN',
              escalationReason: STOP_ESCALATION_REASON,
              escalatedAt: null,
            },
      queuedInterventions: ({ context }) => handQueuedRequestsToHumanOnStop(context),
    }),
    storeInterventionDecision: assign({
      pendingIntervention: ({ context, event }) =>
        event.type === 'HUMAN_DECISION' && context.pendingIntervention !== null
          ? {
              ...context.pendingIntervention,
              decision: {
                resolution: event.resolution,
                decidedAt: event.decidedAt,
                human: event.human,
                monitorRationale: null,
              },
              applicationFailure: null,
            }
          : context.pendingIntervention,
    }),
    clearPendingIntervention: assign({ pendingIntervention: null }),
    retireUndeliveredIntervention: assign(retireUndeliveredIntervention),
    storeInterventionApplicationFailure: assign({
      pendingIntervention: ({ context, event }) =>
        context.pendingIntervention !== null && 'reason' in event
          ? { ...context.pendingIntervention, applicationFailure: event.reason }
          : context.pendingIntervention,
    }),
    storeSettledRun: assign({
      coordinatorRecovery: null,
      pendingJudgment: null,
      settledRun: ({ context, event }) =>
        event.type === 'RUN_SETTLED'
          ? {
              runId: event.runId,
              agentSessionId: event.agentSessionId,
              settledAt: event.settledAt,
              outcome: event.outcome,
              turnId: event.turnId,
              promptType: event.promptType,
              terminalOutcome: event.terminalOutcome,
              completedAssistantMessageId: event.completedAssistantMessageId,
              reports: event.reports,
              reviewRequestId: context.reviewRequest?.requestId ?? null,
            }
          : context.settledRun,
    }),
    storeReviewRequest: assign({
      reviewRequest: ({ context, event }) =>
        event.type === 'REVIEW_REQUEST_COMMITTED'
          ? {
              requestId: event.requestId,
              coordinatorRunId: event.coordinatorRunId,
              agentSessionId: event.agentSessionId,
              rationale: event.rationale,
              failureContext: null,
            }
          : context.reviewRequest,
      failureReason: null,
    }),
    storeReviewRequestFailure: assign({
      reviewRequest: ({ context, event }) =>
        event.type === 'REVIEW_REQUEST_FAILED' && context.reviewRequest !== null
          ? { ...context.reviewRequest, failureContext: event.reason }
          : context.reviewRequest,
      failureReason: ({ context, event }) =>
        event.type === 'REVIEW_REQUEST_FAILED' ? event.reason : context.failureReason,
    }),
    storeReviewRequestAccepted: assign({ failureReason: null }),
    clearReviewRequest: assign({ reviewRequest: null }),
    storeContinuedSupervision: assign({
      coordinatorRecovery: null,
      agentSessionId: ({ context, event }) =>
        event.type === 'SUPERVISION_CONTINUES_OBSERVING' && event.nextAgentSessionId
          ? event.nextAgentSessionId
          : context.agentSessionId,
      activeRunAgentSessionId: ({ context, event }) =>
        event.type === 'SUPERVISION_CONTINUES_OBSERVING' && event.nextAgentSessionId
          ? event.nextAgentSessionId
          : context.activeRunAgentSessionId,
      conversationId: ({ context, event }) =>
        event.type === 'SUPERVISION_CONTINUES_OBSERVING' && event.nextConversationId
          ? event.nextConversationId
          : context.conversationId,
      settledRun: null,
      reviewRequest: null,
      failureReason: null,
      pendingJudgment: null,
      coordinationCause: null,
      coordinationCorrelationId: null,
    }),
    prepareContinuedCoordination: assign({
      coordinatorRecovery: null,
      selectedTaskId: null,
      launch: null,
      agentSessionId: null,
      activeRunAgentSessionId: null,
      conversationId: null,
      retryableLaunch: null,
      settledRun: null,
      reviewRequest: null,
      failureReason: null,
      pendingJudgment: null,
      coordinationCause: null,
      coordinationCorrelationId: null,
    }),
    storeGuidance: assign({
      userGuidance: ({ context, event }) =>
        event.type === 'GUIDANCE_CHANGED' ? event.guidance : context.userGuidance,
    }),
    /** A valid request supersedes any open coordinator recovery; its own message is the one answered. */
    storePendingJudgment: assign({
      pendingJudgment: ({ context, event }) =>
        event.type === 'OUTCOME_JUDGMENT_REQUIRED'
          ? { request: event.reason, requestMessageId: event.requestMessageId ?? null }
          : (context.pendingJudgment ?? null),
      coordinatorRecovery: null,
      failureReason: null,
    }),
    storeFailure: assign({
      failureReason: ({ context, event }) =>
        'reason' in event ? event.reason : context.failureReason,
    }),
  },
}).createMachine({
  id: 'task-monitor',
  context: ({ input }) => ({
    taskMonitorId: input.instanceId,
    organizationId: null,
    projectId: null,
    kindKey: null,
    authorityCommandId: null,
    requestedLaunchConfig: null,
    executionPlan: [],
    cursor: null,
    selectedTaskId: null,
    userGuidance: null,
    worktree: null,
    terminalPolicy: null,
    launch: null,
    agentSessionId: null,
    activeRunAgentSessionId: null,
    conversationId: null,
    retryableLaunch: null,
    coordinatorConversationId: null,
    pendingIntervention: null,
    settledRun: null,
    reviewRequest: null,
    input: { queuedMessageIds: [], active: null },
    failureReason: null,
  }),
  initial: 'ABSENT',
  on: {
    LAUNCH_RECOVERY_PROJECTED: { guard: 'matchesTaskMonitor' },
    LAUNCH_RECOVERY_PROJECTION_FAILED: {
      guard: 'matchesTaskMonitor',
      actions: 'storeFailure',
    },
    PERMISSION_DECISION_RECORDED: { guard: 'matchesTaskMonitor' },
    PERMISSION_DEADLINE_ARMED: { guard: 'matchesTaskMonitor' },
    // First answer wins: a ruling or due time for a request that is already answered, handed to a
    // person or gone changes nothing. Accepting it keeps it from blocking the effects behind it.
    MONITOR_PERMISSION_DECIDED: { guard: 'matchesTaskMonitor' },
    MONITOR_PERMISSION_ESCALATED: { guard: 'matchesTaskMonitor' },
    PERMISSION_DECISION_RECORD_FAILED: {
      guard: 'matchesTaskMonitor',
      actions: 'storeFailure',
    },
    TASK_MONITOR_CONTROL_STATUS_PROJECTED: { guard: 'matchesTaskMonitor' },
    TASK_MONITOR_CONTROL_STATUS_PROJECTION_FAILED: {
      guard: 'matchesTaskMonitor',
      actions: 'storeFailure',
    },
    TASK_MONITOR_CONTROL_STATUS_PROJECTION_CANCELLED: {
      guard: 'matchesTaskMonitor',
      actions: 'storeFailure',
    },
    TASK_MONITOR_CONTROL_STATUS_PROJECTION_UNCERTAIN: {
      guard: 'matchesTaskMonitor',
      actions: 'storeFailure',
    },
  },
  states: {
    ABSENT: {
      on: {
        START: {
          guard: 'matchesTaskMonitor',
          target: 'RUNNING',
          actions: [
            assign({
              organizationId: ({ event }) => event.organizationId,
              projectId: ({ event }) => event.projectId,
              authorityCommandId: ({ event }) => event.commandId,
              requestedLaunchConfig: ({ event }) => event.launchConfig,
              userGuidance: ({ event }) => normalizeUserGuidance(event.userMessage),
            }),
            { type: 'loadTaskMonitor', params: ({ event }) => loadTaskMonitorEffect(event) },
          ],
        },
      },
    },
    RUNNING: {
      type: 'parallel',
      on: {
        GUIDANCE_CHANGED: {
          guard: 'matchesTaskMonitor',
          actions: 'storeGuidance',
        },
        STOP: [
          {
            guard: and(['matchesTaskMonitor', 'hasMonitorHeldProviderRequest']),
            target: 'HALTED',
            actions: [
              {
                type: 'haltTaskMonitorControl',
                params: haltControlParameters,
              },
              { type: 'projectTaskMonitorIntervention', params: stopProjectionParameters },
              'handRequestsToHumanOnStop',
            ],
          },
          {
            guard: 'matchesTaskMonitor',
            target: 'HALTED',
            actions: {
              type: 'haltTaskMonitorControl',
              params: haltControlParameters,
            },
          },
        ],
      },
      states: {
        control: {
          initial: 'ACTIVE',
          states: {
            ACTIVE: {
              on: {
                LAUNCH_FAILURE_REPORTED: {
                  guard: 'matchesLaunchFailure',
                  target: 'PAUSING',
                  actions: {
                    type: 'projectTaskMonitorControlStatus',
                    params: pausedStatusProjectionParameters,
                  },
                },
                PAUSE: {
                  guard: 'matchesTaskMonitor',
                  target: 'PAUSING',
                  actions: {
                    type: 'projectTaskMonitorControlStatus',
                    params: pausedStatusProjectionParameters,
                  },
                },
              },
            },
            PAUSING: {
              on: {
                TASK_MONITOR_CONTROL_STATUS_PROJECTED: {
                  guard: ({ context, event }) =>
                    event.taskMonitorId === context.taskMonitorId &&
                    event.status === WorkStatus.OnHold,
                  target: 'PAUSED',
                },
                PAUSE: {
                  guard: 'matchesTaskMonitor',
                  actions: {
                    type: 'projectTaskMonitorControlStatus',
                    params: pausedStatusProjectionParameters,
                  },
                },
                RESUME: {
                  guard: 'matchesTaskMonitor',
                  target: 'RESUMING',
                  actions: [
                    'admitResumeCoordination',
                    {
                      type: 'projectTaskMonitorControlStatus',
                      params: activeStatusProjectionParameters,
                    },
                  ],
                },
              },
            },
            PAUSED: {
              on: {
                START: {
                  guard: 'matchesTaskMonitor',
                  target: 'RESUMING',
                  actions: [
                    'clearCoordinationAdmission',
                    {
                      type: 'projectTaskMonitorControlStatus',
                      params: activeStatusProjectionParameters,
                    },
                  ],
                },
                CONTINUE: {
                  guard: 'matchesTaskMonitor',
                  target: 'RESUMING',
                  actions: [
                    'clearCoordinationAdmission',
                    {
                      type: 'projectTaskMonitorControlStatus',
                      params: activeStatusProjectionParameters,
                    },
                  ],
                },
                RESUME: {
                  guard: 'matchesTaskMonitor',
                  target: 'RESUMING',
                  actions: [
                    'admitResumeCoordination',
                    {
                      type: 'projectTaskMonitorControlStatus',
                      params: activeStatusProjectionParameters,
                    },
                  ],
                },
              },
            },
            RESUMING: {
              on: {
                LAUNCH_FAILURE_REPORTED: {
                  guard: 'matchesLaunchFailure',
                  target: 'PAUSING',
                  actions: {
                    type: 'projectTaskMonitorControlStatus',
                    params: pausedStatusProjectionParameters,
                  },
                },
                TASK_MONITOR_CONTROL_STATUS_PROJECTED: [
                  {
                    guard: 'resumeNeedsCoordination',
                    target: '#task-monitor.RUNNING.work.COORDINATING',
                    actions: [
                      {
                        type: 'coordinateTaskMonitorWork',
                        params: resumeCoordinationParameters,
                      },
                    ],
                  },
                  {
                    guard: ({ context, event }) =>
                      event.taskMonitorId === context.taskMonitorId &&
                      event.status === WorkStatus.OnHold,
                    target: 'PAUSED',
                  },
                  {
                    guard: ({ context, event }) =>
                      event.taskMonitorId === context.taskMonitorId &&
                      event.status === WorkStatus.Active,
                    target: 'ACTIVE',
                  },
                ],
                RESUME: {
                  guard: 'matchesTaskMonitor',
                  actions: [
                    'admitResumeCoordination',
                    {
                      type: 'projectTaskMonitorControlStatus',
                      params: activeStatusProjectionParameters,
                    },
                  ],
                },
                PAUSE: {
                  guard: 'matchesTaskMonitor',
                  target: 'PAUSED',
                  actions: [
                    'clearCoordinationAdmission',
                    {
                      type: 'projectTaskMonitorControlStatus',
                      params: pausedStatusProjectionParameters,
                    },
                  ],
                },
              },
            },
          },
        },
        work: taskMonitorWorkStates,
        intervention: taskMonitorInterventionStates,
        input: {
          initial: 'WAITING_FOR_INPUT',
          states: {
            WAITING_FOR_INPUT: {
              always: {
                guard: ({ context }) => context.input.queuedMessageIds.length > 0,
                target: 'READING_INPUT',
                actions: [
                  {
                    type: 'deliverTaskMonitorConversationMessage',
                    params: queuedConversationMessageParameters,
                  },
                  'claimQueuedConversationMessage',
                ],
              },
              on: {
                CONVERSATION_MESSAGE_RECEIVED: {
                  guard: 'matchesTaskMonitor',
                  target: 'READING_INPUT',
                  actions: [
                    {
                      type: 'deliverTaskMonitorConversationMessage',
                      params: receivedConversationMessageParameters,
                    },
                    'claimReceivedConversationMessage',
                    'storeCoordinatorConversation',
                  ],
                },
              },
            },
            READING_INPUT: {
              on: {
                CONVERSATION_MESSAGE_RECEIVED: {
                  guard: 'matchesTaskMonitor',
                  actions: 'appendConversationMessage',
                },
                CONVERSATION_TURN_STARTED: {
                  guard: ({ context, event }) =>
                    event.taskMonitorId === context.taskMonitorId &&
                    event.messageId === context.input.active?.messageId,
                  target: 'RESPONDING_INPUT',
                  actions: [
                    'storeConversationTurn',
                    {
                      type: 'reconcileTaskMonitorConversationResponse',
                      params: ({ context, event }) => {
                        if (event.type !== 'CONVERSATION_TURN_STARTED') {
                          throw new Error('Expected CONVERSATION_TURN_STARTED.');
                        }
                        return reconcileTaskMonitorConversationResponseEffect({
                          ...context,
                          input: storeConversationTurn(context, event),
                        });
                      },
                    },
                  ],
                },
                CONVERSATION_DELIVERY_FAILED: {
                  guard: 'matchesTaskMonitor',
                  target: 'WAITING_FOR_INPUT',
                  actions: 'settleConversationMessage',
                },
              },
            },
            RESPONDING_INPUT: {
              on: {
                CONVERSATION_MESSAGE_RECEIVED: {
                  guard: 'matchesTaskMonitor',
                  actions: 'appendConversationMessage',
                },
                CONVERSATION_RESPONSE_PERSISTED: {
                  guard: ({ context, event }) =>
                    event.taskMonitorId === context.taskMonitorId &&
                    event.messageId === context.input.active?.messageId,
                  target: 'WAITING_FOR_INPUT',
                  actions: 'settleConversationMessage',
                },
                CONVERSATION_DELIVERY_FAILED: {
                  guard: 'matchesTaskMonitor',
                  target: 'WAITING_FOR_INPUT',
                  actions: 'settleConversationMessage',
                },
              },
            },
          },
        },
      },
    },
    HALTED: {
      on: {
        ...taskMonitorHaltedInterventionEvents,
        TASK_MONITOR_STOP_SUCCEEDED: {
          guard: 'matchesTaskMonitor',
          actions: 'stampStopEscalationTime',
        },
        TASK_MONITOR_STOP_FAILED: {
          guard: 'matchesTaskMonitor',
          actions: 'storeFailure',
        },
        TASK_MONITOR_STOP_CANCELLED: {
          guard: 'matchesTaskMonitor',
          actions: 'storeFailure',
        },
        TASK_MONITOR_STOP_UNCERTAIN: {
          guard: 'matchesTaskMonitor',
          actions: 'storeFailure',
        },
      },
    },
    COMPLETED: {},
  },
});

export type TaskMonitorMachineState = MachineLogicState<typeof taskMonitorMachine>;
export type TaskMonitorMachineLogic = typeof taskMonitorMachine;
type _TaskMonitorStateSchemaMatches = Expect<
  Equal<
    ContractShape<z.output<typeof taskMonitorStateSchema>>,
    ContractShape<TaskMonitorMachineState>
  >
>;

export type TaskMonitorDefinition = MachineDefinition<
  string,
  TaskMonitorMachineState,
  TaskMonitorMachineEvent,
  TaskMonitorMachineContext,
  typeof taskMonitorMachine,
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome,
  VerifiedTaskMonitorInput
>;

export type TaskMonitorStateStore = MachineStateStore<
  string,
  TaskMonitorMachineState,
  TaskMonitorMachineContext,
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome
>;

export type TaskMonitorMachineRuntime = MachineRuntime<
  string,
  TaskMonitorMachineState,
  TaskMonitorMachineEvent,
  TaskMonitorMachineContext,
  typeof taskMonitorMachine,
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome,
  VerifiedTaskMonitorInput
>;

export type TaskMonitorMachineRegistry = MachineRegistry<
  string,
  TaskMonitorMachineState,
  TaskMonitorMachineEvent,
  TaskMonitorMachineContext,
  typeof taskMonitorMachine,
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome,
  VerifiedTaskMonitorInput
>;

/** Status of the latest settled supervision effect that carried this judgment reason. */
const settledJudgmentStatus = (
  effects: PersistedTaskMonitorValue,
  reason: string,
): string | null => {
  if (!Array.isArray(effects)) return null;
  for (const committed of [...effects].reverse()) {
    if (!isPersistedObject(committed)) continue;
    const execution = committed['execution'];
    if (!isPersistedObject(execution) || execution['status'] !== 'settled') continue;
    const settlement = execution['settlement'];
    if (!isPersistedObject(settlement)) continue;
    const outcome = settlement['outcome'];
    if (
      isPersistedObject(outcome) &&
      outcome['type'] === 'OUTCOME_JUDGMENT_REQUIRED' &&
      outcome['reason'] === reason
    ) {
      const status = settlement['status'];
      return typeof status === 'string' ? status : null;
    }
  }
  return null;
};

/**
 * Before pending judgment had its own state, a posted coordinator request and an
 * operational supervision failure shared one outcome and one parked state, with the
 * text in failureReason. The settlement that carried the outcome tells them apart: a
 * request is a succeeded settlement, a failure is a failed, cancelled or uncertain
 * one.
 */
const isLegacyFailureSettlement = (status: unknown): boolean =>
  typeof status === 'string' && status !== 'succeeded';

/**
 * Rewrites every stored settlement that was a failure into the typed failure
 * outcome, whether or not its outcome was admitted before the upgrade. A settled
 * effect whose outcome was never admitted is replayed on restart, and the receiving
 * transition treats OUTCOME_JUDGMENT_REQUIRED as a request that was posted.
 */
const migrateLegacyJudgmentSettlements = (effects: PersistedTaskMonitorValue) => {
  if (!Array.isArray(effects)) return effects;

  return effects.map((committed) => {
    if (!isPersistedObject(committed)) return committed;
    const execution = committed['execution'];
    if (!isPersistedObject(execution) || execution['status'] !== 'settled') return committed;
    const settlement = execution['settlement'];
    if (!isPersistedObject(settlement)) return committed;
    const outcome = settlement['outcome'];
    if (
      !isPersistedObject(outcome) ||
      outcome['type'] !== 'OUTCOME_JUDGMENT_REQUIRED' ||
      !isLegacyFailureSettlement(settlement['status'])
    ) {
      return committed;
    }

    return {
      ...committed,
      execution: {
        ...execution,
        settlement: { ...settlement, outcome: { ...outcome, type: 'SUPERVISION_FAILED' } },
      },
    };
  });
};

/**
 * Classifies a snapshot already parked in OUTCOME_JUDGMENT from the settlement that
 * entered it. With no matching settlement the snapshot stays a failure, which never
 * promotes an unproven cause into a request; an answer to any request already posted
 * is still admitted because the work state is unchanged.
 */
const migrateLegacyJudgmentSnapshot = (
  value: Record<string, PersistedTaskMonitorValue>,
): Record<string, PersistedTaskMonitorValue> => {
  const { state, context, effects } = value;
  const running = isPersistedObject(state) ? state['RUNNING'] : undefined;
  if (
    !isPersistedObject(state) ||
    !isPersistedObject(running) ||
    running['work'] !== 'OUTCOME_JUDGMENT' ||
    !isPersistedObject(context)
  ) {
    return value;
  }
  const reason = context['failureReason'];
  if (
    typeof reason !== 'string' ||
    context['coordinatorRecovery'] != null ||
    context['pendingJudgment'] != null
  ) {
    return value;
  }
  const status = effects === undefined ? null : settledJudgmentStatus(effects, reason);
  if (status === null) return value;
  if (!isLegacyFailureSettlement(status)) {
    return {
      ...value,
      context: {
        ...context,
        failureReason: null,
        pendingJudgment: { request: reason, requestMessageId: null },
      },
    };
  }

  return { ...value, state: { ...state, RUNNING: { ...running, work: 'SUPERVISION_FAILED' } } };
};

const migrateLegacyJudgmentState = (
  value: PersistedTaskMonitorValue,
): PersistedTaskMonitorValue => {
  if (!isPersistedObject(value)) return value;
  // Classify the snapshot first: it reads the settlements the rewrite then retypes.
  const snapshot = migrateLegacyJudgmentSnapshot(value);
  const effects = snapshot['effects'];

  return effects === undefined
    ? snapshot
    : { ...snapshot, effects: migrateLegacyJudgmentSettlements(effects) };
};

const taskMonitorPayloadCompatibility = {
  currentSchemaVersion: 3,
  // Schema 2 snapshots parked as failures may be corrected into pending judgments.
  revisionAdvancingMigrations: new Set([2]),
  migrations: new Map([
    [
      1,
      (payload: PersistedTaskMonitorValue): PersistedTaskMonitorValue =>
        migrateLegacyPlanGuidanceStepRationale(payload),
    ],
    [
      2,
      (payload: PersistedTaskMonitorValue): PersistedTaskMonitorValue =>
        migrateLegacyJudgmentState(payload),
    ],
  ]),
} as const;

export const createTaskMonitorDefinition = (): TaskMonitorDefinition =>
  defineMachine<
    string,
    TaskMonitorMachineState,
    TaskMonitorMachineEvent,
    TaskMonitorMachineContext,
    typeof taskMonitorMachine,
    TaskMonitorMachineEffect,
    TaskMonitorMachineEffectOutcome,
    VerifiedTaskMonitorInput
  >({
    machineType: TASK_MONITOR_MACHINE_TYPE,
    payloadCompatibility: taskMonitorPayloadCompatibility,
    machine: taskMonitorMachine,
    createInitialInput: (identity) => identity,
    readSnapshot: (snapshot) => ({ state: snapshot.value, context: snapshot.context }),
    toXStateEvent: (event) => event,
    admitVerifiedInput: (input) => {
      if ('source' in input) {
        if (input.taskMonitorId !== input.identity.instanceId) {
          return {
            status: 'rejected',
            reason: 'Verified Task Monitor input does not match its addressed owner.',
          };
        }
        return {
          status: 'admitted',
          identity: input.identity,
          ingressId: input.ingressId,
          event: taskMonitorEventFromVerifiedInput(input),
        };
      }
      const event = taskMonitorEventFromVerifiedCommand(input);
      if (event === null) {
        return {
          status: 'rejected',
          reason: `Task Monitor command ${input.command.cause} is not admitted by this definition.`,
        };
      }
      const identity = {
        machineType: TASK_MONITOR_MACHINE_TYPE,
        instanceId: input.target.workItemId,
      } as const;
      return {
        status: 'admitted',
        identity,
        ingressId: input.commandId,
        event,
      };
    },
    effectFromAction: (action) => {
      switch (action.type) {
        case 'projectTaskMonitorOutcomeJudgment':
        case 'loadTaskMonitor':
        case 'coordinateTaskMonitorWork':
        case 'validateTaskMonitorLaunch':
        case 'reconcileTaskMonitorLaunch':
        case 'createTaskMonitorAgentSession':
        case 'createTaskMonitorConversation':
        case 'startTaskMonitorRun':
        case 'persistTaskMonitorLaunch':
        case 'projectTaskMonitorStarted':
        case 'projectTaskMonitorLaunchRecovery':
        case 'projectTaskMonitorControlStatus':
        case 'haltTaskMonitorControl':
        case 'applyTaskMonitorDecision':
        case 'projectTaskMonitorIntervention':
        case 'decideTaskMonitorPermission':
        case 'watchTaskMonitorPermissionDeadline':
        case 'recordTaskMonitorPermissionDecision':
        case 'evaluateTaskMonitorSettledRun':
        case 'deliverTaskMonitorReview':
        case 'deliverTaskMonitorConversationMessage':
        case 'reconcileTaskMonitorConversationResponse':
          return taskMonitorEffectSchema.parse(action.params);
        default:
          return null;
      }
    },
    outcomeToEvent: ({ outcome }) => outcome,
  });

export const taskMonitorStateStoreCodec: MachineStateStoreCodec<
  string,
  TaskMonitorMachineState,
  TaskMonitorMachineContext,
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome
> = {
  decodeMachineType: (value) => z.literal(TASK_MONITOR_MACHINE_TYPE).parse(value),
  decodeState: (value) => taskMonitorStateSchema.parse(value),
  decodeContext: (value) => taskMonitorContextSchema.parse(normalizeLegacyReviewPolicy(value)),
  decodeEffect: (value) => taskMonitorEffectSchema.parse(normalizeLegacyReviewPolicy(value)),
  decodeOutcome: (value) =>
    taskMonitorEffectOutcomeSchema.parse(normalizeLegacyReviewPolicy(value)),
  isCompletedState: (value) => value === 'COMPLETED',
  payloadCompatibility: (machineType) => {
    z.literal(TASK_MONITOR_MACHINE_TYPE).parse(machineType);
    return taskMonitorPayloadCompatibility;
  },
};
