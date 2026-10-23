import { z } from 'zod';
import {
  MonitorAuthorityNeutralBodyV2KindEnum,
  MonitorAuthorityNeutralBodyV2VersionEnum,
  MonitorCommandBodyV2KindEnum,
  MonitorCommandBodyV2VersionEnum,
  TaskMonitorCommandTargetWorkItemTypeEnum,
  TaskMonitorCompleteCommandCauseEnum,
  TaskMonitorContinueCommandCauseEnum,
  TaskMonitorGuidanceChangedCommandCauseEnum,
  TaskMonitorHumanDecisionCommandCauseEnum,
  TaskMonitorHumanDecisionCommandResolutionEnum,
  TaskMonitorJudgmentResolvedCommand1CauseEnum,
  TaskMonitorLaunchMethod,
  TaskMonitorLaunchProvider,
  TaskMonitorReasoningEffort,
  TaskMonitorResumeCommandCauseEnum,
  TaskMonitorStartCommand1CauseEnum,
} from '../../shared/agent-bridge-contract/generated/api';
import type {
  AgentTrigger,
  CliReadEnvelopeBody,
  ControllerAuthorizedSignedCliReadEnvelope,
  ControllerAuthorizedSignedConversationControlEnvelope,
  ControllerAuthorizedSignedMonitorCommandEnvelope,
  ConversationAuthorityIncreasingControlBody,
  ConversationControlPermissionDecision,
  ConversationControlQuestionAnswer,
  MonitorAuthorityNeutralBodyV2,
  MonitorCommandBody1 as MonitorCommandBody,
  MonitorCommandBodyV2,
  SignedMonitorAuthorityNeutralEnvelope,
  SignedConversationControlEnvelope,
  SignedConversationTriggerEnvelope,
  SignedMonitorCommandEnvelope,
  StartRunWorktree,
  TaskMonitorCommandTarget,
  TaskMonitorCompleteCommand,
  TaskMonitorContinueCommand,
  TaskMonitorGuidanceChangedCommand,
  TaskMonitorHumanDecisionCommand,
  TaskMonitorHumanDecisionEvidence,
  TaskMonitorJudgmentResolvedCommand1,
  TaskMonitorJudgmentResponse,
  TaskMonitorLaunchConfig,
  TaskMonitorResumeCommand,
  TaskMonitorStartCommand1,
  AgentTriggerStartRun,
  AgentTriggerUserMessage,
  UserMessageAdmittedServiceScope,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  AgentTriggerStartRunPromptTypeEnum,
  AgentTriggerUserMessagePromptTypeEnum,
  type SignedAuthorityReductionEnvelope,
} from '../../shared/api/generated/api';
import type { ExecutableEnvelopeAuthorization } from '../controller-authorization/types';
import {
  CURRENT_AGENT_OPERATIONS,
  hasExactCurrentAgentOperations,
} from '../controller-authorization/types';

const uuid = z.string().uuid();
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);

type OpenApiZodShape<T> = {
  [K in keyof T]-?: z.ZodType<T[K]>;
};

const actionCategories = [
  'CONVERSATION',
  'PLATFORM_EVENT',
  'AUTHORITY_INCREASING_CONTROL',
  'TASK_MONITOR',
  'CLI_READ',
  'APPLICATION_EFFECT',
  'EXACT_ACTION',
] as const;

const actionTypes = CURRENT_AGENT_OPERATIONS;

const targetKinds = [
  'CLI_READ',
  'CONVERSATION',
  'AGENT_SESSION',
  'TASK_MONITOR',
  'PLATFORM_EVENT',
  'APPLICATION_EFFECT',
  'EXACT_ACTION',
] as const;

const controllerAuthorizationCadences = [
  'FIVE_MINUTES',
  'EIGHT_HOURS',
  'ONE_DAY',
  'ONE_WEEK',
  'ONE_MONTH',
] as const;
const controllerAuthorizationCadenceTtlMs = {
  FIVE_MINUTES: 5 * 60 * 1000,
  EIGHT_HOURS: 8 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
  ONE_MONTH: 30 * 24 * 60 * 60 * 1000,
} as const satisfies Record<(typeof controllerAuthorizationCadences)[number], number>;

