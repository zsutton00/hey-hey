import type { ConversationControlCancelInput } from '../../shared/api/generated/api';
/**
 * Trigger-frame verification pipeline.
 *
 * Implements the ordered checks from the CLI Channel Security design doc:
 * schema validation → signature → machineId → userId → timestamp → nonce →
 * frame-type/kind allowlist. Any failure returns a structured drop result;
 * the caller emits an audit-log entry and discards the frame silently.
 */

import crypto from 'node:crypto';

import type {
  AgentTrigger,
  ConversationControlCompactRun,
  ConversationControlPermissionDecision,
  ConversationControlQuestionAnswer,
  ConversationControlStopRun,
  SignedCliReadEnvelope,
  SignedConversationControlEnvelope,
  SignedConversationTriggerEnvelope,
  SignedMonitorCommandEnvelope,
  MonitorCommandBody1 as MonitorCommandBody,
} from '../../shared/agent-bridge-contract/generated/api';
import type {
  CliReadEnvelopeBody,
  CliSettingsEnvelopeBody,
  SignedCliSettingsEnvelope,
  MachineRevocationReductionBodyDto,
  SignedAuthorityReductionEnvelope,
  SignedControllerRevocationReductionEnvelope,
} from '../../shared/api/generated/api';
import type { ExecutableEnvelopeAuthorization } from '../controller-authorization/types';
import {
  cliReadFrameV2Schema,
  triggerControlFrameV2Schema,
  triggerControlReductionFrameV2Schema,
  triggerControlReductionEventFrameV2Schema,
  triggerAuthorityReductionFrameV2Schema,
  triggerConversationFrameV2Schema,
  triggerMonitorCommandFrameV2Schema,
  triggerMonitorAuthorityNeutralFrameV2Schema,
  triggerMonitorReductionFrameV2Schema,
  triggerMonitorReductionEventFrameV2Schema,
  triggerApplicationEffectFrameV2Schema,
  triggerExactActionFrameV2Schema,
  type ControllerAuthorizedSignedConversationControlEnvelopeV2,
  type ControllerAuthorizedSignedConversationTriggerEnvelope,
  type ControllerAuthorizedSignedMonitorCommandEnvelopeV2,
  type SignedMonitorAuthorityNeutralEnvelopeV2,
  type ApplicationEffectLaunchBodyV2,
  type ExactActionDeliveryBodyV2,
} from './protocol-v2';

/**
 * Closed `kind`-discriminated body wrapped by
 * `SignedConversationControlEnvelope` — the `stop_run`, `compact_run`,
 * `permission_decision`, and `question_answer` variants; the discriminated
 * union widens as further control kinds are defined.
 */
type ConversationControlBody =
  | ConversationControlStopRun
  | ConversationControlCancelInput
  | ConversationControlCompactRun
  | ConversationControlPermissionDecision
  | ConversationControlQuestionAnswer;

type VerifiedConversationEnvelope = SignedConversationTriggerEnvelope & {
  protocolVersion?: 2;
  authorization?: ExecutableEnvelopeAuthorization;
};
type VerifiedControlEnvelope = SignedConversationControlEnvelope & {
  protocolVersion?: 2;
  authorization?: ExecutableEnvelopeAuthorization;
};
type VerifiedMonitorEnvelope = SignedMonitorCommandEnvelope & {
  protocolVersion?: 2;
  authorization?: ExecutableEnvelopeAuthorization;
};
type VerifiedReadEnvelope = SignedCliReadEnvelope & {
  protocolVersion?: 2;
  authorization?: ExecutableEnvelopeAuthorization;
};
type VerifiedSettingsEnvelope = SignedCliSettingsEnvelope & {
  protocolVersion: 2;
  authorization: ExecutableEnvelopeAuthorization;
};
type VerifiedAuthorityEnvelope = SignedAuthorityReductionEnvelope;
type VerifiedApplicationEnvelope = {
  machineId: string;
  userId: string;
  nonce: string;
  timestampMs: number;
  signature: string;
  protocolVersion: 2;
  authorization: ExecutableEnvelopeAuthorization;
  event: ApplicationEffectLaunchBodyV2;
};
type VerifiedExactActionEnvelope = {
  machineId: string;
  userId: string;
  nonce: string;
  timestampMs: number;
  signature: string;
  protocolVersion: 2;
  authorization: ExecutableEnvelopeAuthorization;
  event: ExactActionDeliveryBodyV2;
};
import type { ServerLogger } from '../logger';
import { canonicalizeJson } from './jcs';
import { NonceStore } from './nonce-store';
import {
  cliReadFrameSchema,
  triggerControlFrameSchema,
  triggerConversationFrameSchema,
  triggerMonitorCommandFrameSchema,
  cliSettingsFrameSchema,
  signedCliSettingsEnvelopeSchema,
} from './schemas';

