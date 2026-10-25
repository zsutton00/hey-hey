import { ControlReductionTelemetry } from '../control-reduction-telemetry';
import type { DiagnosticFeed } from '../diagnostic-feed';
import { DeterministicE2EEvidence } from '../../run/runners/deterministic-e2e-evidence';
import { MissingServiceBindingError } from '../services/run-errors';
import { startFailureOf } from '../input-admission/start-failure';
import { InputAdmissionIdentityError } from '../input-admission/input-admission-identity-error';
import type { ReadableInputRecord } from '../input-admission/input-admission-codec';
import {
  storedSignedTriggerSchema,
  toStoredTriggerFrame,
} from '../input-admission/input-admission-payload';
import {
  conversationActionHash,
  controlActionHash,
  monitorActionHash,
  controlAction,
} from './delivered-controller-action';
import { createHash } from 'node:crypto';
import { canonicalizeJson } from './jcs';
/**
 * Routes verified trigger frames into their handlers.
 *
 * `trigger.conversation` frames are mapped to the same `sendMessage` path the
 * POST endpoint uses: build a `LocalRunPromptRequest` from `envelope.event`,
 * run `validateTriggerPayload` on the wire payload, and call
 * `localAgentService.sendMessage` against the run that owns the conversation.
 *
 * All drops (verification failure or no active run for the conversation) emit
 * a single structured audit-log entry — never throws or disconnects the socket.
 */

import type { ServerLogger } from '../logger';
import type { ApiRuntime } from '../../../../../packages/ui-common/src/clients/shared';
import type { KeyPairStore } from '../../credentials';
import type { PlatformDeliveryContext, PlatformWebSocketEvent } from '../platform-ws';
import type {
  LocalAnyPromptPayload,
  LocalCreateRunRequest,
  LocalRunPromptRequest,
} from '../../shared/agent-bridge-contract/contract';
import {
  LocalPromptType,
  type AgentTrigger,
  type MonitorCommandAcknowledgement,
} from '../../shared/agent-bridge-contract/generated/api';
import type {
  AgentInputDisposition,
  AgentOperationDispatchAcknowledgement,
  AuthorityReductionAcknowledgement,
  UserMessagePromptPayload,
} from '../../shared/api/generated/api';
import type { MachineControllerAuthority } from '../../auth/machine-controller-authority';
import { buildCodeReviewRequest } from '../../agents/review-subagent/review-request';
import {
  START_RUN_TRIGGER_SENTINEL,
  USER_MESSAGE_TRIGGER_SENTINEL,
  validateTriggerPayload,
  validateUserMessageTriggerPayload,
  type StartRunTriggerPayload,
} from '../conversation-dispatch/trigger-payload-schemas';
import type { PromptTypeRegistry } from '../../agents/prompt-type-registry';
import type { LocalAgentService } from '../local-agent-service';
import type { RunRegistry } from '../../run/run-registry';
import type { RunStore } from '../../run-store/run-store';
import { TaskMonitorStateMachineInputAdapter } from '../state-machine-input-adapter';
import type { RunReadRestoreCoordinator } from '../restore-persisted-runs';
import { PermissionDecisionControlDispatcher } from './permission-decision-control-dispatcher';
import { QuestionAnswerControlDispatcher } from './question-answer-control-dispatcher';
import { TriggerRateLimiter } from './rate-limiter';
import { OperationReceiptStore } from './operation-receipt-store';
import {
  TriggerDropRecoverySurface,
  type TriggerDropSurfacingDependencies,
} from './trigger-drop-recovery-surface';
import type { TriggerVerifier, VerificationDropReason, VerifiedTriggerFrame } from './verify';
import type { HostActionAdmission } from '../controller-authorization/host-action-admission';
import type { HostActionAdmissionRequest } from '../controller-authorization/types';
import type { AdmittedHostAction } from '../controller-authorization/types';
import type { ApplicationEffectLaunchBodyV2, ExactActionDeliveryBodyV2 } from './protocol-v2';
import type { AdmissionEnvelopeAuthorization } from '../../shared/api/generated/api';
import type { ExecutableEnvelopeAuthorization } from '../controller-authorization/types';
import { ConversationRunResolver } from '../conversation-dispatch/conversation-run-resolver';
import { TaskMonitorConversationInputAdmission } from '../task-monitor-conversation-input-admission';
import type {
  OperationTimelineKeyKind,
  OperationTimelineRegistry,
} from '../input-admission/operation-timeline';

const FRAME_EVENT_TYPES = new Set([
  'trigger.conversation',
  'trigger.control',
  'trigger.control_reduction',
  'trigger.authority_reduction',
  'trigger.application_effect',
  'trigger.exact_action',
  'trigger.monitor_reduction',
]);

const toAdmissionAuthorization = (
  authorization: ExecutableEnvelopeAuthorization,
): AdmissionEnvelopeAuthorization => {
  if (authorization.kind === 'bounded_grant') return authorization;
  const { grantId: _serverGrantId, ...admissionAuthorization } = authorization;
  return admissionAuthorization;
};

const timelineIdentityFor = (
  verified: VerifiedTriggerFrame,
): { key: string; keyKind: OperationTimelineKeyKind; promptType: string } | null => {
  if (verified.kind !== 'trigger.conversation') return null;
  const body = verified.body as AgentTrigger;
  const operationId =
    body.promptType === 'start_run' || body.promptType === 'user_message'
      ? body.operationId
      : 'inputExecution' in body
        ? body.inputExecution?.operationId
        : undefined;
  return {
    key: operationId ?? body.triggerMessageId,
    keyKind: operationId ? 'operation' : 'trigger_message',
    promptType: body.promptType,
  };
};

export interface ConversationRunBinding {
  runId: string;
  conversationId: string;
}

export interface TriggerFrameRouterDependencies {
  verifier: TriggerVerifier;
  machinesApi: ApiRuntime['clients']['machines'];
  keyPairStore: KeyPairStore;
  /**
   * Resolve the active run that owns the given conversation. Returns null
   * when no run on this CLI is bound to the conversation — the trigger is
   * dropped with an audit-log entry in that case.
   */
  runStore: RunStore;
  agentService: LocalAgentService;
  /** Handler declarations the wire validators read (e.g. `allowsEmptyUserMessage`). */
  promptTypeRegistry: PromptTypeRegistry;
  operationTimeline?: OperationTimelineRegistry;
  diagnosticFeed?: DiagnosticFeed;
  /**
   * Deliver a user permission decision to the Run's bound runner. Wired to
   * `runRegistry.submitPermissionDecision` at startup. Never throws — an absent
   * Run or unbound runner resolves to a `dropped` outcome, a runner error to
   * `failed` — so the control dispatch records the outcome and discards the
   * frame without surfacing an error.
   */
  runRegistry: RunRegistry;
  /** Restores a durable Run before permission control reaches its registry. */
  runRestoreCoordinator: RunReadRestoreCoordinator;
  /** Durable location for permission-decision delivery outcomes. */
  permissionDecisionAuditFilePath: string;
  taskMonitorStateMachineInputAdapter: TaskMonitorStateMachineInputAdapter;
  /** Durable single-shot admission for interactive agent operations. */
  operationReceiptStorePath?: string;
  /** The single local authority gate for protocol-2 host effects. */
  hostActionAdmission?: HostActionAdmission;
  /** Concrete owner for durable controller- and machine-authority reductions. */
  machineControllerAuthority?: Pick<MachineControllerAuthority, 'applyVerifiedAuthorityReduction'>;
  applicationEffectExecutor?: {
    execute(capability: AdmittedHostAction, effect: ApplicationEffectLaunchBodyV2): Promise<void>;
  };
  exactActionExecutor?: {
    execute(capability: AdmittedHostAction, action: ExactActionDeliveryBodyV2): Promise<void>;
  };
  /** User-visible drop surfacing and recovery context. */
  dropSurfacing: TriggerDropSurfacingDependencies;
  logger: ServerLogger;
}

/** The disposition the admission commit recorded, never the record's current state. */
const acknowledgedDisposition = (record: ReadableInputRecord): AgentInputDisposition =>
  record.admissionDisposition === 'immediate' ? 'IMMEDIATE' : 'QUEUED';