const allowedActionCategoriesSchema = z
  .array(z.enum(actionCategories))
  .min(1)
  .max(7)
  .refine((categories) => new Set(categories).size === categories.length, {
    message: 'Allowed action categories must be unique.',
  });

const currentAgentOperationsSchema = z
  .array(z.enum(actionTypes))
  .length(CURRENT_AGENT_OPERATIONS.length)
  .refine(hasExactCurrentAgentOperations, {
    message: 'Allowed action types must contain the complete current-operation bundle.',
  });

const targetSchema = z
  .object({
    kind: z.enum(targetKinds),
    id: uuid,
    revision: z.number().int().nonnegative().nullable(),
  })
  .strict();

const taskMonitorWorktreeV2Shape = {
  enabled: z.boolean(),
  branch: z.string().min(1).optional(),
} satisfies Record<keyof StartRunWorktree, z.ZodTypeAny>;

const taskMonitorLaunchConfigV2Shape = {
  taskId: uuid,
  method: z.nativeEnum(TaskMonitorLaunchMethod),
  provider: z.nativeEnum(TaskMonitorLaunchProvider),
  model: z.string().min(1),
  reasoningEffort: z.nativeEnum(TaskMonitorReasoningEffort),
  fastMode: z.boolean().optional(),
  worktree: z.object(taskMonitorWorktreeV2Shape).strict().optional(),
} satisfies Record<keyof TaskMonitorLaunchConfig, z.ZodTypeAny>;

const taskMonitorLaunchConfigV2Schema = z.object(taskMonitorLaunchConfigV2Shape).strict();

const taskMonitorCommandTargetV2Shape = {
  workItemType: z.literal(TaskMonitorCommandTargetWorkItemTypeEnum.TaskMonitor),
  workItemId: uuid,
} satisfies Record<keyof TaskMonitorCommandTarget, z.ZodTypeAny>;

const taskMonitorCommandTargetV2Schema = z.object(taskMonitorCommandTargetV2Shape).strict();

const taskMonitorJudgmentResponseV2Shape = {
  requestMessageId: uuid,
  label: z.string().min(1).max(240),
  conclusion: z.string().min(1).max(500),
} satisfies Record<keyof TaskMonitorJudgmentResponse, z.ZodTypeAny>;

const taskMonitorJudgmentResponseV2Schema = z.object(taskMonitorJudgmentResponseV2Shape).strict();

const taskMonitorStartCommandV2Shape = {
  cause: z.literal(TaskMonitorStartCommand1CauseEnum.Start),
  launchConfig: taskMonitorLaunchConfigV2Schema,
  userMessage: z.string().max(5000).optional(),
} satisfies Record<keyof TaskMonitorStartCommand1, z.ZodTypeAny>;

const taskMonitorResumeCommandV2Shape = {
  cause: z.literal(TaskMonitorResumeCommandCauseEnum.Resume),
} satisfies Record<keyof TaskMonitorResumeCommand, z.ZodTypeAny>;

const taskMonitorContinueCommandV2Shape = {
  cause: z.literal(TaskMonitorContinueCommandCauseEnum.Continue),
} satisfies Record<keyof TaskMonitorContinueCommand, z.ZodTypeAny>;

const taskMonitorCompleteCommandV2Shape = {
  cause: z.literal(TaskMonitorCompleteCommandCauseEnum.Complete),
} satisfies Record<keyof TaskMonitorCompleteCommand, z.ZodTypeAny>;

const taskMonitorJudgmentResolvedCommandV2Shape = {
  cause: z.literal(TaskMonitorJudgmentResolvedCommand1CauseEnum.JudgmentResolved),
  judgment: taskMonitorJudgmentResponseV2Schema,
} satisfies Record<keyof TaskMonitorJudgmentResolvedCommand1, z.ZodTypeAny>;