const cliSettingsFrameV2Schema = cliSettingsFrameSchema.extend({
  organizationId: cliReadFrameV2Schema.shape.organizationId,
  projectId: cliReadFrameV2Schema.shape.projectId,
  conversationId: cliReadFrameV2Schema.shape.conversationId,
  userId: cliReadFrameV2Schema.shape.userId,
  envelope: cliReadFrameV2Schema.shape.envelope.extend({
    event: signedCliSettingsEnvelopeSchema.shape.event,
  }),
});

/**
 * Per-promptType acceptance decision for `trigger.conversation` frames, keyed
 * by every member of the generated `AgentTrigger` discriminated union.
 *
 * Typing this as `Record<AgentTrigger['promptType'], boolean>` makes the map
 * stay in lockstep with the wire contract by construction: when codegen adds
 * a new `AgentTrigger` member this object fails to compile until a `true`
 * (accept on this channel) or `false` (handled elsewhere — reject here)
 * decision is recorded, and a typo'd key is rejected as an excess property.
 * That is what closes the silent-drift gotcha — a new conversation prompt
 * type can no longer be dropped just because a hand-maintained list forgot it.
 *
 * `false` is reserved for prompt types that share this wire union but are not
 * dispatched as direct `trigger.conversation` frames. `session_monitor` is the
 * lone case today: it is launched as a short-lived run via the `start_run`
 * envelope — its `SessionMonitorPromptPayload` rides in the start-run payload
 * union (`RunCreatePayload`) and is dispatched to the registered
 * `session_monitor` handler — never as a bare direct conversation trigger, so
 * the direct-frame channel must reject it.
 */
const CONVERSATION_PROMPT_TYPE_ACCEPTANCE: Record<AgentTrigger['promptType'], boolean> = {
  feature_sync_analyze: true,
  feature_sync_iterate: true,
  feature_tree_conversation: true,
  implement: true,
  plan_shaping_feature_sync_analyze: true,
  plan_shaping_feature_sync_iterate: true,
  plan_shaping_finalize: true,
  plan_shaping_phase_breakdown: true,
  plan_shaping_proposed_stages: true,
  plan_shaping_refine_stage: true,
  plan_shaping_step_review: true,
  work_tracker_connect: true,
  work_tracker_import: true,
  repository_grounding: true,
  repository_feature_enrichment: true,
  repository_first_work: true,
  repository_placement: true,
  plan_shaping_visual_preview: true,
  session_monitor: false,
  start_run: true,
  startup_session: true,
  user_message: true,
};

/** Accepted `trigger.conversation` promptTypes, derived from the map above. */
const CONVERSATION_PROMPT_TYPE_ALLOWLIST = new Set<string>(
  Object.entries(CONVERSATION_PROMPT_TYPE_ACCEPTANCE)
    .filter(([, accepted]) => accepted)
    .map(([promptType]) => promptType),
);

/**
 * Allowed `ConversationControlBody.kind` values for `trigger.control`. Kept
 * intentionally distinct from the conversation prompt-type allowlist —
 * control kinds and prompt types do not share namespace.
 */
const CONTROL_KIND_ALLOWLIST = new Set<string>([
  'stop_run',
  'cancel_input',
  'compact_run',
  'permission_decision',
  'question_answer',
]);

/** Timestamp freshness window in milliseconds. ±30s per the design doc. */
export const TIMESTAMP_WINDOW_MS = 30_000;

export type VerificationDropReason =
  | 'unknown_frame_type'
  | 'schema'
  | 'signature_decode'
  | 'public_key_decode'
  | 'signature_invalid'
  | 'machine_id_mismatch'
  | 'user_id_mismatch'
  | 'timestamp_window'
  | 'nonce_replay'
  | 'allowlist'
  | 'expired'
  | 'routing_mismatch'
  | 'protocol_version'
  | 'authorization_schema';

export type VerifiedTriggerFrame =
  | {
      kind: 'trigger.authority_reduction';
      frame: { organizationId: string; userId?: string };
      envelope: VerifiedAuthorityEnvelope;
      body:
        | SignedControllerRevocationReductionEnvelope['event']
        | MachineRevocationReductionBodyDto;
    }
  | {
      kind: 'trigger.conversation';
      frame: {
        conversationId?: string;
        organizationId: string;
        projectId?: string;
        userId?: string;
      };
      envelope: VerifiedConversationEnvelope;
      body: AgentTrigger;
    }
  | {
      kind: 'trigger.control';
      frame: {
        conversationId?: string;
        organizationId: string;
        projectId?: string;
        userId?: string;
      };
      envelope: VerifiedControlEnvelope;
      body: ConversationControlBody;
    }
  | {
      kind: 'trigger.monitor_command';
      frame: { organizationId: string; projectId: string; userId?: string };
      envelope: VerifiedMonitorEnvelope;
      body: MonitorCommandBody;
    }
  | {
      kind: 'trigger.application_effect';
      frame: {
        organizationId: string;
        projectId?: string;
        conversationId?: string;
        userId?: string;
      };
      envelope: VerifiedApplicationEnvelope;
      body: ApplicationEffectLaunchBodyV2;
    }
  | {
      kind: 'trigger.exact_action';
      frame: {
        organizationId: string;
        projectId?: string;
        conversationId?: string;
        userId?: string;
      };
      envelope: VerifiedExactActionEnvelope;
      body: ExactActionDeliveryBodyV2;
    };