const logDropped = (logger: ServerLogger, fields: Record<string, unknown>): void => {
  logger.warn('trigger-verification.frame.dropped', fields);
};

/**
 * Surface the discriminator values that actually drove a
 * `payload_validation_failed` drop. The zod error message names the *expected*
 * set but not what the wire frame *sent*, so without this the offending
 * `handlerPromptType` / inner `payload.promptType` are invisible and the drop
 * cannot be root-caused to producer-vs-CLI without re-deriving from a live
 * capture. Both the start_run and user_message envelopes carry
 * `handlerPromptType` at `body.payload.handlerPromptType`; only start_run nests
 * a further typed payload at `body.payload.payload`, so `innerPromptType` is
 * undefined for user_message frames (expected, not an anomaly).
 */
const describeDroppedPayload = (body: { payload?: unknown }): Record<string, unknown> => {
  const wirePayload = body.payload as
    | { handlerPromptType?: unknown; payload?: { promptType?: unknown } }
    | undefined;
  return {
    handlerPromptType: wirePayload?.handlerPromptType,
    innerPromptType: wirePayload?.payload?.promptType,
    payloadKeys:
      wirePayload && typeof wirePayload === 'object' ? Object.keys(wirePayload) : undefined,
  };
};

/** What `toCreateRunRequest` reads; the wire-validated and the stored start_run payloads both satisfy it. */
export type StartRunRequestSource = Omit<
  StartRunTriggerPayload,
  'runId' | 'handlerPromptType' | 'workflowName' | 'agentSessionId'
>;

/**
 * Translate a validated `start_run` payload into the `LocalCreateRunRequest`
 * the local-agent-service consumes. Pure: validation happens once, at the
 * wire boundary. `handlerPromptType` becomes the run's
 * promptType (the real per-handler routing key), `payload` carries the typed
 * prompt payload the handler runs against, `contextMetadata` is forwarded
 * verbatim (typed as the shared `RunContextMetadata` the envelope and
 * `LocalCreateRunRequest` both `$ref`, so no field can be silently dropped),
 * and `LocalPendingRunContext` is derived from `contextMetadata.projectId` +
 * envelope `serviceId` / `provider`.
 */
export const toCreateRunRequest = (
  payload: StartRunRequestSource,
  conversationId: string,
): LocalCreateRunRequest => ({
  context: {
    projectId: payload.contextMetadata.projectId,
    // Non-coding sessions (refiners, entity conversations) carry no services, so
    // the service set is omitted from the payload. Forward `serviceIds` +
    // `launchServiceId` into the run context the consumer
    // (`parsePendingRunContext` / `readPendingServices`) reads. Spread only when
    // present (exactOptionalPropertyTypes rejects an explicit `undefined`).
    ...(payload.serviceIds && payload.serviceIds.length > 0
      ? {
          serviceIds: payload.serviceIds,
          ...(payload.launchServiceId ? { launchServiceId: payload.launchServiceId } : {}),
        }
      : {}),
    provider: payload.provider,
  },
  attachments: payload.attachments ?? [],
  stagedBrowserTab: payload.stagedBrowserTab ?? null,
  contextMetadata: payload.contextMetadata,
  conversationId,
  // The turn-firing arm always carries its typed handler payload. The workflow
  // arm may be bind-only or carry `workflow_kickoff`: createRun reads the
  // kickoff's optional entity before materialization, while a missing payload
  // (or the absence of a registered workflow_kickoff handler) prevents a first
  // Turn. The workflow's SYSTEM triggers drive all Turns afterward.
  ...(payload.payload !== undefined ? { payload: payload.payload } : {}),
  ...(payload.triggersAgent !== undefined ? { triggersAgent: payload.triggersAgent } : {}),
  ...(payload.worktree !== undefined ? { worktree: payload.worktree } : {}),
  ...(payload.config !== undefined ? { config: payload.config } : {}),
  model: payload.model,
  // reasoningEffort is optional: providers like OpenCode don't support it
  ...(payload.reasoningEffort !== undefined ? { reasoningEffort: payload.reasoningEffort } : {}),
  ...(payload.fastMode !== undefined ? { fastMode: payload.fastMode } : {}),
  ...(payload.skillSelection !== undefined ? { skillSelection: payload.skillSelection } : {}),
});

/**
 * The event `toRunPromptRequest` maps. Both the wire-validated trigger and the
 * stored v2 event must be assignable to it, so a wire contract change the
 * stored format does not carry fails typecheck at delivery instead of
 * rejecting saved inputs at runtime.
 */
export type ConversationPromptEvent =
  | {
      readonly promptType: typeof USER_MESSAGE_TRIGGER_SENTINEL;
      readonly payload: UserMessagePromptPayload;
    }
  | {
      readonly promptType: LocalPromptType;
      readonly payload?: unknown;
      readonly nodeId?: string;
      readonly triggerMessageId: string;
    };

/**
 * Wire boundary only: validate a verified conversation trigger into the typed
 * event `toRunPromptRequest` maps. Throws `TriggerPayloadValidationError` for
 * a missing or malformed payload. Saved inputs are never passed through here.
 */
export const validateConversationTrigger = (
  body: AgentTrigger,
  promptTypeRegistry: PromptTypeRegistry,
): ConversationPromptEvent => {
  if (body.promptType === USER_MESSAGE_TRIGGER_SENTINEL) {
    // Protocol v1's shallow envelope schema predates the required source
    // identity, so enforce the generated user_message contract here too.
    // Without this guard the request would be treated as an ordinary
    // unmarked prompt and could be coalesced with another canonical USER
    // Message, losing the one-message-per-Turn boundary.
    if (typeof body.sourceUserMessageId !== 'string' || body.sourceUserMessageId.length === 0) {
      throw new Error('user_message trigger requires a non-empty sourceUserMessageId');
    }
    return {
      promptType: USER_MESSAGE_TRIGGER_SENTINEL,
      payload: validateUserMessageTriggerPayload(
        (body as { payload?: unknown }).payload,
        promptTypeRegistry,
      ) as UserMessagePromptPayload,
    };
  }
  const promptType = body.promptType as LocalPromptType;
  // AgentTrigger variants either declare a payload or none (the `implement`
  // variant). The validator returns the input untouched when no schema is
  // registered for the promptType.
  return {
    promptType,
    payload: validateTriggerPayload(promptType, (body as { payload?: unknown }).payload),
    ...(body.nodeId !== undefined ? { nodeId: body.nodeId } : {}),
    triggerMessageId: body.triggerMessageId,
  };
};