const taskMonitorAuthorityIncreasingCommandV2Schema = z.discriminatedUnion('cause', [
  z.object(taskMonitorStartCommandV2Shape).strict(),
  z.object(taskMonitorResumeCommandV2Shape).strict(),
  z.object(taskMonitorContinueCommandV2Shape).strict(),
  z.object(taskMonitorCompleteCommandV2Shape).strict(),
  z.object(taskMonitorJudgmentResolvedCommandV2Shape).strict(),
]);

const taskMonitorGuidanceChangedCommandV2Shape = {
  cause: z.literal(TaskMonitorGuidanceChangedCommandCauseEnum.GuidanceChanged),
  guidance: z.string().min(1).max(5000),
} satisfies Record<keyof TaskMonitorGuidanceChangedCommand, z.ZodTypeAny>;

const taskMonitorHumanDecisionEvidenceV2Shape = {
  userId: uuid,
  authenticatedAt: z.string().datetime(),
} satisfies Record<keyof TaskMonitorHumanDecisionEvidence, z.ZodTypeAny>;

const taskMonitorHumanDecisionCommandV2Shape = {
  cause: z.literal(TaskMonitorHumanDecisionCommandCauseEnum.HumanDecision),
  interventionId: uuid,
  providerActionId: z.string().min(1),
  runId: uuid,
  agentSessionId: uuid,
  fingerprint: z.string().min(1),
  resolution: z.enum([
    TaskMonitorHumanDecisionCommandResolutionEnum.Approve,
    TaskMonitorHumanDecisionCommandResolutionEnum.Deny,
  ]),
  human: z.object(taskMonitorHumanDecisionEvidenceV2Shape).strict(),
} satisfies Record<keyof TaskMonitorHumanDecisionCommand, z.ZodTypeAny>;

const taskMonitorAuthorityNeutralCommandV2Schema = z.discriminatedUnion('cause', [
  z.object(taskMonitorGuidanceChangedCommandV2Shape).strict(),
  z.object(taskMonitorHumanDecisionCommandV2Shape).strict(),
]);

const monitorCommandV2Shape = {
  version: z.literal(MonitorCommandBodyV2VersionEnum.NUMBER_2),
  kind: z.literal(MonitorCommandBodyV2KindEnum.TaskMonitorCommand),
  commandId: uuid,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  organizationId: uuid,
  projectId: uuid,
  target: taskMonitorCommandTargetV2Schema,
  command: taskMonitorAuthorityIncreasingCommandV2Schema,
} satisfies Record<keyof MonitorCommandBodyV2, z.ZodTypeAny>;

const monitorAuthorityNeutralBodyV2Shape = {
  version: z.literal(MonitorAuthorityNeutralBodyV2VersionEnum.NUMBER_2),
  kind: z.literal(MonitorAuthorityNeutralBodyV2KindEnum.TaskMonitorAuthorityNeutral),
  commandId: uuid,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  organizationId: uuid,
  projectId: uuid,
  target: taskMonitorCommandTargetV2Schema,
  command: taskMonitorAuthorityNeutralCommandV2Schema,
} satisfies Record<keyof MonitorAuthorityNeutralBodyV2, z.ZodTypeAny>;

const monitorAuthorityNeutralBodyV2Schema = z.object(monitorAuthorityNeutralBodyV2Shape).strict();

const controllerAuthorizationIntentSchema = z
  .object({
    version: z.literal(2),
    authorizationId: z.string().uuid(),
    controllerCredentialId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    controllerInstallationId: z.string().uuid(),
    machineId: uuid,
    userId: uuid,
    organizationId: uuid,
    projectId: uuid,
    cadence: z.enum(controllerAuthorizationCadences),
    policyRevision: z.number().int().positive(),
    effectiveGrantExpiresAtMs: z.number().int().safe().nonnegative(),
    grantDescriptorHash: sha256Hex,
    actionCategory: z.enum(actionCategories),
    actionType: z.enum(actionTypes),
    actionPayloadHash: sha256Hex,
    allowedActionTypes: currentAgentOperationsSchema,
    allowedActionCategories: allowedActionCategoriesSchema,
    target: targetSchema,
    agentSessionId: uuid.nullable(),
    taskMonitorId: uuid.nullable(),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    issuedAtMs: z.number().int().safe().nonnegative(),
    expiresAtMs: z.number().int().safe().nonnegative(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.expiresAtMs - intent.issuedAtMs !== 120_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAtMs'],
        message: 'Authorization expiry must be exactly two minutes.',
      });
    }
    if (
      intent.effectiveGrantExpiresAtMs - intent.issuedAtMs !==
      controllerAuthorizationCadenceTtlMs[intent.cadence]
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveGrantExpiresAtMs'],
        message: 'Grant expiry must match the selected cadence.',
      });
    }
  });