export type VerifyResult =
  | { ok: true; verified: VerifiedTriggerFrame }
  | {
      ok: false;
      reason: VerificationDropReason;
      details: Record<string, unknown>;
    };

const schemaDrop = (
  frameType: string,
  error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> },
): Extract<VerifyResult, { ok: false }> => ({
  ok: false,
  reason: 'schema',
  details: {
    frameType,
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  },
});

export type VerifiedCliReadFrame = {
  frame: { conversationId?: string; organizationId: string; projectId?: string; userId?: string };
  envelope: VerifiedReadEnvelope;
  body: CliReadEnvelopeBody;
};

export type VerifiedCliSettingsFrame = {
  frame: { conversationId?: string; organizationId: string; projectId?: string; userId?: string };
  envelope: VerifiedSettingsEnvelope;
  body: CliSettingsEnvelopeBody;
};

export type VerifyCliReadResult =
  | { ok: true; verified: VerifiedCliReadFrame }
  | { ok: false; reason: VerificationDropReason; details: Record<string, unknown> };

export interface TriggerVerifierDependencies {
  /** Raw 32-byte Ed25519 server signing public key. */
  serverSigningPublicKey: Buffer;
  /** This CLI's registered machineId. */
  expectedMachineId: string;
  /** The owner user id derived from the registered access token. */
  expectedUserId: string;
  /** The organization bound to the activated controller, when available. */
  expectedOrganizationId?: string;
  /** Production enables this to cut over executable ingress to protocol 2. */
  requireProtocolVersion2?: boolean;
  /** Time source, injectable for tests. */
  now?: () => number;
  logger: ServerLogger;
}

const ED25519_SPKI_DER_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

/**
 * Wrap the raw 32-byte Ed25519 public key in the SubjectPublicKeyInfo DER
 * structure Node's `crypto.createPublicKey` accepts. The server delivers the
 * raw key at pairing, so the wrap happens once on the verifier hot path.
 */
