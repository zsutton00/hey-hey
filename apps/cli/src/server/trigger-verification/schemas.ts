/**
 * Zod schemas mirroring the generated trigger-frame and signed-envelope types.
 * Used at the upstream websocket boundary to reject unknown fields and
 * malformed envelopes before any verification work runs.
 *
 * `strict()` is applied at every object level so an injected field anywhere in
 * the envelope or wrapper fails fast — covering the security pre-condition that
 * the canonical bytes the CLI reconstructs equal the canonical bytes the server
 * signed.
 */

import { z } from 'zod';
import {
  TaskMonitorLaunchMethod,
  TaskMonitorLaunchProvider,
  TaskMonitorReasoningEffort,
  TaskMonitorGuidanceChangedCommandCauseEnum,
  TaskMonitorHumanDecisionCommandCauseEnum,
  TaskMonitorHumanDecisionCommandResolutionEnum,
  TaskMonitorJudgmentResolvedCommandCauseEnum,
  TaskMonitorPauseCommandCauseEnum,
  TaskMonitorResumeCommandCauseEnum,
  TaskMonitorStopCommandCauseEnum,
  type StartRunWorktree,
  type TaskMonitorGuidanceChangedCommand,
  type TaskMonitorHumanDecisionCommand,
  type TaskMonitorJudgmentResolvedCommand,
  type TaskMonitorJudgmentResponse,
  type TaskMonitorLaunchConfig,
  type TaskMonitorPauseCommand,
  type TaskMonitorResumeCommand,
  type TaskMonitorStopCommand,
} from '../../shared/agent-bridge-contract/generated/api';
import { UserSettingsProvider, UserSettingsReasoningEffort } from '../../shared/api/generated/api';

const envelopeBindingFields = {
  machineId: z.string().min(1),
  userId: z.string().min(1),
  nonce: z.string().min(1),
  timestampMs: z.number().int().finite(),
  signature: z.string().min(1),
};

// The AgentTrigger body is a discriminated union with deep, variant-specific
// payloads. Verification only locks down the load-bearing top-level fields —
// `promptType` (allowlist match), `nodeId` (workflow node binding, optional
// because the `user_message` follow-up variant rides on already-loaded CLI
// run state and does not bind a node), and `triggerMessageId` (the SYSTEM
// message id this trigger was minted onto; threaded through Run/Turn so
// submission tools can complete the right node). Payload-shape validation
// for actual dispatch happens later via `validateTriggerPayload`. Allow
// extra keys here (`.passthrough()`) so the canonical bytes cover the whole
// body even though the schema does not enumerate every variant's payload.
const agentTriggerEventSchema = z
  .object({
    promptType: z.string().min(1),
    nodeId: z.string().min(1).optional(),
    triggerMessageId: z.string().min(1),
  })
  .passthrough();

const signedConversationTriggerEnvelopeSchema = z
  .object({
    ...envelopeBindingFields,
    event: agentTriggerEventSchema,
  })
  .strict();

const conversationControlStopRunBodySchema = z
  .object({
    kind: z.literal('stop_run'),
    conversationId: z.string().min(1),
    runId: z.string().min(1),
  })
  .strict();

const conversationControlCompactRunBodySchema = z
  .object({
    kind: z.literal('compact_run'),
    conversationId: z.string().min(1),
    runId: z.string().min(1),
  })
  .strict();

const conversationControlPermissionDecisionBodySchema = z
  .object({
    kind: z.literal('permission_decision'),
    decision: z.enum(['approve', 'always_approve', 'deny', 'whitelist']),
    requestId: z.string().min(1),
    sessionId: z.string().min(1),
    agentType: z.enum(['claude', 'codex', 'opencode']),
    reason: z.string().nullable().optional(),
    idempotencyToken: z.string().min(1),
  })
  .strict();

const conversationControlQuestionAnswerBodySchema = z
  .object({
    kind: z.literal('question_answer'),
    requestId: z.string().min(1),
    sessionId: z.string().min(1),
    agentType: z.enum(['claude', 'codex', 'opencode']),
    answers: z.record(z.string(), z.string()),
    idempotencyToken: z.string().min(1),
  })
  .strict();

const conversationControlBodySchema = z.discriminatedUnion('kind', [
  conversationControlStopRunBodySchema,
  conversationControlCompactRunBodySchema,
  conversationControlPermissionDecisionBodySchema,
  conversationControlQuestionAnswerBodySchema,
]);

const signedConversationControlEnvelopeSchema = z
  .object({
    ...envelopeBindingFields,
    event: conversationControlBodySchema,
  })
  .strict();