const controllerAssertionEvidenceSchema = z
  .object({
    kind: z.literal('controller_assertion'),
    intent: controllerAuthorizationIntentSchema,
    credentialId: z.string().min(1),
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
    userHandle: z.string().nullable(),
    grantId: uuid,
    grantDescriptor: z
      .object({
        scope: z.literal('controller_device_window'),
        controllerCredentialId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
        controllerInstallationId: uuid,
        machineId: uuid,
        userId: uuid,
        organizationId: uuid,
        cadence: z.enum(controllerAuthorizationCadences),
        policyRevision: z.number().int().positive(),
        allowedActionTypes: currentAgentOperationsSchema,
        allowedActionCategories: allowedActionCategoriesSchema,
        issuedAtMs: z.number().int().safe().nonnegative(),
        effectiveExpiresAtMs: z.number().int().safe().nonnegative(),
      })
      .strict()
      .superRefine((descriptor, context) => {
        if (
          descriptor.effectiveExpiresAtMs - descriptor.issuedAtMs !==
          controllerAuthorizationCadenceTtlMs[descriptor.cadence]
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['effectiveExpiresAtMs'],
            message: 'Grant expiry must match the selected cadence.',
          });
        }
      }),
  })
  .strict();

const boundedGrantReferenceSchema = z
  .object({
    kind: z.literal('bounded_grant'),
    grantId: z.string().uuid(),
  })
  .strict();

export const executableAuthorizationSchema = z.union([
  controllerAssertionEvidenceSchema,
  boundedGrantReferenceSchema,
]);

const v2EnvelopeFields = {
  machineId: uuid,
  userId: uuid,
  nonce: uuid,
  timestampMs: z.number().int().safe(),
  signature: z.string().min(1),
  protocolVersion: z.literal(2),
  authorization: executableAuthorizationSchema,
};

const reductionEnvelopeFields = {
  machineId: uuid,
  userId: uuid,
  nonce: uuid,
  timestampMs: z.number().int().safe(),
  signature: z.string().min(1),
  protocolVersion: z.literal(2),
};

// Payloads are validated again by the prompt-specific dispatcher. Each
// operation-carrying variant is closed independently and its field map is
// compile-time bound to the corresponding generated OpenAPI interface. A
// contract change therefore fails typecheck instead of becoming a runtime
// `schema` drop.
const userMessageAdmittedServiceScopeV2Shape = {
  serviceIds: z.array(uuid).refine((values) => new Set(values).size === values.length, {
    message: 'Admitted Service ids must be unique.',
  }),
  launchServiceId: uuid.nullable(),
} satisfies OpenApiZodShape<UserMessageAdmittedServiceScope>;

const userMessageAdmittedServiceScopeV2Schema = z
  .object(userMessageAdmittedServiceScopeV2Shape)
  .strict()
  .superRefine((scope, ctx) => {
    if (scope.serviceIds.length === 0 && scope.launchServiceId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['launchServiceId'],
        message: 'Graph-only admitted scope must not carry a launch Service.',
      });
    }
    if (
      scope.serviceIds.length > 0 &&
      (scope.launchServiceId === null || !scope.serviceIds.includes(scope.launchServiceId))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['launchServiceId'],
        message: 'Repository-bound admitted scope must contain its launch Service.',
      });
    }
  });