/** Pure: map a validated or stored conversation event to the Run's prompt request. */
export const toRunPromptRequest = (event: ConversationPromptEvent): LocalRunPromptRequest => {
  // The `user_message` sentinel is a follow-up trigger, not a node-entry
  // trigger: the body carries `payload.handlerPromptType` (the real
  // LocalPromptType the run is paused on) and `payload.userMessage`, and
  // the dispatch must use those — not the sentinel literal — as the
  // resulting LocalRunPromptRequest's `promptType` and `payload`.
  if (event.promptType === USER_MESSAGE_TRIGGER_SENTINEL) {
    const message = event.payload;
    const handlerPromptType = message.handlerPromptType as LocalPromptType;
    if (handlerPromptType === LocalPromptType.Quick) {
      return {
        promptType: LocalPromptType.CodingFreeform,
        payload: {
          promptType: LocalPromptType.CodingFreeform,
          userMessage: message.userMessage,
        },
        attachments: message.attachments,
        references: { resolved: [], unresolved: [] },
        ...(message.skillSelection ? { skillSelection: message.skillSelection } : {}),
      };
    }
    if (handlerPromptType === LocalPromptType.CodeReview) {
      return {
        ...buildCodeReviewRequest(message.userMessage, message.skillSelection),
        attachments: message.attachments,
        ...(message.runtime ? { turnRuntime: message.runtime } : {}),
      };
    }
    if (
      handlerPromptType === LocalPromptType.FeatureSyncIterate &&
      message.featureSyncContext !== undefined &&
      !('decisions' in message.featureSyncContext)
    ) {
      const payload: LocalAnyPromptPayload = {
        discrepancies: message.featureSyncContext.discrepancies,
        userMessage: message.userMessage,
      };
      return {
        promptType: handlerPromptType,
        payload,
        attachments: message.attachments,
        references: { resolved: [], unresolved: [] },
        ...(message.skillSelection ? { skillSelection: message.skillSelection } : {}),
      };
    }
    if (
      handlerPromptType === LocalPromptType.PlanShapingFeatureSyncIterate &&
      message.featureSyncContext !== undefined &&
      'decisions' in message.featureSyncContext
    ) {
      const payload: LocalAnyPromptPayload = {
        discrepancies: message.featureSyncContext.discrepancies,
        decisions: message.featureSyncContext.decisions,
        planId: message.featureSyncContext.planId,
        designDocId: message.featureSyncContext.designDocId,
        userMessage: message.userMessage,
      };
      return {
        promptType: handlerPromptType,
        payload,
        attachments: message.attachments,
        references: { resolved: [], unresolved: [] },
        ...(message.skillSelection ? { skillSelection: message.skillSelection } : {}),
      };
    }
    return {
      promptType: handlerPromptType,
      // The widened `handlerPromptType` no longer narrows to a single
      // LocalRunPromptPayload member, so the degenerate
      // `{promptType, userMessage}` literal needs the same single
      // `LocalAnyPromptPayload` seam cast the start_run path uses.
      payload: (handlerPromptType === LocalPromptType.TaskMonitor
        ? {
            ...message.taskMonitorPayload,
            promptType: handlerPromptType,
            userMessage: message.userMessage,
          }
        : {
            promptType: handlerPromptType,
            userMessage: message.userMessage,
          }) as LocalAnyPromptPayload,
      attachments: message.attachments,
      references: { resolved: [], unresolved: [] },
      ...(message.skillSelection ? { skillSelection: message.skillSelection } : {}),
      ...(message.runtime ? { turnRuntime: message.runtime } : {}),
      // User-reply follow-ups ride on the already-loaded Run state. They must
      // not emit a triggerContext — doing so would stamp a fresh triggerMessageId
      // under the Run's existing externalAgentNodeId, producing the
      // mixed-provenance envelope that caused the incident's rejected completions.
    };
  }

  const promptType = event.promptType;
  // The direct-trigger path's per-handler schemas are intentionally
  // promptType-free (the routing key lives on `event.promptType`, not inside
  // `event.payload`), so the mapper stamps promptType onto the payload here.
  return {
    promptType,
    payload: {
      ...((event.payload as Record<string, unknown> | undefined) ?? {}),
      promptType,
    } as LocalAnyPromptPayload,
    references: { resolved: [], unresolved: [] },
    // Emit the complete pair only when the event carries a nodeId. Without
    // nodeId the trigger is not node-entry and carries no pair to stamp.
    ...(event.nodeId !== undefined
      ? {
          triggerContext: {
            externalAgentNodeId: event.nodeId,
            triggerMessageId: event.triggerMessageId,
          },
        }
      : {}),
  };
};

export class TriggerFrameRouter {
  private readonly conversationRunResolver: ConversationRunResolver;
  private readonly taskMonitorConversationInputAdmission: TaskMonitorConversationInputAdmission;
  private readonly rateLimiter = new TriggerRateLimiter();
  /** Process-local delivery counter; distinguishes overlapping repeat deliveries of one key. */
  private admissionAttempts = 0;
  private readonly permissionDecisionControlDispatcher: PermissionDecisionControlDispatcher;
  private readonly questionAnswerControlDispatcher: QuestionAnswerControlDispatcher;
  private readonly dropRecoverySurface: TriggerDropRecoverySurface;
  private readonly operationReceiptStore: OperationReceiptStore;
  public readonly controlTelemetry: ControlReductionTelemetry;

  public constructor(private readonly dependencies: TriggerFrameRouterDependencies) {
    this.controlTelemetry = new ControlReductionTelemetry(
      dependencies.logger,
      dependencies.diagnosticFeed,
    );
    this.conversationRunResolver = new ConversationRunResolver(
      dependencies.runStore,
      dependencies.logger,
      async (conversationId, agentSessionId) =>
        startFailureOf(
          await dependencies.agentService.inputAdmission.owner.failedStartSettlement(
            conversationId,
            agentSessionId,
          ),
        )?.serviceIds ?? null,
    );
    this.taskMonitorConversationInputAdmission = new TaskMonitorConversationInputAdmission(
      dependencies.taskMonitorStateMachineInputAdapter,
      dependencies.agentService,
      dependencies.runStore,
      dependencies.logger.child({ component: 'task-monitor.conversation-input-admission' }),
    );
    this.permissionDecisionControlDispatcher = new PermissionDecisionControlDispatcher(
      dependencies.runStore,
      dependencies.runRegistry,
      dependencies.runRestoreCoordinator,
      dependencies.taskMonitorStateMachineInputAdapter,
      dependencies.permissionDecisionAuditFilePath,
      dependencies.logger,
    );
    this.questionAnswerControlDispatcher = new QuestionAnswerControlDispatcher(
      dependencies.runStore,
      dependencies.runRegistry,
      dependencies.runRestoreCoordinator,
      dependencies.logger,
    );
    this.dropRecoverySurface = new TriggerDropRecoverySurface({
      verifier: dependencies.verifier,
      machinesApi: dependencies.machinesApi,
      keyPairStore: dependencies.keyPairStore,
      surfacing: dependencies.dropSurfacing,
      logger: dependencies.logger,
    });
    this.operationReceiptStore = new OperationReceiptStore(
      dependencies.operationReceiptStorePath ??
        `${dependencies.permissionDecisionAuditFilePath}.agent-operations`,
    );
  }

  public dispose(): void {
    this.controlTelemetry.dispose();
  }

  private resolveConversationRun(conversationId: string): ConversationRunBinding | null {
    const runId = this.dependencies.runStore.lookupByConversationId(conversationId);
    return runId ? { runId, conversationId } : null;
  }

  private async resolveConversationAgentSessionId(
    body: AgentTrigger,
    conversationId: string,
    expectedAgentSessionId: string | undefined,
    logger: ServerLogger,
  ): Promise<
    | { status: 'resolved'; agentSessionId: string }
    | { status: 'temporarily_unavailable'; reason: string }
    | { status: 'rejected'; reason: string; serviceIds?: string[] }
  > {
    if (body.promptType === START_RUN_TRIGGER_SENTINEL) {
      return { status: 'resolved', agentSessionId: body.payload.agentSessionId };
    }
    const resolution = await this.conversationRunResolver.resolve(
      conversationId,
      expectedAgentSessionId,
      logger,
    );
    return resolution.status === 'resolved'
      ? { status: 'resolved', agentSessionId: resolution.agentSessionId }
      : resolution;
  }