const startRunWorktreeShape = {
  enabled: z.literal(true),
  branch: z.string().min(1).optional(),
} satisfies Record<keyof StartRunWorktree, z.ZodTypeAny>;

const taskMonitorLaunchConfigShape = {
  taskId: z.string().uuid(),
  method: z.nativeEnum(TaskMonitorLaunchMethod),
  provider: z.nativeEnum(TaskMonitorLaunchProvider),
  model: z.string().min(1),
  reasoningEffort: z.nativeEnum(TaskMonitorReasoningEffort),
  fastMode: z.boolean().optional(),
  worktree: z.object(startRunWorktreeShape).strict().optional(),
} satisfies Record<keyof TaskMonitorLaunchConfig, z.ZodTypeAny>;

const taskMonitorLaunchConfigSchema = z.object(taskMonitorLaunchConfigShape).strict();

const taskMonitorJudgmentResponseShape = {
  requestMessageId: z.string().uuid(),
  label: z.string().max(240),
  conclusion: z.string().max(500),
} satisfies Record<keyof TaskMonitorJudgmentResponse, z.ZodTypeAny>;

const taskMonitorJudgmentResponseSchema = z.object(taskMonitorJudgmentResponseShape).strict();

const taskMonitorPauseCommandFields = {
  cause: z.literal(TaskMonitorPauseCommandCauseEnum.Pause),
} satisfies Record<keyof TaskMonitorPauseCommand, z.ZodTypeAny>;

const taskMonitorResumeCommandFields = {
  cause: z.literal(TaskMonitorResumeCommandCauseEnum.Resume),
} satisfies Record<keyof TaskMonitorResumeCommand, z.ZodTypeAny>;

const taskMonitorGuidanceChangedCommandFields = {
  cause: z.literal(TaskMonitorGuidanceChangedCommandCauseEnum.GuidanceChanged),
  guidance: z.string().min(1).max(5000),
} satisfies Record<keyof TaskMonitorGuidanceChangedCommand, z.ZodTypeAny>;

const taskMonitorStopCommandFields = {
  cause: z.literal(TaskMonitorStopCommandCauseEnum.Stop),
} satisfies Record<keyof TaskMonitorStopCommand, z.ZodTypeAny>;

const taskMonitorHumanDecisionCommandFields = {
  cause: z.literal(TaskMonitorHumanDecisionCommandCauseEnum.HumanDecision),
  interventionId: z.string().uuid(),
  providerActionId: z.string().min(1),
  runId: z.string().uuid(),
  agentSessionId: z.string().uuid(),
  fingerprint: z.string().min(1),
  resolution: z.enum([
    TaskMonitorHumanDecisionCommandResolutionEnum.Approve,
    TaskMonitorHumanDecisionCommandResolutionEnum.Deny,
  ]),
  human: z.object({ userId: z.string().uuid(), authenticatedAt: z.string().datetime() }).strict(),
} satisfies Record<keyof TaskMonitorHumanDecisionCommand, z.ZodTypeAny>;

const taskMonitorJudgmentResolvedCommandFields = {
  cause: z.literal(TaskMonitorJudgmentResolvedCommandCauseEnum.JudgmentResolved),
  judgment: taskMonitorJudgmentResponseSchema,
} satisfies Record<keyof TaskMonitorJudgmentResolvedCommand, z.ZodTypeAny>;

const taskMonitorExternalCommandSchema = z.discriminatedUnion('cause', [
  z
    .object({
      cause: z.literal('START'),
      launchConfig: taskMonitorLaunchConfigSchema,
      userMessage: z.string().max(5000).optional(),
    })
    .strict(),
  z.object(taskMonitorPauseCommandFields).strict(),
  z.object(taskMonitorResumeCommandFields).strict(),
  z.object(taskMonitorGuidanceChangedCommandFields).strict(),
  z.object(taskMonitorHumanDecisionCommandFields).strict(),
  z.object(taskMonitorStopCommandFields).strict(),
  z.object(taskMonitorJudgmentResolvedCommandFields).strict(),
  z.object({ cause: z.literal('CONTINUE') }).strict(),
  z.object({ cause: z.literal('COMPLETE') }).strict(),
  z.object({ cause: z.literal('HALT') }).strict(),
]);

export const monitorCommandBodySchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('task_monitor_command'),
    commandId: z.string().uuid(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    target: z
      .object({
        workItemType: z.literal('TASK_MONITOR'),
        workItemId: z.string().uuid(),
      })
      .strict(),
    command: taskMonitorExternalCommandSchema,
  })
  .strict();

const signedMonitorCommandEnvelopeSchema = z
  .object({
    ...envelopeBindingFields,
    event: monitorCommandBodySchema,
  })
  .strict();