const startRunAgentTriggerEventV2Shape = {
  sourceUserMessageId: uuid.optional(),
  operationId: uuid,
  operationFingerprint: sha256Hex,
  inputExecution: z
    .object({ operationId: uuid, operationFingerprint: sha256Hex, messageId: uuid })
    .strict()
    .optional(),
  promptType: z.literal(AgentTriggerStartRunPromptTypeEnum.StartRun),
  nodeId: z.string().min(1).optional(),
  triggerMessageId: z.string().min(1),
  admittedServiceScope: userMessageAdmittedServiceScopeV2Schema.optional(),
  payload: z.custom<AgentTriggerStartRun['payload']>(
    (value) => typeof value === 'object' && value !== null,
  ),
} satisfies OpenApiZodShape<AgentTriggerStartRun>;

const startRunAgentTriggerEventV2Schema = z.object(startRunAgentTriggerEventV2Shape).strict();

const userMessageAgentTriggerEventV2Shape = {
  operationId: uuid,
  operationFingerprint: sha256Hex,
  inputExecution: z
    .object({ operationId: uuid, operationFingerprint: sha256Hex, messageId: uuid })
    .strict()
    .optional(),
  promptType: z.literal(AgentTriggerUserMessagePromptTypeEnum.UserMessage),
  nodeId: z.string().min(1).optional(),
  triggerMessageId: z.string().min(1),
  sourceUserMessageId: z.string().min(1),
  admittedServiceScope: userMessageAdmittedServiceScopeV2Schema.optional(),
  payload: z.custom<AgentTriggerUserMessage['payload']>(
    (value) => typeof value === 'object' && value !== null,
  ),
} satisfies OpenApiZodShape<AgentTriggerUserMessage>;

const userMessageAgentTriggerEventV2Schema = z.object(userMessageAgentTriggerEventV2Shape).strict();

const nonOperationAgentTriggerEventV2Schema = z
  .object({
    promptType: z.string().min(1),
    inputExecution: z
      .object({ operationId: uuid, operationFingerprint: sha256Hex, messageId: uuid })
      .strict()
      .optional(),
    nodeId: z.string().min(1).optional(),
    triggerMessageId: z.string().min(1),
    payload: z.unknown().optional(),
  })
  .strict()
  .refine(
    (event) =>
      event.promptType !== AgentTriggerStartRunPromptTypeEnum.StartRun &&
      event.promptType !== AgentTriggerUserMessagePromptTypeEnum.UserMessage,
    { message: 'Operation-carrying triggers must use their generated variant schema.' },
  );

const agentTriggerEventV2Schema = z.union([
  startRunAgentTriggerEventV2Schema,
  userMessageAgentTriggerEventV2Schema,
  nonOperationAgentTriggerEventV2Schema,
]);

const permissionDecisionControlV2Shape = {
  kind: z.literal('permission_decision'),
  agentSessionId: uuid,
  decision: z.enum(['approve', 'always_approve', 'deny', 'whitelist']),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  agentType: z.enum(['claude', 'codex', 'opencode']),
  reason: z.string().nullable().optional(),
  idempotencyToken: z.string().min(1),
} satisfies OpenApiZodShape<ConversationControlPermissionDecision>;

const questionAnswerControlV2Shape = {
  kind: z.literal('question_answer'),
  agentSessionId: uuid,
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  agentType: z.enum(['claude', 'codex', 'opencode']),
  answers: z.record(z.string(), z.string()),
  idempotencyToken: z.string().min(1),
} satisfies OpenApiZodShape<ConversationControlQuestionAnswer>;

const conversationControlV2Schema = z.union([
  z
    .object({
      kind: z.literal('compact_run'),
      agentSessionId: uuid,
      conversationId: uuid,
      runId: uuid,
    })
    .strict(),
  z.object(permissionDecisionControlV2Shape).strict(),
  z.object(questionAnswerControlV2Shape).strict(),
]);

const monitorCommandV2Schema = z.object(monitorCommandV2Shape).strict();

const frameWrapperFields = {
  timestamp: z.string(),
  organizationId: uuid,
  projectId: uuid.optional(),
  conversationId: uuid.optional(),
  userId: uuid.optional(),
};