  private async admissionRequestFor(
    verified: VerifiedTriggerFrame,
    logger: ServerLogger,
  ): Promise<
    | HostActionAdmissionRequest
    | { unavailable: true; reason: string }
    | { unboundServiceIds: string[] }
    | null
  > {
    if (verified.kind === 'trigger.authority_reduction') return null;
    const envelope = verified.envelope;
    const authorization = envelope.authorization;
    if (!authorization) return null;
    const projectId = verified.frame.projectId;
    if (!projectId) return null;
    const admissionIdentity =
      authorization.kind === 'controller_assertion'
        ? { controllerInstallationId: authorization.intent.controllerInstallationId }
        : {};

    if (verified.kind === 'trigger.conversation') {
      const body = verified.body as AgentTrigger;
      const conversationId = verified.frame.conversationId;
      if (!conversationId) return null;
      const expectedAgentSessionId =
        authorization.kind === 'controller_assertion' &&
        authorization.intent.target.kind === 'AGENT_SESSION'
          ? authorization.intent.target.id
          : undefined;
      const resolution = await this.resolveConversationAgentSessionId(
        body,
        conversationId,
        expectedAgentSessionId,
        logger,
      );
      if (resolution.status !== 'resolved') {
        this.dependencies.logger.warn('trigger-verification.authority.denied', {
          reason: resolution.reason,
          retryable: resolution.status === 'temporarily_unavailable',
          frameType: verified.kind,
          conversationId,
          nonce: envelope.nonce,
        });
        if (resolution.status === 'temporarily_unavailable')
          return { unavailable: true, reason: resolution.reason };
        return resolution.reason === 'service_folder_not_bound' && resolution.serviceIds
          ? { unboundServiceIds: resolution.serviceIds }
          : null;
      }
      const agentSessionId = resolution.agentSessionId;
      return {
        ...admissionIdentity,
        machineId: envelope.machineId,
        userId: envelope.userId,
        organizationId: verified.frame.organizationId,
        projectId,
        actionCategory: 'CONVERSATION',
        actionType: 'CONVERSATION_TRIGGER',
        actionPayloadHash: conversationActionHash(
          body,
          agentSessionId,
          envelope.nonce,
          authorization,
        ),
        target: {
          kind: 'AGENT_SESSION',
          id: agentSessionId,
          revision:
            authorization.kind === 'controller_assertion'
              ? authorization.intent.target.revision
              : null,
        },
        agentSessionId,
        authorizedTurnId: body.triggerMessageId,
        taskMonitorId: null,
        envelopeNonce: envelope.nonce,
        authorization,
      };
    }

    if (verified.kind === 'trigger.application_effect') {
      const body = verified.body;
      return {
        ...admissionIdentity,
        machineId: envelope.machineId,
        userId: envelope.userId,
        organizationId: verified.frame.organizationId,
        projectId,
        actionCategory: 'APPLICATION_EFFECT',
        actionType: 'APPLICATION_EFFECT_LAUNCH',
        actionPayloadHash: createHash('sha256').update(canonicalizeJson(body)).digest('hex'),
        target: { kind: 'APPLICATION_EFFECT', id: body.effectId, revision: null },
        agentSessionId: body.agentSessionId,
        taskMonitorId: null,
        envelopeNonce: envelope.nonce,
        authorization,
      };
    }

    if (verified.kind === 'trigger.exact_action') {
      const body = verified.body;
      return {
        ...admissionIdentity,
        machineId: envelope.machineId,
        userId: envelope.userId,
        organizationId: verified.frame.organizationId,
        projectId,
        actionCategory: 'EXACT_ACTION',
        actionType: 'EXACT_ACTION_DELIVERY',
        actionPayloadHash: createHash('sha256').update(canonicalizeJson(body)).digest('hex'),
        target: { kind: 'EXACT_ACTION', id: body.exactActionId, revision: body.requestRevision },
        envelopeNonce: envelope.nonce,
        authorization,
      };
    }

    if (verified.kind === 'trigger.control') {
      const body = verified.body;
      // Authority-non-increasing controls carry no controller authorization.
      if (body.kind === 'stop_run' || body.kind === 'cancel_input') return null;
      return {
        ...admissionIdentity,
        machineId: envelope.machineId,
        userId: envelope.userId,
        organizationId: verified.frame.organizationId,
        projectId,
        ...controlAction(body.kind),
        actionPayloadHash: controlActionHash(body, envelope.nonce),
        target: { kind: 'AGENT_SESSION', id: body.agentSessionId, revision: null },
        agentSessionId: body.agentSessionId,
        envelopeNonce: envelope.nonce,
        authorization,
      };
    }

    const body = verified.body;
    return {
      ...admissionIdentity,
      machineId: envelope.machineId,
      userId: envelope.userId,
      organizationId: verified.frame.organizationId,
      projectId,
      actionCategory: 'TASK_MONITOR',
      actionType:
        body.command.cause === 'START'
          ? 'TASK_MONITOR_START'
          : body.command.cause === 'RESUME'
            ? 'TASK_MONITOR_RESUME'
            : body.command.cause === 'JUDGMENT_RESOLVED'
              ? 'TASK_MONITOR_JUDGMENT_RESOLVED'
              : body.command.cause === 'CONTINUE'
                ? 'TASK_MONITOR_CONTINUE'
                : 'TASK_MONITOR_COMPLETE',
      actionPayloadHash: monitorActionHash(body, envelope.nonce),
      target: {
        kind: 'TASK_MONITOR',
        id: body.target.workItemId,
        revision: null,
      },
      taskMonitorId: body.target.workItemId,
      envelopeNonce: envelope.nonce,
      authorization,
    };
  }

  private async admitVerified(
    verified: VerifiedTriggerFrame,
    admissionLogger: ServerLogger = this.dependencies.logger,
  ): Promise<
    | {
        admitted: true;
        capability: AdmittedHostAction;
        authorization?: AdmissionEnvelopeAuthorization;
      }
    | { admitted: false; reason: string; retryable?: boolean; unboundServiceIds?: string[] }
  > {
    if (verified.kind === 'trigger.authority_reduction') {
      return { admitted: false, reason: 'acknowledged_route_required' };
    }
    if (verified.envelope.protocolVersion !== 2) {
      return { admitted: false, reason: 'protocol_version' };
    }
    const admission = this.dependencies.hostActionAdmission;
    if (!admission) {
      this.dependencies.logger.warn('trigger-verification.authority.denied', {
        reason: 'admission_not_ready',
        frameType: verified.kind,
        nonce: verified.envelope.nonce,
      });
      return { admitted: false, reason: 'admission_not_ready' };
    }
    if (!verified.envelope.authorization) {
      const isAuthorityNonIncreasing =
        (verified.kind === 'trigger.control' &&
          (verified.body.kind === 'stop_run' || verified.body.kind === 'cancel_input')) ||
        (verified.kind === 'trigger.monitor_command' &&
          (verified.body.command.cause === 'PAUSE' ||
            verified.body.command.cause === 'STOP' ||
            verified.body.command.cause === 'HALT' ||
            verified.body.command.cause === 'GUIDANCE_CHANGED' ||
            verified.body.command.cause === 'HUMAN_DECISION'));
      if (!isAuthorityNonIncreasing) {
        this.dependencies.logger.warn('trigger-verification.authority.denied', {
          reason: 'authorization_not_found',
          frameType: verified.kind,
          nonce: verified.envelope.nonce,
        });
        return { admitted: false, reason: 'authorization_not_found' };
      }
      const result = await admission.admitReduction(verified.envelope.nonce, admissionLogger);
      if (!result.admitted) {
        this.dependencies.logger.warn('trigger-verification.authority.denied', {
          reason: result.reason,
          frameType: verified.kind,
          nonce: verified.envelope.nonce,
        });
        return { admitted: false, reason: result.reason };
      }
      return { admitted: true, capability: result.capability };
    }
    const request = await this.admissionRequestFor(verified, admissionLogger);
    if (!request) return { admitted: false, reason: 'routing_mismatch' };
    if ('unavailable' in request) {
      return { admitted: false, reason: request.reason, retryable: true };
    }
    if ('unboundServiceIds' in request) {
      return {
        admitted: false,
        reason: 'service_folder_not_bound',
        unboundServiceIds: request.unboundServiceIds,
      };
    }
    const result = await admission.admit(request, admissionLogger);
    if (!result.admitted) {
      this.dependencies.logger.warn('trigger-verification.authority.denied', {
        reason: result.reason,
        frameType: verified.kind,
        nonce: verified.envelope.nonce,
      });
      return { admitted: false, reason: result.reason };
    }
    this.dependencies.logger.info('trigger-verification.authority.admitted', {
      frameType: verified.kind,
      nonce: verified.envelope.nonce,
      authorizationKind: verified.envelope.authorization.kind,
      grantId: result.grantId ?? null,
    });
    return {
      admitted: true,
      capability: result.capability,
      authorization: toAdmissionAuthorization(verified.envelope.authorization),
    };
  }

