import { z } from 'zod';
import { z as durable } from 'zod/v4';
import {
  LocalPromptType,
  type AgentTrigger,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  storedReviewEntryV9Schema,
  storedTriggerFrameV9Schema,
  type StoredDirectPromptTypeV9,
  type StoredTriggerFrameV9,
} from './storage-schema/v9';
import type { ReadableInputRecord } from './input-admission-codec';
const id = z.string().uuid();
export const collaborationPayloadSchema = z.object({
  kind: z.literal('session_message'),
  generation: z.number().int().positive(),
  platformAdmissionId: id,
  input: z.object({
    sourceSessionId: id,
    interactionId: id,
    attemptId: id,
    authorKind: z.literal('AGENT'),
    authority: z.object({
      kind: z.literal('MACHINE_SESSION'),
      machineId: id,
      sourceSessionId: id,
      targetSessionId: id,
      subagentCapability: z.literal('RESEARCH').optional(),
      expiresAt: z.string().optional(),
    }),
    objective: z.string().optional(),
    answerReference: id.optional(),
    answerText: z.string().optional(),
  }),
});

/**
 * A follow-up the Run itself owes the agent (no signed trigger exists for it). Its authority is
 * the owning record's identity; the stable admission key makes it at-most-once across restarts.
 */
const runFollowUpPayloadSchema = z.discriminatedUnion('origin', [
  z.object({
    kind: z.literal('run_follow_up'),
    origin: z.literal('permission_recovery'),
    requestId: z.string().min(1),
    agentInput: z.object({
      promptType: z.literal(LocalPromptType.CodingFreeform),
      userMessage: z.string().min(1),
    }),
  }),
  z.object({
    kind: z.literal('run_follow_up'),
    origin: z.literal('review_service_recovery'),
    replacesTurnId: z.string().min(1),
    requestId: z.string().min(1),
    agentInput: z.object({
      promptType: z.literal(LocalPromptType.CodeReview),
      userMessage: z.string().optional(),
    }),
  }),
]);
export type RunFollowUpPayload = z.infer<typeof runFollowUpPayloadSchema>;

/**
 * Run-facing port onto the durable per-session input queue: admits a Run-owned follow-up, and
 * hears when a Run can take its next durable input. Pickup has no timer, so every change that
 * can make `Run.canAcceptDurableInput` true must reach `durableInputReady`.
 */
export interface RunFollowUpAdmission {
  durableInputReady(runId: string): void;
  inspectReviewContinuation?(
    sessionId: string,
    runId: string,
    turnId: string,
  ): Promise<{
    userId: string;
    settled: boolean;
  }>;
  admit(input: {
    stableKey: string;
    agentSessionId: string;
    runId: string;
    organizationId: string;
    projectId: string;
    userId: string;
    payload: RunFollowUpPayload;
  }): Promise<{ replayed: boolean }>;
}

/**
 * Every trigger the verifier accepts on the conversation channel must be storable, and storage
 * holds nothing else. When codegen adds a trigger type this fails typecheck until a new storage
 * version carries it, instead of rejecting the new input at runtime.
 */
type AdmittedDirectPromptType = Exclude<
  AgentTrigger['promptType'],
  'start_run' | 'user_message' | 'session_monitor'
>;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const admittedPromptTypesAreStorable: Same<AdmittedDirectPromptType, StoredDirectPromptTypeV9> =
  true;

/** Maps an already-verified, already-validated wire trigger into its stored v2 shape. */
export const toStoredTriggerFrame = (
  conversationId: string | null,
  signedEvent: AgentTrigger,
  validatedPayload: unknown,
): StoredTriggerFrameV9 =>
  storedTriggerFrameV9Schema.parse({
    conversationId,
    signedEvent: durable.json().parse(signedEvent),
    event: {
      ...signedEvent,
      ...(validatedPayload !== undefined ? { payload: validatedPayload } : {}),
    },
  }) as StoredTriggerFrameV9;

/** The replay check reads only the stored conversation and signed bytes, never the event. */
export const storedSignedTriggerSchema = storedTriggerFrameV9Schema.pick({
  conversationId: true,
  signedEvent: true,
});

/** Recognize the canonical shared Review entry point from the stored record, in any state. */
export const isReviewAdmission = (record: ReadableInputRecord): boolean =>
  record.kind === 'trigger_frame' && storedReviewEntryV9Schema.safeParse(record.payload).success;