export const triggerConversationFrameV2Schema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.conversation'),
    envelope: z.object({ ...v2EnvelopeFields, event: agentTriggerEventV2Schema }).strict(),
  })
  .strict();

export const triggerControlFrameV2Schema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.control'),
    envelope: z.object({ ...v2EnvelopeFields, event: conversationControlV2Schema }).strict(),
  })
  .strict();

export const triggerMonitorCommandFrameV2Schema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.monitor_command'),
    projectId: z.string().uuid(),
    envelope: z.object({ ...v2EnvelopeFields, event: monitorCommandV2Schema }).strict(),
  })
  .strict();

type CliReadOperation = CliReadEnvelopeBody['operation'];
type ZodCompatibleInput<T> = {
  [K in keyof T]: {} extends Pick<T, K> ? T[K] | undefined : T[K];
};
type CliReadBodySchema<TOperation extends CliReadOperation> = z.ZodType<
  unknown,
  z.ZodTypeDef,
  ZodCompatibleInput<Extract<CliReadEnvelopeBody, { operation: TOperation }>>
>;

export const CLI_READ_OPERATION_SCHEMAS = {
  'workspace.skills.list': z
    .object({
      requestId: uuid,
      authorizationRequestId: uuid,
      organizationId: uuid,
      projectId: uuid,
      machineId: uuid,
      operation: z.literal('workspace.skills.list'),
      provider: z.enum(['claude', 'codex', 'opencode']),
      catalogContext: z.discriminatedUnion('policy', [
        z.object({ policy: z.literal('non_repository') }).strict(),
        z.object({ policy: z.literal('service_workspace'), serviceId: uuid }).strict(),
      ]),
    })
    .strict(),
  'run.changed_files.count': z
    .object({
      requestId: z.string().uuid(),
      agentSessionId: z.string().uuid(),
      operation: z.literal('run.changed_files.count'),
      runId: z.string().uuid(),
    })
    .strict(),
  'run.changed_files.inventory': z
    .object({
      requestId: z.string().uuid(),
      agentSessionId: z.string().uuid(),
      operation: z.literal('run.changed_files.inventory'),
      runId: z.string().uuid(),
    })
    .strict(),
  'run.changed_files.detail': z
    .object({
      requestId: z.string().uuid(),
      agentSessionId: z.string().uuid(),
      operation: z.literal('run.changed_files.detail'),
      runId: z.string().uuid(),
      file: z
        .object({
          serviceId: z.string().uuid(),
          repoPath: z.string().max(4096),
          filePath: z.string().max(4096),
        })
        .strict(),
    })
    .strict(),
  'run.context_usage.get': z
    .object({
      requestId: z.string().uuid(),
      agentSessionId: z.string().uuid(),
      operation: z.literal('run.context_usage.get'),
      runId: z.string().uuid(),
      providerSessionId: z.string().min(1).optional(),
    })
    .strict(),
  'run.skills.list': z
    .object({
      requestId: z.string().uuid(),
      agentSessionId: z.string().uuid(),
      operation: z.literal('run.skills.list'),
      runId: z.string().uuid(),
    })
    .strict(),
  'run.tool_calls.latest_turn': z
    .object({
      requestId: z.string().uuid(),
      agentSessionId: z.string().uuid(),
      operation: z.literal('run.tool_calls.latest_turn'),
      runId: z.string().uuid(),
    })
    .strict(),
  'project.session_costs.list': z
    .object({
      requestId: z.string().uuid(),
      agentSessionId: z.string().uuid(),
      operation: z.literal('project.session_costs.list'),
      projectId: z.string().uuid(),
      activityFrom: z.string().datetime().optional(),
      activityTo: z.string().datetime().optional(),
      minKnownCostUsd: z.number().nonnegative().optional(),
      limit: z.number().int().min(1).max(100),
      cursor: z.string().min(1).nullable().optional(),
    })
    .strict(),
  'provider.usage.get': z
    .object({
      requestId: uuid,
      agentSessionId: uuid,
      operation: z.literal('provider.usage.get'),
    })
    .strict(),
  'runtime.model_catalog.get': z
    .object({
      requestId: uuid,
      authorizationRequestId: uuid,
      organizationId: uuid,
      projectId: uuid,
      machineId: uuid,
      operation: z.literal('runtime.model_catalog.get'),
    })
    .strict(),
} satisfies { [TOperation in CliReadOperation]: CliReadBodySchema<TOperation> };