const cliReadRunChangedFilesCountBodySchema = z
  .object({
    requestId: z.string().uuid(),
    agentSessionId: z.string().uuid().optional(),
    operation: z.literal('run.changed_files.count'),
    runId: z.string().uuid(),
  })
  .strict();

const cliReadRunChangedFilesInventoryBodySchema = z
  .object({
    requestId: z.string().uuid(),
    agentSessionId: z.string().uuid().optional(),
    operation: z.literal('run.changed_files.inventory'),
    runId: z.string().uuid(),
  })
  .strict();

const cliReadRunChangedFileDetailBodySchema = z
  .object({
    requestId: z.string().uuid(),
    agentSessionId: z.string().uuid().optional(),
    operation: z.literal('run.changed_files.detail'),
    runId: z.string().uuid(),
    file: z
      .object({
        serviceId: z.string().uuid(),
        repoPath: z.string().min(1).max(4096),
        filePath: z.string().min(1).max(4096),
      })
      .strict(),
  })
  .strict();

const cliReadRunContextUsageGetBodySchema = z
  .object({
    requestId: z.string().uuid(),
    agentSessionId: z.string().uuid().optional(),
    operation: z.literal('run.context_usage.get'),
    runId: z.string().uuid(),
    providerSessionId: z.string().min(1).optional(),
  })
  .strict();

const cliReadProjectSessionCostsListBodySchema = z
  .object({
    requestId: z.string().uuid(),
    agentSessionId: z.string().uuid().optional(),
    operation: z.literal('project.session_costs.list'),
    projectId: z.string().uuid(),
    activityFrom: z.string().datetime().optional(),
    activityTo: z.string().datetime().optional(),
    minKnownCostUsd: z.number().nonnegative().optional(),
    limit: z.number().int().min(1).max(100),
    cursor: z.string().min(1).nullable().optional(),
  })
  .strict();

const cliReadBodySchema = z.discriminatedUnion('operation', [
  cliReadRunChangedFilesCountBodySchema,
  cliReadRunChangedFilesInventoryBodySchema,
  cliReadRunChangedFileDetailBodySchema,
  cliReadRunContextUsageGetBodySchema,
  cliReadProjectSessionCostsListBodySchema,
]);

const signedCliReadEnvelopeSchema = z
  .object({
    ...envelopeBindingFields,
    event: cliReadBodySchema,
  })
  .strict();

const dailySessionSettingsValueSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.nativeEnum(UserSettingsProvider),
    model: z.string().min(1),
    reasoningEffort: z.nativeEnum(UserSettingsReasoningEffort),
    countThreshold: z.number().int().min(1),
    eventTypes: z.array(z.string().min(1)).min(1),
  })
  .strict();

const cliSettingsDailySessionGetEnvelopeBodySchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal('daily_session.settings.get'),
    projectId: z.string().uuid(),
  })
  .strict();

const cliSettingsDailySessionReplaceEnvelopeBodySchema = z
  .object({
    requestId: z.string().uuid(),
    operation: z.literal('daily_session.settings.replace'),
    projectId: z.string().uuid(),
    expectedPersistenceRevision: z.number().int().min(0),
    value: dailySessionSettingsValueSchema,
  })
  .strict();

const cliSettingsBodySchema = z.discriminatedUnion('operation', [
  cliSettingsDailySessionGetEnvelopeBodySchema,
  cliSettingsDailySessionReplaceEnvelopeBodySchema,
]);

export const signedCliSettingsEnvelopeSchema = z
  .object({
    ...envelopeBindingFields,
    event: cliSettingsBodySchema,
  })
  .strict();

// Outer frames carry routing fields (timestamp, organizationId, etc.) that
// are NOT signed — they may legally vary independently of the envelope. The
// schema validates structure only.
const frameWrapperFields = {
  type: z.string(),
  timestamp: z.string(),
  organizationId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
};

export const triggerConversationFrameSchema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.conversation'),
    envelope: signedConversationTriggerEnvelopeSchema,
  })
  .strict();

export const triggerControlFrameSchema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.control'),
    envelope: signedConversationControlEnvelopeSchema,
  })
  .strict();

export const triggerMonitorCommandFrameSchema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('trigger.monitor_command'),
    projectId: z.string().uuid(),
    envelope: signedMonitorCommandEnvelopeSchema,
  })
  .strict();

export const cliReadFrameSchema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('cli.read.request'),
    envelope: signedCliReadEnvelopeSchema,
  })
  .strict();

export const cliSettingsFrameSchema = z
  .object({
    ...frameWrapperFields,
    type: z.literal('cli.settings.request'),
    envelope: signedCliSettingsEnvelopeSchema,
  })
  .strict();