const rawEd25519PublicKeyToKeyObject = (raw: Buffer): crypto.KeyObject => {
  if (raw.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes; got ${String(raw.length)}`);
  }
  const spki = Buffer.concat([ED25519_SPKI_DER_PREFIX, raw]);
  return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
};

const reconstructCanonicalBytes = (envelope: {
  machineId: string;
  userId: string;
  nonce: string;
  timestampMs: number;
  event: unknown;
  protocolVersion?: 2;
  authorization?: ExecutableEnvelopeAuthorization;
  controllerCredentialId?: string;
}): Buffer => {
  const { machineId, userId, nonce, timestampMs, event } = envelope;
  const canonical =
    'protocolVersion' in envelope
      ? canonicalizeJson({
          ...('authorization' in envelope ? { authorization: envelope.authorization } : {}),
          ...('controllerCredentialId' in envelope
            ? { controllerCredentialId: envelope.controllerCredentialId }
            : {}),
          event,
          machineId,
          nonce,
          protocolVersion: envelope.protocolVersion,
          timestampMs,
          userId,
        })
      : canonicalizeJson({ event, machineId, userId, nonce, timestampMs });
  return Buffer.from(canonical, 'utf8');
};

const decodeBase64 = (value: string): Buffer | null => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 === 1) return null;
  const buf = Buffer.from(value, 'base64');
  if (buf.length === 0 || buf.toString('base64') !== value) return null;
  return buf;
};

export class TriggerVerifier {
  private readonly now: () => number;
  private readonly nonceStore: NonceStore;
  private publicKeyObject: crypto.KeyObject;
  private expectedMachineId: string;
  private readonly requireProtocolVersion2: boolean;

  private readonly expectedOrganizationId: string | undefined;

  public constructor(private readonly dependencies: TriggerVerifierDependencies) {
    this.now = dependencies.now ?? (() => Date.now());
    this.requireProtocolVersion2 = dependencies.requireProtocolVersion2 ?? false;
    this.expectedOrganizationId = dependencies.expectedOrganizationId;
    this.nonceStore = new NonceStore({ ttlMs: TIMESTAMP_WINDOW_MS, now: this.now });
    try {
      this.publicKeyObject = rawEd25519PublicKeyToKeyObject(dependencies.serverSigningPublicKey);
    } catch (error) {
      throw new Error(
        `TriggerVerifier: invalid server signing public key — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.expectedMachineId = dependencies.expectedMachineId;
  }

  private checkV2FrameAddressing(
    frame: {
      organizationId: string;
      projectId?: string | undefined;
      conversationId?: string | undefined;
      userId?: string | undefined;
    },
    envelope: { userId: string },
    expectedProjectId?: string,
    expectedConversationId?: string,
  ): Extract<VerifyResult, { ok: false }> | null {
    if (this.expectedOrganizationId && frame.organizationId !== this.expectedOrganizationId) {
      return { ok: false, reason: 'routing_mismatch', details: { frameType: 'protocol_v2' } };
    }
    if (frame.userId !== undefined && frame.userId !== envelope.userId) {
      return { ok: false, reason: 'routing_mismatch', details: { frameType: 'protocol_v2' } };
    }
    if (expectedProjectId !== undefined && frame.projectId !== expectedProjectId) {
      return { ok: false, reason: 'routing_mismatch', details: { frameType: 'protocol_v2' } };
    }
    if (expectedConversationId !== undefined && frame.conversationId !== expectedConversationId) {
      return { ok: false, reason: 'routing_mismatch', details: { frameType: 'protocol_v2' } };
    }
    return null;
  }

  private runCommonChecks(
    frameType:
      | 'trigger.conversation'
      | 'trigger.control'
      | 'trigger.control_reduction'
      | 'trigger.authority_reduction'
      | 'trigger.monitor_command'
      | 'trigger.monitor_reduction'
      | 'trigger.application_effect'
      | 'trigger.exact_action'
      | 'cli.read.request'
      | 'cli.settings.request',
    envelope: {
      machineId: string;
      userId: string;
      nonce: string;
      timestampMs: number;
      signature: string;
      event: unknown;
      protocolVersion?: 2;
      authorization?: ExecutableEnvelopeAuthorization;
      controllerCredentialId?: string;
    },
  ): Extract<VerifyResult, { ok: false }> | null {
    // 2. Signature verification.
    const signatureBytes = decodeBase64(envelope.signature);
    if (!signatureBytes) {
      return {
        ok: false,
        reason: 'signature_decode',
        details: { frameType, machineId: envelope.machineId, nonce: envelope.nonce },
      };
    }
    const canonicalBytes = reconstructCanonicalBytes(envelope);
    let signatureValid: boolean;
    try {
      signatureValid = crypto.verify(null, canonicalBytes, this.publicKeyObject, signatureBytes);
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      const canonicalSha256 = crypto.createHash('sha256').update(canonicalBytes).digest('hex');
      this.dependencies.logger.warn('trigger-verification.signature_invalid', {
        frameType,
        machineId: envelope.machineId,
        nonce: envelope.nonce,
        timestampMs: envelope.timestampMs,
        signatureLen: signatureBytes.length,
        canonicalLen: canonicalBytes.length,
        canonicalSha256,
      });
      return {
        ok: false,
        reason: 'signature_invalid',
        details: { frameType, machineId: envelope.machineId, nonce: envelope.nonce },
      };
    }

    // 3. machineId binding.
    if (envelope.machineId !== this.expectedMachineId) {
      return {
        ok: false,
        reason: 'machine_id_mismatch',
        details: {
          frameType,
          envelopeMachineId: envelope.machineId,
          expectedMachineId: this.expectedMachineId,
          nonce: envelope.nonce,
        },
      };
    }

    // 4. userId binding.
    if (envelope.userId !== this.dependencies.expectedUserId) {
      return {
        ok: false,
        reason: 'user_id_mismatch',
        details: {
          frameType,
          envelopeUserId: envelope.userId,
          expectedUserId: this.dependencies.expectedUserId,
          nonce: envelope.nonce,
        },
      };
    }

    // 5. Timestamp freshness.
    const currentTime = this.now();
    const drift = Math.abs(currentTime - envelope.timestampMs);
    if (drift > TIMESTAMP_WINDOW_MS) {
      return {
        ok: false,
        reason: 'timestamp_window',
        details: {
          frameType,
          timestampMs: envelope.timestampMs,
          currentMs: currentTime,
          driftMs: drift,
          windowMs: TIMESTAMP_WINDOW_MS,
          nonce: envelope.nonce,
        },
      };
    }

    // 6. Nonce uniqueness (replay protection).
    if (!this.nonceStore.recordIfFresh(envelope.nonce)) {
      return {
        ok: false,
        reason: 'nonce_replay',
        details: { frameType, nonce: envelope.nonce, machineId: envelope.machineId },
      };
    }

    return null;
  }

  public verifyTriggerFrame(rawFrame: unknown): VerifyResult {
    const frameType =
      typeof rawFrame === 'object' && rawFrame !== null
        ? (rawFrame as { type?: unknown }).type
        : undefined;
    if (
      frameType !== 'trigger.conversation' &&
      frameType !== 'trigger.control' &&
      frameType !== 'trigger.control_reduction' &&
      frameType !== 'trigger.authority_reduction' &&
      frameType !== 'trigger.monitor_command' &&
      frameType !== 'trigger.monitor_reduction' &&
      frameType !== 'trigger.application_effect' &&
      frameType !== 'trigger.exact_action'
    ) {
      return {
        ok: false,
        reason: 'unknown_frame_type',
        details: { frameType: typeof frameType === 'string' ? frameType : null },
      };
    }

    const rawEnvelope =
      typeof rawFrame === 'object' &&
      rawFrame !== null &&
      'envelope' in rawFrame &&
      typeof rawFrame.envelope === 'object' &&
      rawFrame.envelope !== null
        ? (rawFrame.envelope as { protocolVersion?: unknown })
        : undefined;
    if (this.requireProtocolVersion2 && rawEnvelope?.protocolVersion !== 2) {
      return { ok: false, reason: 'protocol_version', details: { frameType } };
    }

    if (rawEnvelope?.protocolVersion === 2) {
      if (frameType === 'trigger.conversation') {
        const parsed = triggerConversationFrameV2Schema.safeParse(rawFrame);
        if (!parsed.success) return schemaDrop(frameType, parsed.error);
        const envelope = parsed.data
          .envelope as ControllerAuthorizedSignedConversationTriggerEnvelope;
        const common = this.runCommonChecks(frameType, envelope);
        if (common) return common;
        const addressing = this.checkV2FrameAddressing(parsed.data, envelope);
        if (addressing) return addressing;
        const body = envelope.event as AgentTrigger;
        if (!CONVERSATION_PROMPT_TYPE_ALLOWLIST.has(body.promptType)) {
          return {
            ok: false,
            reason: 'allowlist',
            details: { frameType, promptType: body.promptType, nonce: envelope.nonce },
          };
        }
        return {
          ok: true,
          verified: {
            kind: 'trigger.conversation',
            frame: {
              organizationId: parsed.data.organizationId,
              ...(parsed.data.projectId !== undefined ? { projectId: parsed.data.projectId } : {}),
              ...(parsed.data.conversationId !== undefined
                ? { conversationId: parsed.data.conversationId }
                : {}),
            },
            envelope: envelope as VerifiedConversationEnvelope,
            body,
          },
        };
      }

      if (frameType === 'trigger.authority_reduction') {
        const authorityReduction = triggerAuthorityReductionFrameV2Schema.safeParse(rawFrame);
        if (!authorityReduction.success) {
          return schemaDrop(frameType, authorityReduction.error);
        }
        const envelope = authorityReduction.data.envelope as VerifiedAuthorityEnvelope;
        const common = this.runCommonChecks(frameType, envelope);
        if (common) return common;
        const addressing = this.checkV2FrameAddressing(authorityReduction.data, envelope);
        if (addressing) return addressing;
        if (
          envelope.event.machineId !== envelope.machineId ||
          ('controllerCredentialId' in envelope &&
            (envelope.event.kind !== 'controller_revocation_reduction' ||
              envelope.event.controllerCredentialId !== envelope.controllerCredentialId))
        ) {
          return {
            ok: false,
            reason: 'routing_mismatch',
            details: { frameType, nonce: envelope.nonce },
          };
        }
        return {
          ok: true,
          verified: {
            kind: 'trigger.authority_reduction',
            frame: {
              organizationId: authorityReduction.data.organizationId,
              ...(authorityReduction.data.userId !== undefined
                ? { userId: authorityReduction.data.userId }
                : {}),
            },
            envelope,
            body: envelope.event,
          },
        };
      }

      if (frameType === 'trigger.control' || frameType === 'trigger.control_reduction') {
        const reductionSchema =
          frameType === 'trigger.control_reduction'
            ? triggerControlReductionEventFrameV2Schema
            : triggerControlReductionFrameV2Schema;
        const reduction = reductionSchema.safeParse(rawFrame);
        if (reduction.success) {
          const envelope = reduction.data.envelope as SignedConversationControlEnvelope & {
            protocolVersion: 2;
          };
          const common = this.runCommonChecks(frameType, envelope);
          if (common) return common;
          const reductionBody = envelope.event as ConversationControlBody;
          const addressing = this.checkV2FrameAddressing(
            reduction.data,
            envelope,
            undefined,
            'conversationId' in reductionBody ? reductionBody.conversationId : undefined,
          );
          if (addressing) return addressing;
          return {
            ok: true,
            verified: {
              kind: 'trigger.control',
              frame: {
                organizationId: reduction.data.organizationId,
                ...(reduction.data.projectId !== undefined
                  ? { projectId: reduction.data.projectId }
                  : {}),
                ...(reduction.data.conversationId !== undefined
                  ? { conversationId: reduction.data.conversationId }
                  : {}),
              },
              envelope: envelope as VerifiedControlEnvelope,
              body: envelope.event as ConversationControlBody,
            },
          };
        }
        const parsed = triggerControlFrameV2Schema.safeParse(rawFrame);
        if (!parsed.success) return schemaDrop(frameType, parsed.error);
        const envelope = parsed.data
          .envelope as ControllerAuthorizedSignedConversationControlEnvelopeV2;
        const common = this.runCommonChecks(frameType, envelope);
        if (common) return common;
        const controlBody = envelope.event as ConversationControlBody;
        const addressing = this.checkV2FrameAddressing(
          parsed.data,
          envelope,
          undefined,
          'conversationId' in controlBody ? controlBody.conversationId : undefined,
        );
        if (addressing) return addressing;
        return {
          ok: true,
          verified: {
            kind: 'trigger.control',
            frame: {
              organizationId: parsed.data.organizationId,
              ...(parsed.data.projectId !== undefined ? { projectId: parsed.data.projectId } : {}),
              ...(parsed.data.conversationId !== undefined
                ? { conversationId: parsed.data.conversationId }
                : {}),
            },
            envelope: envelope as VerifiedControlEnvelope,
            body: envelope.event as ConversationControlBody,
          },
        };
      }

      if (frameType === 'trigger.monitor_command' || frameType === 'trigger.monitor_reduction') {
        if (frameType === 'trigger.monitor_command') {
          const neutral = triggerMonitorAuthorityNeutralFrameV2Schema.safeParse(rawFrame);
          if (neutral.success) {
            const rawEnvelope = neutral.data.envelope as SignedMonitorAuthorityNeutralEnvelopeV2;
            const common = this.runCommonChecks(frameType, rawEnvelope);
            if (common) return common;
            const addressing = this.checkV2FrameAddressing(
              neutral.data,
              rawEnvelope,
              rawEnvelope.event.projectId,
            );
            if (addressing) return addressing;
            const normalizedEvent = {
              ...rawEnvelope.event,
              version: 1,
              kind: 'task_monitor_command',
            } as MonitorCommandBody;
            const envelope: VerifiedMonitorEnvelope = {
              ...rawEnvelope,
              event: normalizedEvent,
            };
            return {
              ok: true,
              verified: {
                kind: 'trigger.monitor_command',
                frame: {
                  organizationId: neutral.data.organizationId,
                  projectId: neutral.data.projectId,
                },
                envelope,
                body: normalizedEvent,
              },
            };
          }
        }
        const reductionSchema =
          frameType === 'trigger.monitor_reduction'
            ? triggerMonitorReductionEventFrameV2Schema
            : triggerMonitorReductionFrameV2Schema;
        const reduction = reductionSchema.safeParse(rawFrame);
        if (reduction.success) {
          const rawEnvelope = reduction.data.envelope;
          const common = this.runCommonChecks(frameType, rawEnvelope);
          if (common) return common;
          const addressing = this.checkV2FrameAddressing(
            reduction.data,
            rawEnvelope,
            rawEnvelope.event.projectId,
          );
          if (addressing) return addressing;
          const normalizedEvent = {
            ...rawEnvelope.event,
            version: 1,
            kind: 'task_monitor_command',
          } as MonitorCommandBody;
          const envelope: VerifiedMonitorEnvelope = {
            ...rawEnvelope,
            event: normalizedEvent,
          };
          return {
            ok: true,
            verified: {
              kind: 'trigger.monitor_command',
              frame: {
                organizationId: reduction.data.organizationId,
                projectId: reduction.data.projectId,
              },
              envelope,
              body: normalizedEvent,
            },
          };
        }
        const parsed = triggerMonitorCommandFrameV2Schema.safeParse(rawFrame);
        if (!parsed.success) return schemaDrop(frameType, parsed.error);
        const envelope = parsed.data.envelope as ControllerAuthorizedSignedMonitorCommandEnvelopeV2;
        const common = this.runCommonChecks(frameType, envelope);
        if (common) return common;
        const addressing = this.checkV2FrameAddressing(
          parsed.data,
          envelope,
          envelope.event.projectId,
        );
        if (addressing) return addressing;
        const body = {
          ...envelope.event,
          version: 1,
          kind: 'task_monitor_command',
        } as MonitorCommandBody;
        const verifiedEnvelope: VerifiedMonitorEnvelope = { ...envelope, event: body };
        return {
          ok: true,
          verified: {
            kind: 'trigger.monitor_command',
            frame: { organizationId: parsed.data.organizationId, projectId: parsed.data.projectId },
            envelope: verifiedEnvelope,
            body,
          },
        };
      }

      if (frameType === 'trigger.application_effect') {
        const parsed = triggerApplicationEffectFrameV2Schema.safeParse(rawFrame);
        if (!parsed.success) return schemaDrop(frameType, parsed.error);
        const envelope = parsed.data.envelope as VerifiedApplicationEnvelope;
        const common = this.runCommonChecks(frameType, envelope);
        if (common) return common;
        const addressing = this.checkV2FrameAddressing(parsed.data, envelope);
        if (addressing) return addressing;
        return {
          ok: true,
          verified: {
            kind: 'trigger.application_effect',
            frame: {
              organizationId: parsed.data.organizationId,
              ...(parsed.data.projectId !== undefined ? { projectId: parsed.data.projectId } : {}),
              ...(parsed.data.conversationId !== undefined
                ? { conversationId: parsed.data.conversationId }
                : {}),
            },
            envelope,
            body: envelope.event,
          },
        };
      }

      const parsed = triggerExactActionFrameV2Schema.safeParse(rawFrame);
      if (!parsed.success) return schemaDrop(frameType, parsed.error);
      const envelope = parsed.data.envelope as VerifiedExactActionEnvelope;
      const common = this.runCommonChecks(frameType, envelope);
      if (common) return common;
      const addressing = this.checkV2FrameAddressing(parsed.data, envelope);
      if (addressing) return addressing;
      return {
        ok: true,
        verified: {
          kind: 'trigger.exact_action',
          frame: {
            organizationId: parsed.data.organizationId,
            ...(parsed.data.projectId !== undefined ? { projectId: parsed.data.projectId } : {}),
            ...(parsed.data.conversationId !== undefined
              ? { conversationId: parsed.data.conversationId }
              : {}),
          },
          envelope,
          body: envelope.event,
        },
      };

      return {
        ok: false,
        reason: 'schema',
        details: { frameType, issues: [{ path: '', message: 'Unsupported protocol-v2 frame.' }] },
      };
    }

    if (frameType === 'trigger.monitor_command') {
      const parsed = triggerMonitorCommandFrameSchema.safeParse(rawFrame);
      if (!parsed.success) {
        return {
          ok: false,
          reason: 'schema',
          details: {
            frameType,
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        };
      }
      const frame = parsed.data;
      const envelope = frame.envelope as unknown as SignedMonitorCommandEnvelope;
      const common = this.runCommonChecks(frameType, envelope);
      if (common) return common;
      const body = envelope.event;
      if (body.kind !== 'task_monitor_command') {
        return {
          ok: false,
          reason: 'allowlist',
          details: { frameType, bodyKind: body.kind, nonce: envelope.nonce },
        };
      }
      if (
        frame.organizationId !== body.organizationId ||
        frame.projectId !== body.projectId ||
        (frame.userId !== undefined && frame.userId !== envelope.userId)
      ) {
        return {
          ok: false,
          reason: 'routing_mismatch',
          details: {
            frameType,
            commandId: body.commandId,
            nonce: envelope.nonce,
          },
        };
      }
      if (Date.parse(body.expiresAt) <= this.now()) {
        return {
          ok: false,
          reason: 'expired',
          details: {
            frameType,
            commandId: body.commandId,
            expiresAt: body.expiresAt,
            nonce: envelope.nonce,
          },
        };
      }
      return {
        ok: true,
        verified: {
          kind: 'trigger.monitor_command',
          frame: {
            organizationId: frame.organizationId,
            projectId: frame.projectId,
            ...(frame.userId !== undefined ? { userId: frame.userId } : {}),
          },
          envelope,
          body,
        },
      };
    }

    if (frameType === 'trigger.control') {
      // 1. Schema validation (strict).
      const parsed = triggerControlFrameSchema.safeParse(rawFrame);
      if (!parsed.success) {
        return {
          ok: false,
          reason: 'schema',
          details: {
            frameType,
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        };
      }
      const frame = parsed.data;
      const envelope = frame.envelope as unknown as SignedConversationControlEnvelope;
      const common = this.runCommonChecks(frameType, envelope);
      if (common) return common;

      // 7. Allowlist — distinct from the conversation prompt-type allowlist.
      const body = envelope.event;
      if (!CONTROL_KIND_ALLOWLIST.has(body.kind)) {
        return {
          ok: false,
          reason: 'allowlist',
          details: { frameType, bodyKind: body.kind, nonce: envelope.nonce },
        };
      }
      return {
        ok: true,
        verified: {
          kind: 'trigger.control',
          frame: {
            organizationId: frame.organizationId,
            ...(frame.projectId !== undefined ? { projectId: frame.projectId } : {}),
            ...(frame.conversationId !== undefined ? { conversationId: frame.conversationId } : {}),
          },
          envelope,
          body,
        },
      };
    }

    // trigger.conversation branch.
    const parsed = triggerConversationFrameSchema.safeParse(rawFrame);
    if (!parsed.success) {
      return {
        ok: false,
        reason: 'schema',
        details: {
          frameType,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
    }
    const frame = parsed.data;
    const envelope = frame.envelope as unknown as SignedConversationTriggerEnvelope;
    const common = this.runCommonChecks(frameType, envelope);
    if (common) return common;

    const body = envelope.event;
    if (!CONVERSATION_PROMPT_TYPE_ALLOWLIST.has(body.promptType)) {
      return {
        ok: false,
        reason: 'allowlist',
        details: {
          frameType,
          promptType: body.promptType,
          nonce: envelope.nonce,
        },
      };
    }
    return {
      ok: true,
      verified: {
        kind: 'trigger.conversation',
        frame: {
          organizationId: frame.organizationId,
          ...(frame.projectId !== undefined ? { projectId: frame.projectId } : {}),
          ...(frame.conversationId !== undefined ? { conversationId: frame.conversationId } : {}),
        },
        envelope,
        body,
      },
    };
  }

  public verifyCliReadFrame(rawFrame: unknown): VerifyCliReadResult {
    const rawEnvelope =
      typeof rawFrame === 'object' &&
      rawFrame !== null &&
      'envelope' in rawFrame &&
      typeof rawFrame.envelope === 'object' &&
      rawFrame.envelope !== null
        ? (rawFrame.envelope as { protocolVersion?: unknown })
        : undefined;
    if (this.requireProtocolVersion2 && rawEnvelope?.protocolVersion !== 2) {
      return { ok: false, reason: 'protocol_version', details: { frameType: 'cli.read.request' } };
    }
    if (rawEnvelope?.protocolVersion === 2) {
      const parsedV2 = cliReadFrameV2Schema.safeParse(rawFrame);
      if (!parsedV2.success) {
        return schemaDrop('cli.read.request', parsedV2.error);
      }
      const frame = parsedV2.data;
      const envelope = frame.envelope as VerifiedReadEnvelope;
      const common = this.runCommonChecks('cli.read.request', envelope);
      if (common) return common;
      const readBody = envelope.event;
      const addressing = this.checkV2FrameAddressing(
        frame,
        envelope,
        readBody.operation === 'project.session_costs.list' ? readBody.projectId : undefined,
      );
      if (addressing) return addressing;
      return {
        ok: true,
        verified: {
          frame: {
            organizationId: frame.organizationId,
            ...(frame.projectId !== undefined ? { projectId: frame.projectId } : {}),
            ...(frame.conversationId !== undefined ? { conversationId: frame.conversationId } : {}),
            ...(frame.userId !== undefined ? { userId: frame.userId } : {}),
          },
          envelope,
          body: envelope.event,
        },
      };
    }
    const parsed = cliReadFrameSchema.safeParse(rawFrame);
    if (!parsed.success) {
      return {
        ok: false,
        reason: 'schema',
        details: {
          frameType: 'cli.read.request',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
    }
    const frame = parsed.data;
    const envelope = frame.envelope as SignedCliReadEnvelope;
    const common = this.runCommonChecks('cli.read.request', envelope);
    if (common) return common;
    return {
      ok: true,
      verified: {
        frame: {
          organizationId: frame.organizationId,
          ...(frame.projectId !== undefined ? { projectId: frame.projectId } : {}),
          ...(frame.conversationId !== undefined ? { conversationId: frame.conversationId } : {}),
          ...(frame.userId !== undefined ? { userId: frame.userId } : {}),
        },
        envelope,
        body: envelope.event,
      },
    };
  }

  public verifyCliSettingsFrame(
    rawFrame: unknown,
  ):
    | { ok: true; verified: VerifiedCliSettingsFrame }
    | { ok: false; reason: VerificationDropReason; details: Record<string, unknown> } {
    const rawEnvelope =
      typeof rawFrame === 'object' &&
      rawFrame !== null &&
      'envelope' in rawFrame &&
      typeof rawFrame.envelope === 'object' &&
      rawFrame.envelope !== null
        ? (rawFrame.envelope as { protocolVersion?: unknown })
        : undefined;
    if (this.requireProtocolVersion2 && rawEnvelope?.protocolVersion !== 2) {
      return {
        ok: false,
        reason: 'protocol_version',
        details: { frameType: 'cli.settings.request' },
      };
    }

    const parsed = cliSettingsFrameV2Schema.safeParse(rawFrame);
    if (!parsed.success) {
      return {
        ok: false,
        reason: 'schema',
        details: {
          frameType: 'cli.settings.request',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
    }
    const frame = parsed.data;
    const envelope = frame.envelope as VerifiedSettingsEnvelope;
    const common = this.runCommonChecks('cli.settings.request', envelope);
    if (common) return common;
    const addressing = this.checkV2FrameAddressing(frame, envelope, envelope.event.projectId);
    if (addressing) return addressing;
    return {
      ok: true,
      verified: {
        frame: {
          organizationId: frame.organizationId,
          ...(frame.projectId !== undefined ? { projectId: frame.projectId } : {}),
          ...(frame.conversationId !== undefined ? { conversationId: frame.conversationId } : {}),
          ...(frame.userId !== undefined ? { userId: frame.userId } : {}),
        },
        envelope,
        body: envelope.event,
      },
    };
  }

  /** Atomically re-points verification at a newly reconciled machine identity. */
  public reload(args: { serverSigningPublicKey: Buffer; expectedMachineId: string }): void {
    // Build the new key first so a malformed key throws before either field is
    // swapped — the verifier stays on its prior, working key/identity rather
    // than ending up half-applied.
    let nextKey: crypto.KeyObject;
    try {
      nextKey = rawEd25519PublicKeyToKeyObject(args.serverSigningPublicKey);
    } catch (error) {
      throw new Error(
        `TriggerVerifier.reload: invalid server signing public key — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.publicKeyObject = nextKey;
    this.expectedMachineId = args.expectedMachineId;
  }
}