const cliReadBodyV2Schema = z.union([
  CLI_READ_OPERATION_SCHEMAS['workspace.skills.list'],
  CLI_READ_OPERATION_SCHEMAS['run.changed_files.count'],
  CLI_READ_OPERATION_SCHEMAS['run.changed_files.inventory'],
  CLI_READ_OPERATION_SCHEMAS['run.changed_files.detail'],
  CLI_READ_OPERATION_SCHEMAS['run.context_usage.get'],
  CLI_READ_OPERATION_SCHEMAS['run.skills.list'],
  CLI_READ_OPERATION_SCHEMAS['run.tool_calls.latest_turn'],
  CLI_READ_OPERATION_SCHEMAS['project.session_costs.list'],
  CLI_READ_OPERATION_SCHEMAS['provider.usage.get'],
  CLI_READ_OPERATION_SCHEMAS['runtime.model_catalog.get'],
]) satisfies z.ZodType<unknown, z.ZodTypeDef, ZodCompatibleInput<CliReadEnvelopeBody>>;

export const PROTECTED_CLI_READ_OPERATIONS = Object.freeze(
  Object.keys(CLI_READ_OPERATION_SCHEMAS) as CliReadOperation[],
);

export const cliReadFrameV2Schema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('cli.read.request'),
    envelope: z
      .object({
        ...v2EnvelopeFields,
        event: cliReadBodyV2Schema,
      })
      .strict(),
  })
  .strict();

export const triggerControlReductionFrameV2Schema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.control'),
    envelope: z
      .object({
        ...reductionEnvelopeFields,
        event: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('stop_run'), conversationId: uuid, runId: uuid }).strict(),
          z
            .object({
              kind: z.literal('cancel_input'),
              conversationId: uuid,
              agentSessionId: uuid,
              operationId: uuid,
              operationFingerprint: sha256Hex,
              messageId: uuid,
            })
            .strict(),
        ]),
      })
      .strict(),
  })
  .strict();
export const triggerControlReductionEventFrameV2Schema =
  triggerControlReductionFrameV2Schema.extend({
    type: z.literal('trigger.control_reduction'),
  });

const controllerRevocationReductionBodySchema = z
  .object({
    version: z.literal(2),
    kind: z.literal('controller_revocation_reduction'),
    action: z.literal('CONTROLLER_REVOKE'),
    machineId: uuid,
    controllerCredentialId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    revokedAt: z.string().datetime(),
    enrollmentState: z.enum(['READY', 'CONTROLLER_ENROLLMENT_REQUIRED', 'NO_CONTROLLER']),
    executionReadiness: z.enum([
      'NO_MACHINE_SELECTED',
      'LEGACY_PROTOCOL',
      'CONTROLLER_ENROLLMENT_REQUIRED',
      'CONTROLLER_REVOKED',
      'MACHINE_REVOKED',
      'DISCONNECTED',
      'READY',
    ]),
  })
  .strict();

const machineRevocationReductionBodySchema = z
  .object({
    version: z.literal(2),
    kind: z.literal('machine_revocation_reduction'),
    action: z.literal('MACHINE_REVOKE'),
    machineId: uuid,
    revokedAt: z.string().datetime(),
    executionReadiness: z.literal('MACHINE_REVOKED'),
  })
  .strict();

export const triggerAuthorityReductionFrameV2Schema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.authority_reduction'),
    envelope: z.union([
      z
        .object({
          ...reductionEnvelopeFields,
          controllerCredentialId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
          event: controllerRevocationReductionBodySchema,
        })
        .strict(),
      z
        .object({
          ...reductionEnvelopeFields,
          event: machineRevocationReductionBodySchema,
        })
        .strict(),
    ]),
  })
  .strict();