  private async dispatchVerified(
    verified: VerifiedTriggerFrame,
    capability: AdmittedHostAction,
    context?: PlatformDeliveryContext,
  ): Promise<AgentOperationDispatchAcknowledgement | void> {
    const { agentService, logger, runRegistry } = this.dependencies;
    if (verified.kind === 'trigger.authority_reduction') {
      logger.warn('trigger-verification.authority_reduction.dropped', {
        reason: 'acknowledged_route_required',
        kind: verified.body.kind,
        nonce: verified.envelope.nonce,
      });
      return;
    }
    if (verified.kind === 'trigger.application_effect') {
      const executor = this.dependencies.applicationEffectExecutor;
      if (!executor) {
        logger.warn('trigger-verification.application_effect.dropped', {
          effectId: verified.body.effectId,
          reason: 'executor_not_ready',
          nonce: verified.envelope.nonce,
        });
        return;
      }
      void executor.execute(capability, verified.body).catch((error) => {
        logger.error('trigger-verification.application_effect.failed', {
          effectId: verified.body.effectId,
          nonce: verified.envelope.nonce,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }
    if (verified.kind === 'trigger.exact_action') {
      const executor = this.dependencies.exactActionExecutor;
      if (!executor) {
        logger.warn('trigger-verification.exact_action.dropped', {
          exactActionId: verified.body.exactActionId,
          reason: 'executor_not_ready',
          nonce: verified.envelope.nonce,
        });
        return;
      }
      void executor.execute(capability, verified.body).catch((error) => {
        logger.error('trigger-verification.exact_action.failed', {
          exactActionId: verified.body.exactActionId,
          nonce: verified.envelope.nonce,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }
    if (verified.kind === 'trigger.control') {
      const body = verified.body;

      if (body.kind === 'cancel_input') {
        const projectId = verified.frame.projectId;
        if (!projectId) {
          logDropped(logger, {
            frameType: verified.kind,
            reason: 'missing_project_id',
            kind: body.kind,
            operationId: body.operationId,
            messageId: body.messageId,
            agentSessionId: body.agentSessionId,
          });
          return;
        }
        const cancelled = await agentService.inputAdmission.owner.cancel({
          key: body.operationId,
          fingerprint: body.operationFingerprint,
          agentSessionId: body.agentSessionId,
          runId:
            this.dependencies.runStore.lookupByAgentSessionId(body.agentSessionId) ??
            body.agentSessionId,
          organizationId: verified.frame.organizationId,
          projectId,
          machineId: verified.envelope.machineId,
          userId: verified.envelope.userId,
          messageId: body.messageId,
        });
        this.controlTelemetry.cancellation(cancelled, context?.transportAckAvailable ?? null);
        void agentService.inputAdmission.advance(body.agentSessionId);
        return;
      }
      if (body.kind === 'permission_decision') {
        const conversationId = verified.frame.conversationId;
        if (!conversationId) {
          logDropped(logger, {
            frameType: 'trigger.control',
            reason: 'missing_frame_conversation_id',
            kind: body.kind,
            requestId: body.requestId,
            nonce: verified.envelope.nonce,
          });
          return;
        }
        this.permissionDecisionControlDispatcher.dispatch({
          conversationId,
          sessionId: body.sessionId,
          requestId: body.requestId,
          agentType: body.agentType,
          decision: body.decision,
          reason: body.reason ?? null,
          idempotencyToken: body.idempotencyToken,
          nonce: verified.envelope.nonce,
          userId: verified.envelope.userId,
          decidedAt: new Date(verified.envelope.timestampMs).toISOString(),
          ...(verified.frame.userId ? { routingUserId: verified.frame.userId } : {}),
        });
        return;
      }

      if (body.kind === 'question_answer') {
        const conversationId = verified.frame.conversationId;
        if (!conversationId) {
          logDropped(logger, {
            frameType: 'trigger.control',
            reason: 'missing_frame_conversation_id',
            kind: body.kind,
            requestId: body.requestId,
            nonce: verified.envelope.nonce,
          });
          return;
        }
        this.questionAnswerControlDispatcher.dispatch({
          conversationId,
          sessionId: body.sessionId,
          requestId: body.requestId,
          agentType: body.agentType,
          answers: body.answers,
          idempotencyToken: body.idempotencyToken,
          nonce: verified.envelope.nonce,
          userId: verified.envelope.userId,
        });
        return;
      }

      const conversationId = body.conversationId;
      const binding = this.resolveConversationRun(conversationId);
      if (!binding) {
        // Idempotent no-op — the CLI may not have an active run for the
        // conversation (already stopped, never started here, or another
        // machine owns it). Log as warn for observability; the control branch
        // never surfaces an error to the UI.
        logger.warn('trigger-verification.control.no_active_run', {
          kind: body.kind,
          conversationId,
          runId: body.runId,
          nonce: verified.envelope.nonce,
        });
        return;
      }
      if (body.kind === 'compact_run' && binding.runId !== body.runId) {
        logDropped(logger, {
          frameType: 'trigger.control',
          reason: 'run_binding_mismatch',
          kind: body.kind,
          conversationId,
          runId: binding.runId,
          envelopeRunId: body.runId,
          nonce: verified.envelope.nonce,
        });
        return;
      }
      logger.info('trigger-verification.control.dispatch', {
        kind: body.kind,
        conversationId,
        runId: binding.runId,
        envelopeRunId: body.runId,
        nonce: verified.envelope.nonce,
      });
      const controlOperation =
        body.kind === 'compact_run'
          ? agentService.compactRun(capability, binding.runId)
          : agentService.stopRun(binding.runId);
      controlOperation
        .then(() => {
          if (body.kind === 'stop_run')
            this.controlTelemetry.stopped(
              conversationId,
              binding.runId,
              context?.transportAckAvailable ?? null,
            );
        })
        .catch((error) => {
          logger.error('trigger-verification.control.dispatch_failed', {
            kind: body.kind,
            conversationId,
            runId: binding.runId,
            nonce: verified.envelope.nonce,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    if (verified.kind === 'trigger.monitor_command') {
      void this.dependencies.taskMonitorStateMachineInputAdapter
        .admit(verified.body)
        .catch((error) => {
          logger.error('monitor-command.dispatch.failed', {
            commandId: verified.body.commandId,
            monitorId: verified.body.target.workItemId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    // trigger.conversation
    const conversationId = verified.frame.conversationId;
    if (!conversationId) {
      logDropped(logger, {
        frameType: 'trigger.conversation',
        reason: 'missing_frame_conversation_id',
        nonce: verified.envelope.nonce,
      });
      return;
    }

    // `start_run` is the only conversation-trigger variant that materializes a
    // new local Run instead of routing into an already-bound run. Idempotency
    // (duplicate envelope, retry/re-fanout) is owned by
    // `localAgentService.createRun` — it short-circuits when the persisted
    // run already exists for `payload.agentSessionId`, so the dispatcher
    // always invokes `createRun` and lets the service no-op.
    if (verified.body.promptType === START_RUN_TRIGGER_SENTINEL) {
      const bodyWithPayload = verified.body as unknown as { payload?: unknown };
      let payload: StartRunTriggerPayload;
      try {
        payload = validateTriggerPayload(
          START_RUN_TRIGGER_SENTINEL,
          bodyWithPayload.payload,
        ) as StartRunTriggerPayload;
      } catch (error) {
        logDropped(logger, {
          frameType: 'trigger.conversation',
          reason: 'payload_validation_failed',
          conversationId,
          promptType: verified.body.promptType,
          nonce: verified.envelope.nonce,
          ...describeDroppedPayload(bodyWithPayload),
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          status: 'REJECTED',
          stage: 'VERIFICATION',
          reason: 'SCHEMA_INVALID',
        } satisfies AgentOperationDispatchAcknowledgement;
      }
      const request = toCreateRunRequest(payload, conversationId);
      if (
        request.payload &&
        request.triggersAgent !== false &&
        request.payload.promptType !== 'workflow_kickoff'
      ) {
        return this.admitDurableConversation(
          verified,
          payload.agentSessionId,
          payload.agentSessionId,
          payload,
        );
      }
      const operationId = verified.body.operationId;
      const operationFingerprint = verified.body.operationFingerprint;
      const claim = await this.operationReceiptStore.claim(operationId, operationFingerprint);
      if (
        claim.disposition !== 'EXECUTE' &&
        !(claim.disposition === 'REPLAY' && claim.state === 'PROCESSING')
      ) {
        this.dependencies.operationTimeline?.recordDurationAt(
          operationId,
          'materializeOnlyAckMs',
          performance.now(),
        );
        logDropped(logger, {
          frameType: 'trigger.conversation',
          reason:
            claim.disposition === 'MISMATCH'
              ? 'operation_fingerprint_mismatch'
              : 'duplicate_agent_operation',
          conversationId,
          operationId,
          operationFingerprint,
        });
        if (claim.disposition === 'MISMATCH') {
          this.dependencies.operationTimeline?.emit(operationId, 'rejected', {
            agentSessionId: payload.agentSessionId,
            runId: payload.agentSessionId,
            promptType: verified.body.promptType,
            provider: payload.provider,
          });
          return {
            status: 'REJECTED',
            stage: 'ADMISSION',
            reason: 'OPERATION_FINGERPRINT_MISMATCH',
          } satisfies AgentOperationDispatchAcknowledgement;
        }
        this.dependencies.operationTimeline?.emit(
          operationId,
          claim.state === 'FAILED' ? 'failed' : 'no_provider_output',
          {
            agentSessionId: payload.agentSessionId,
            runId: payload.agentSessionId,
            promptType: verified.body.promptType,
            provider: payload.provider,
          },
        );
        return claim.state === 'FAILED'
          ? ({
              status: 'REJECTED',
              stage: 'EXECUTION',
              reason: 'EXECUTION_FAILED',
            } satisfies AgentOperationDispatchAcknowledgement)
          : ({
              status: 'ACCEPTED',
              operationId,
              operationFingerprint,
              replayed: true,
              inputDisposition: 'NONE',
            } satisfies AgentOperationDispatchAcknowledgement);
      }
      if (payload.runId !== undefined && payload.runId !== payload.agentSessionId) {
        // A Run's id is its Agent Session id; a distinct trigger runId never forks a second Run.
        logger.warn('trigger-verification.conversation.start_run_ignored_run_id', {
          conversationId,
          agentSessionId: payload.agentSessionId,
          ignoredRunId: payload.runId,
        });
      }
      logger.info('trigger-verification.conversation.dispatch_start_run', {
        conversationId,
        handlerPromptType: payload.handlerPromptType,
        agentSessionId: payload.agentSessionId,
        serviceIds: payload.serviceIds,
        launchServiceId: payload.launchServiceId,
        provider: payload.provider,
        fastModeProvided: payload.fastMode !== undefined,
        hasInitialPayload: request.payload !== undefined,
        requestPromptType: request.payload?.promptType,
        nonce: verified.envelope.nonce,
      });
      try {
        const materialized = await agentService.createRunFromTrigger(capability, request);
        if (materialized.status === 'repo-required')
          throw new MissingServiceBindingError(
            materialized.serviceIds,
            materialized.launchServiceId,
          );
        if (materialized.status !== 'started') {
          throw new Error('Run workspace could not be resolved.');
        }
        const boundRunId = this.dependencies.runStore.lookupByConversationId(conversationId);
        if (
          boundRunId !== materialized.run.agentic_session_id ||
          materialized.run.agentic_session_id !== payload.agentSessionId
        ) {
          throw new Error('Materialized Run is not bound to the conversation.');
        }
        await this.operationReceiptStore.complete(operationId, operationFingerprint, true);
        this.dependencies.operationTimeline?.recordDurationAt(
          operationId,
          'materializeOnlyAckMs',
          performance.now(),
        );
        this.dependencies.operationTimeline?.emit(operationId, 'no_provider_output', {
          agentSessionId: payload.agentSessionId,
          runId: payload.agentSessionId,
          promptType: verified.body.promptType,
          provider: payload.provider,
        });
        return {
          status: 'ACCEPTED',
          operationId,
          operationFingerprint,
          replayed: false,
          inputDisposition: 'NONE',
        } satisfies AgentOperationDispatchAcknowledgement;
      } catch (error) {
        await this.operationReceiptStore.complete(operationId, operationFingerprint, false);
        this.dependencies.operationTimeline?.recordDurationAt(
          operationId,
          'materializeOnlyAckMs',
          performance.now(),
        );
        this.dependencies.operationTimeline?.emit(operationId, 'failed', {
          agentSessionId: payload.agentSessionId,
          runId: payload.agentSessionId,
          promptType: verified.body.promptType,
          provider: payload.provider,
        });
        logger.error('trigger-verification.conversation.dispatch_start_run_failed', {
          conversationId,
          handlerPromptType: payload.handlerPromptType,
          agentSessionId: payload.agentSessionId,
          nonce: verified.envelope.nonce,
          error: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof MissingServiceBindingError)
          return {
            status: 'REJECTED',
            stage: 'EXECUTION',
            reason: 'SERVICE_FOLDER_NOT_BOUND',
            unboundServiceIds: error.serviceIds,
          } satisfies AgentOperationDispatchAcknowledgement;
        return {
          status: 'REJECTED',
          stage: 'EXECUTION',
          reason: 'EXECUTION_FAILED',
        } satisfies AgentOperationDispatchAcknowledgement;
      }
    }

    if (verified.body.promptType === USER_MESSAGE_TRIGGER_SENTINEL) {
      let payload: UserMessagePromptPayload;
      try {
        payload = validateUserMessageTriggerPayload(
          (verified.body as { payload: unknown }).payload,
          this.dependencies.promptTypeRegistry,
        ) as UserMessagePromptPayload;
      } catch (error) {
        logDropped(logger, {
          frameType: 'trigger.conversation',
          reason: 'payload_validation_failed',
          conversationId,
          promptType: verified.body.promptType,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          status: 'REJECTED',
          stage: 'VERIFICATION',
          reason: 'SCHEMA_INVALID',
        } satisfies AgentOperationDispatchAcknowledgement;
      }
      if (payload.taskMonitorPayload) {
        const projectId = verified.frame.projectId;
        if (!projectId) {
          return {
            status: 'REJECTED',
            stage: 'VERIFICATION',
            reason: 'SCHEMA_INVALID',
          } satisfies AgentOperationDispatchAcknowledgement;
        }
        const admission = await this.taskMonitorConversationInputAdmission.admit({
          taskMonitorId: payload.taskMonitorPayload.monitorId,
          organizationId: verified.frame.organizationId,
          projectId,
          conversationId,
          messageId: verified.body.sourceUserMessageId,
        });
        if (admission === 'rejected') {
          return {
            status: 'REJECTED',
            stage: 'ADMISSION',
            reason: 'AUTHORIZATION_REJECTED',
          } satisfies AgentOperationDispatchAcknowledgement;
        }
        return {
          status: 'ACCEPTED',
          operationId: verified.body.operationId,
          operationFingerprint: verified.body.operationFingerprint,
          replayed: admission === 'replayed',
          inputDisposition: 'NONE',
        } satisfies AgentOperationDispatchAcknowledgement;
      }
      if (payload.handlerPromptType === LocalPromptType.TaskMonitor) {
        logDropped(logger, {
          frameType: 'trigger.conversation',
          reason: 'task_monitor_payload_missing',
          conversationId,
          sourceUserMessageId: verified.body.sourceUserMessageId,
        });
        return {
          status: 'REJECTED',
          stage: 'VERIFICATION',
          reason: 'SCHEMA_INVALID',
        } satisfies AgentOperationDispatchAcknowledgement;
      }
    }

    const bindingResolution = this.conversationRunResolver.resolveForDispatch(conversationId);
    const binding =
      bindingResolution.status === 'resolved'
        ? {
            runId: bindingResolution.runId,
            conversationId: bindingResolution.conversationId,
          }
        : null;
    logger.info('trigger-verification.conversation.binding_resolved', {
      conversationId,
      hasBinding: !!binding,
      bindingStatus: bindingResolution.status,
      bindingReason:
        bindingResolution.status === 'temporarily_unavailable'
          ? bindingResolution.reason
          : undefined,
      runId: binding?.runId,
      promptType: verified.body.promptType,
      nodeId: verified.body.nodeId,
      triggerMessageId: verified.body.triggerMessageId,
      nonce: verified.envelope.nonce,
    });
    if (!binding) {
      // Connect-driven re-fan latency (plan-from-design-doc and any workflow
      // whose first turn is workflow-driven): the workflow's opening trigger
      // (e.g. plan-shaping `proposed-stages`) can arrive before the
      // materialize-only `start_run` has finished binding the Run. It is
      // dropped here as `no_active_run`. The CLI has NO mechanism to nudge a
      // platform re-fan and does NOT re-deliver the dropped trigger itself —
      // redelivery rides the platform's next connect-driven re-fan (the
      // re-fan-on-authenticate storm), so Start is not strictly instantaneous;
      // there is a sub-reconnect window of latency.
      logDropped(logger, {
        frameType: 'trigger.conversation',
        reason: 'no_active_run',
        bindingReason:
          bindingResolution.status === 'temporarily_unavailable'
            ? bindingResolution.reason
            : undefined,
        conversationId,
        nonce: verified.envelope.nonce,
        promptType: verified.body.promptType,
      });
      return;
    }
    let event: ConversationPromptEvent;
    try {
      event = validateConversationTrigger(verified.body, this.dependencies.promptTypeRegistry);
    } catch (error) {
      logDropped(logger, {
        frameType: 'trigger.conversation',
        reason: 'payload_validation_failed',
        conversationId,
        runId: binding.runId,
        promptType: verified.body.promptType,
        nonce: verified.envelope.nonce,
        ...describeDroppedPayload(verified.body as unknown as { payload?: unknown }),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const session = await this.dependencies.runStore.getRun(binding.runId);
    if (!session?.contextMetadata.agentSessionId) {
      logDropped(logger, {
        frameType: 'trigger.conversation',
        reason: 'run_missing_agent_session',
        conversationId,
        runId: binding.runId,
        promptType: verified.body.promptType,
        nonce: verified.envelope.nonce,
      });
      return;
    }
    return this.admitDurableConversation(
      verified,
      binding.runId,
      session.contextMetadata.agentSessionId,
      event.payload,
    );
  }

  /** `validatedPayload` is the event payload the wire boundary validated; storage keeps that. */
  private async admitDurableConversation(
    verified: Extract<VerifiedTriggerFrame, { kind: 'trigger.conversation' }>,
    runId: string,
    agentSessionId: string,
    validatedPayload: unknown,
  ): Promise<AgentOperationDispatchAcknowledgement | void> {
    const body = verified.body;
    const projectId = verified.frame.projectId;
    if (!projectId) {
      logDropped(this.dependencies.logger, {
        frameType: 'trigger.conversation',
        reason: 'missing_project_id',
        runId,
        promptType: body.promptType,
        nonce: verified.envelope.nonce,
      });
      return;
    }
    const operation =
      body.promptType === 'start_run' || body.promptType === 'user_message'
        ? body
        : body.inputExecution
          ? {
              ...body.inputExecution,
              sourceUserMessageId: body.inputExecution.messageId,
              triggerMessageId: body.triggerMessageId,
            }
          : null;
    const key = operation?.operationId ?? body.triggerMessageId;
    const fingerprint =
      operation?.operationFingerprint ??
      createHash('sha256').update(canonicalizeJson(body)).digest('hex');
    const accepted = await this.dependencies.agentService.inputAdmission.admitInput(
      {
        key,
        fingerprint,
        runId,
        agentSessionId,
        organizationId: verified.frame.organizationId,
        projectId,
        machineId: verified.envelope.machineId,
        userId: verified.envelope.userId,
        messageId: operation ? (operation.sourceUserMessageId ?? operation.triggerMessageId) : null,
      },
      {
        kind: 'trigger_frame',
        keyKind: operation ? 'operation' : 'trigger_message',
        payload: toStoredTriggerFrame(
          verified.frame.conversationId ?? null,
          body,
          validatedPayload,
        ),
      },
    );
    this.dependencies.operationTimeline?.mark(key, 'receiptCommitted');
    this.dependencies.operationTimeline?.updateMetadata(key, {
      agentSessionId,
      runId,
      promptType: body.promptType,
    });
    if (accepted.replayed) this.dependencies.operationTimeline?.markPartial(key);
    this.dependencies.logger.info('input_admission.accepted', {
      operationId: key,
      agentSessionId,
      runId,
      replayed: accepted.replayed,
      promptType: body.promptType,
      conversationId: verified.frame.conversationId,
    });
    return operation
      ? {
          status: 'ACCEPTED',
          operationId: operation.operationId,
          operationFingerprint: operation.operationFingerprint,
          replayed: accepted.replayed,
          inputDisposition: acknowledgedDisposition(accepted.record),
        }
      : undefined;
  }

  /** Process one upstream event. Non-trigger event types are ignored. */
  public handlePlatformEvent(
    event: PlatformWebSocketEvent,
    context?: PlatformDeliveryContext,
  ): Promise<AgentOperationDispatchAcknowledgement | void> {
    const receivedAt = new Date().toISOString();
    const receivedOrigin = performance.now();
    const { logger, verifier } = this.dependencies;
    if (!FRAME_EVENT_TYPES.has(event.type)) return Promise.resolve();

    if (!this.rateLimiter.tryConsume()) {
      // `conversationId` is read off the raw, pre-verification frame — untrusted
      // but the only correlation handle available before the verifier runs, and
      // the difference between a debuggable storm and an opaque wall of drops.
      logDropped(logger, {
        frameType: event.type,
        reason: 'rate_limit',
        conversationId: event.conversationId,
      });
      return Promise.resolve({
        status: 'REJECTED',
        stage: 'VERIFICATION',
        reason: 'SCHEMA_INVALID',
      } satisfies AgentOperationDispatchAcknowledgement);
    }

    const result = verifier.verifyTriggerFrame(event);
    if (!result.ok) {
      logDropped(logger, {
        frameType: event.type,
        reason: result.reason,
        ...result.details,
      });
      this.dropRecoverySurface.handleDrop(event, result.reason);
      return Promise.resolve({
        status: 'REJECTED',
        stage: 'VERIFICATION',
        reason: 'SCHEMA_INVALID',
      } satisfies AgentOperationDispatchAcknowledgement);
    }
    // A frame verified: the conversation is healthy again, so clear any
    // accumulated drop counters and surfaced-reason dedupe for it.
    if (typeof event.conversationId === 'string') {
      this.dropRecoverySurface.reset(event.conversationId);
    }
    const timelineIdentity = timelineIdentityFor(result.verified);
    DeterministicE2EEvidence.current()?.record('verified_delivery', {
      nonce: result.verified.envelope.nonce,
      ...(timelineIdentity ? { operationId: timelineIdentity.key } : {}),
    });
    const admissionAttempt = ++this.admissionAttempts;
    if (timelineIdentity) {
      this.dependencies.operationTimeline?.register({
        ...timelineIdentity,
        receivedAt,
        origin: receivedOrigin,
        metadata: { promptType: timelineIdentity.promptType, admissionAttempt },
      });
      this.dependencies.operationTimeline?.mark(timelineIdentity.key, 'verified');
    }
    const admissionLogger = logger.child({
      ...(timelineIdentity ? { key: timelineIdentity.key, keyKind: timelineIdentity.keyKind } : {}),
      admissionAttempt,
    });
    return this.admitVerified(result.verified, admissionLogger).then((admission) => {
      if (admission.admitted) {
        if (timelineIdentity)
          this.dependencies.operationTimeline?.mark(timelineIdentity.key, 'admitted');
        return this.dispatchVerified(result.verified, admission.capability, context)
          .then((dispatchResult) => {
            if (dispatchResult?.status === 'REJECTED' && timelineIdentity) {
              this.dependencies.operationTimeline?.emit(timelineIdentity.key, 'rejected', {
                promptType: timelineIdentity.promptType,
              });
            }
            return dispatchResult;
          })
          .catch((error) => {
            if (
              result.verified.kind === 'trigger.control' &&
              result.verified.body.kind === 'cancel_input'
            ) {
              const body = result.verified.body;
              this.controlTelemetry.cancellationFailed(
                body.operationId,
                body.messageId,
                body.agentSessionId,
              );
            }
            if (error instanceof InputAdmissionIdentityError) {
              if (timelineIdentity)
                this.dependencies.operationTimeline?.emit(timelineIdentity.key, 'rejected', {
                  promptType: timelineIdentity.promptType,
                });
              return {
                status: 'REJECTED',
                stage: 'ADMISSION',
                reason: 'OPERATION_FINGERPRINT_MISMATCH',
              } satisfies AgentOperationDispatchAcknowledgement;
            }
            throw error;
          });
      }
      // A fresh signature can reconcile a previously committed input after its
      // short-lived ingress authority expires. This returns evidence only; it cannot execute.
      return this.reconcileCommittedInput(result.verified).then((replayed) => {
        if (replayed) {
          if (timelineIdentity) {
            this.dependencies.operationTimeline?.markPartial(timelineIdentity.key);
            this.dependencies.operationTimeline?.emit(
              timelineIdentity.key,
              replayed.status === 'REJECTED' ? 'rejected' : 'no_provider_output',
              { promptType: timelineIdentity.promptType },
            );
          }
          return replayed;
        }
        if (admission.retryable) return;
        if (timelineIdentity)
          this.dependencies.operationTimeline?.emit(timelineIdentity.key, 'rejected', {
            promptType: timelineIdentity.promptType,
          });
        if (admission.unboundServiceIds)
          return {
            status: 'REJECTED',
            stage: 'ADMISSION',
            reason: 'SERVICE_FOLDER_NOT_BOUND',
            unboundServiceIds: admission.unboundServiceIds,
          } satisfies AgentOperationDispatchAcknowledgement;
        return {
          status: 'REJECTED',
          stage: 'ADMISSION',
          reason: 'AUTHORIZATION_REJECTED',
        } satisfies AgentOperationDispatchAcknowledgement;
      });
    });
  }

  private async reconcileCommittedInput(
    verified: VerifiedTriggerFrame,
  ): Promise<AgentOperationDispatchAcknowledgement | null> {
    if (verified.kind !== 'trigger.conversation') return null;
    const body = verified.body;
    const operation =
      body.promptType === 'start_run' || body.promptType === 'user_message'
        ? body
        : body.inputExecution;
    if (!operation) return null;
    const conversationId = verified.frame.conversationId;
    if (!conversationId) return null;
    // Only the resolved session's records are read; admission keys never cross sessions.
    const resolution = await this.resolveConversationAgentSessionId(
      body,
      conversationId,
      undefined,
      this.dependencies.logger,
    );
    if (resolution.status !== 'resolved') return null;
    const record = (
      await this.dependencies.agentService.inputAdmission.owner.session(resolution.agentSessionId)
    ).find((input) => input.key === operation.operationId);
    if (
      !record ||
      record.fingerprint !== operation.operationFingerprint ||
      record.organizationId !== verified.frame.organizationId ||
      record.projectId !== verified.frame.projectId ||
      record.userId !== verified.envelope.userId ||
      record.machineId !== verified.envelope.machineId
    )
      return null;
    // Compare the stored signed bytes, never a re-parse of the payload, so finished history
    // replays whatever today's wire schemas say about it.
    const original = storedSignedTriggerSchema.safeParse(record.payload);
    if (
      record.kind !== 'trigger_frame' ||
      !original.success ||
      original.data.conversationId !== verified.frame.conversationId ||
      canonicalizeJson(original.data.signedEvent) !== canonicalizeJson(body)
    )
      return null;
    return {
      status: 'ACCEPTED',
      operationId: operation.operationId,
      operationFingerprint: operation.operationFingerprint,
      replayed: true,
      inputDisposition: acknowledgedDisposition(record),
    };
  }

  private verificationRejectionReason(
    reason: VerificationDropReason,
  ): MonitorCommandAcknowledgement {
    const mapped =
      reason === 'signature_invalid' || reason === 'signature_decode'
        ? 'SIGNATURE_INVALID'
        : reason === 'machine_id_mismatch'
          ? 'MACHINE_MISMATCH'
          : reason === 'user_id_mismatch'
            ? 'OWNER_MISMATCH'
            : reason === 'timestamp_window'
              ? 'STALE'
              : reason === 'nonce_replay'
                ? 'NONCE_REPLAY'
                : reason === 'allowlist'
                  ? 'KIND_NOT_ALLOWED'
                  : reason === 'expired'
                    ? 'EXPIRED'
                    : reason === 'routing_mismatch'
                      ? 'ROUTING_MISMATCH'
                      : 'SCHEMA_INVALID';
    return {
      status: 'REJECTED',
      stage: 'VERIFICATION',
      reason: mapped,
    };
  }

  private authorityVerificationRejectionReason(
    reason: VerificationDropReason,
  ): AuthorityReductionAcknowledgement {
    const mapped =
      reason === 'signature_invalid' || reason === 'signature_decode'
        ? 'SIGNATURE_INVALID'
        : reason === 'machine_id_mismatch'
          ? 'MACHINE_MISMATCH'
          : reason === 'user_id_mismatch'
            ? 'OWNER_MISMATCH'
            : reason === 'timestamp_window'
              ? 'STALE'
              : reason === 'nonce_replay'
                ? 'NONCE_REPLAY'
                : reason === 'routing_mismatch'
                  ? 'ROUTING_MISMATCH'
                  : 'SCHEMA_INVALID';
    return { status: 'REJECTED', reason: mapped };
  }

  public async handleAuthorityReduction(
    event: PlatformWebSocketEvent,
  ): Promise<AuthorityReductionAcknowledgement> {
    const { logger, verifier, machineControllerAuthority } = this.dependencies;
    if (!this.rateLimiter.tryConsume()) {
      logDropped(logger, { frameType: event.type, reason: 'rate_limit' });
      return { status: 'REJECTED', reason: 'SCHEMA_INVALID' };
    }
    const result = verifier.verifyTriggerFrame(event);
    if (!result.ok) {
      logDropped(logger, {
        frameType: event.type,
        reason: result.reason,
        ...result.details,
      });
      return this.authorityVerificationRejectionReason(result.reason);
    }
    if (result.verified.kind !== 'trigger.authority_reduction') {
      return { status: 'REJECTED', reason: 'SCHEMA_INVALID' };
    }
    if (!machineControllerAuthority) {
      logger.error('trigger-verification.authority_reduction.handler_unavailable', {
        kind: result.verified.body.kind,
        nonce: result.verified.envelope.nonce,
      });
      return { status: 'REJECTED', reason: 'HANDLER_UNAVAILABLE' };
    }
    try {
      await machineControllerAuthority.applyVerifiedAuthorityReduction(result.verified.envelope);
      logger.info('trigger-verification.authority_reduction.applied', {
        kind: result.verified.body.kind,
        machineId: result.verified.envelope.machineId,
        nonce: result.verified.envelope.nonce,
      });
      return { status: 'APPLIED', nonce: result.verified.envelope.nonce };
    } catch (error) {
      logger.error('trigger-verification.authority_reduction.persistence_failed', {
        kind: result.verified.body.kind,
        machineId: result.verified.envelope.machineId,
        nonce: result.verified.envelope.nonce,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 'REJECTED', reason: 'PERSISTENCE_FAILED' };
    }
  }

  public async handleMonitorCommand(
    event: PlatformWebSocketEvent,
  ): Promise<MonitorCommandAcknowledgement> {
    const { logger, verifier } = this.dependencies;
    if (!this.rateLimiter.tryConsume()) {
      logDropped(logger, {
        frameType: event.type,
        reason: 'rate_limit',
      });
      return {
        status: 'REJECTED',
        stage: 'VERIFICATION',
        reason: 'SCHEMA_INVALID',
        message: 'The monitor-command verification rate limit was exceeded.',
      };
    }
    const result = verifier.verifyTriggerFrame(event);
    if (!result.ok) {
      logDropped(logger, {
        frameType: event.type,
        reason: result.reason,
        ...result.details,
      });
      return this.verificationRejectionReason(result.reason);
    }
    if (result.verified.kind !== 'trigger.monitor_command') {
      return {
        status: 'REJECTED',
        stage: 'VERIFICATION',
        reason: 'KIND_NOT_ALLOWED',
      };
    }
    const admission = await this.admitVerified(result.verified);
    if (!admission.admitted) {
      return {
        status: 'REJECTED',
        stage: 'ADMISSION',
        reason: 'ROUTE_REJECTED',
        message: 'The local controller did not admit this monitor command.',
      };
    }
    logger.info('monitor-command.verified', {
      commandId: result.verified.body.commandId,
      monitorId: result.verified.body.target.workItemId,
      cause: result.verified.body.command.cause,
      nonce: result.verified.envelope.nonce,
    });
    return this.dependencies.taskMonitorStateMachineInputAdapter.admit(result.verified.body);
  }
}