type VerifiedAuthorityReductionEnvelope = SignedAuthorityReductionEnvelope;

export const triggerMonitorReductionFrameV2Schema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.monitor_command'),
    projectId: z.string().uuid(),
    envelope: z
      .object({
        ...reductionEnvelopeFields,
        event: z
          .object({
            version: z.literal(2),
            kind: z.literal('task_monitor_authority_reduction'),
            commandId: z.string().uuid(),
            createdAt: z.string().datetime(),
            expiresAt: z.string().datetime(),
            organizationId: z.string().uuid(),
            projectId: z.string().uuid(),
            target: z
              .object({ workItemType: z.literal('TASK_MONITOR'), workItemId: z.string().uuid() })
              .strict(),
            command: z.discriminatedUnion('cause', [
              z.object({ cause: z.literal('PAUSE') }).strict(),
              z.object({ cause: z.literal('STOP') }).strict(),
              z.object({ cause: z.literal('HALT') }).strict(),
            ]),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export const triggerMonitorReductionEventFrameV2Schema =
  triggerMonitorReductionFrameV2Schema.extend({
    type: z.literal('trigger.monitor_reduction'),
  });

export const triggerMonitorAuthorityNeutralFrameV2Schema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.monitor_command'),
    projectId: z.string().uuid(),
    envelope: z
      .object({
        ...reductionEnvelopeFields,
        event: monitorAuthorityNeutralBodyV2Schema,
      })
      .strict(),
  })
  .strict();

export type SignedMonitorAuthorityNeutralEnvelopeV2 = SignedMonitorAuthorityNeutralEnvelope;

export const triggerApplicationEffectFrameV2Schema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.application_effect'),
    envelope: z
      .object({
        ...v2EnvelopeFields,
        event: z
          .object({
            version: z.literal(2),
            kind: z.literal('application_effect'),
            effectId: uuid,
            agentSessionId: uuid,
            actionPayloadHash: sha256Hex,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const triggerExactActionFrameV2Schema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.exact_action'),
    envelope: z
      .object({
        ...v2EnvelopeFields,
        event: z
          .object({
            version: z.literal(2),
            kind: z.literal('exact_action'),
            exactActionId: uuid,
            requestRevision: z.number().int().nonnegative(),
            actionFingerprint: sha256Hex,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type ControllerAuthorizedSignedConversationTriggerEnvelope = Omit<
  SignedConversationTriggerEnvelope,
  'signature'
> & {
  signature: string;
  protocolVersion: 2;
  authorization: ExecutableEnvelopeAuthorization;
};

type ControllerAuthorizedSignedControlReductionEnvelope = Omit<
  SignedConversationControlEnvelope,
  'signature'
> & {
  signature: string;
  protocolVersion: 2;
};

type ControllerAuthorizedSignedMonitorReductionEnvelope = Omit<
  SignedMonitorCommandEnvelope,
  'signature'
> & {
  signature: string;
  protocolVersion: 2;
};

type ControllerAuthorizedSignedCliReadEnvelopeV2 = ControllerAuthorizedSignedCliReadEnvelope;
export type ControllerAuthorizedSignedConversationControlEnvelopeV2 =
  ControllerAuthorizedSignedConversationControlEnvelope;
export type ControllerAuthorizedSignedMonitorCommandEnvelopeV2 =
  ControllerAuthorizedSignedMonitorCommandEnvelope;
type V2AgentTrigger = AgentTrigger;
type V2CliReadEnvelopeBody = CliReadEnvelopeBody;
export type V2ConversationControlBody = ConversationAuthorityIncreasingControlBody;
type V2MonitorCommandBody = MonitorCommandBodyV2;
type V1MonitorReductionBody = MonitorCommandBody;

export interface ApplicationEffectLaunchBodyV2 {
  version: 2;
  kind: 'application_effect';
  effectId: string;
  agentSessionId: string;
  actionPayloadHash: string;
}

export interface ExactActionDeliveryBodyV2 {
  version: 2;
  kind: 'exact_action';
  exactActionId: string;
  requestRevision: number;
  actionFingerprint: string;
}
