/**
 * Strict zod schemas for inbound non-trigger frames on the platform websocket.
 *
 * The shapes mirror the generated `WebSocket*Event` interfaces in
 * `src/shared/api/generated/api.ts`. Unknown top-level fields are rejected so
 * a malformed or version-skewed frame is dropped at the receive boundary
 * before any downstream listener sees it.
 *
 * Trigger frames are out of scope here — they are validated against the
 * strict schemas in
 * `trigger-verification/schemas.ts` inside the verifier.
 */

import { z } from 'zod';

import {
  WebSocketConversationUpdatedEventChangeTypeEnum,
  WebSocketMachineAuthenticationErrorResponseReasonEnum,
} from '../shared/api/index';

const baseFields = {
  timestamp: z.string(),
  organizationId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
};

const agentSessionCreatedFrameSchema = z
  .object({
    ...baseFields,
    type: z.literal('agent_session.created'),
    agentSessionId: z.string().min(1),
  })
  .strict();

const agentSessionDeletedFrameSchema = z
  .object({
    ...baseFields,
    type: z.literal('agent_session.deleted'),
    agentSessionId: z.string().min(1),
  })
  .strict();

const agentSessionStatusChangedFrameSchema = z
  .object({
    ...baseFields,
    type: z.literal('agent_session.status_changed'),
    agentSessionId: z.string().min(1),
    previousStatus: z.string(),
    newStatus: z.string(),
  })
  .strict();

const taskCreatedFrameSchema = z
  .object({
    ...baseFields,
    type: z.literal('task.created'),
    taskId: z.string().min(1),
    initiativeId: z.string().min(1).optional(),
  })
  .strict();

const taskStatusChangedFrameSchema = z
  .object({
    ...baseFields,
    type: z.literal('task.status_changed'),
    taskId: z.string().min(1),
    initiativeId: z.string().min(1).optional(),
    previousStatus: z.string(),
    newStatus: z.string(),
  })
  .strict();

// `conversation.updated` differs slightly from the other base shapes:
// projectId and conversationId are required on this event per the generated
// contract, so we override the optional defaults from baseFields.
export const conversationUpdatedFrameSchema = z
  .object({
    type: z.literal('conversation.updated'),
    timestamp: z.string(),
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    conversationId: z.string().min(1),
    userId: z.string().min(1).optional(),
    previousVersion: z.number(),
    newVersion: z.number(),
    changeType: z.nativeEnum(WebSocketConversationUpdatedEventChangeTypeEnum),
    lastModifiedBy: z.string().min(1).optional(),
    changedFields: z.array(z.string()).optional(),
    latestMessageId: z.string().min(1).optional(),
  })
  .strict();

/**
 * Inbound machine-credential challenge frame. The platform issues this after
 * the CLI presents its machine credential on the `authenticate` payload; the
 * CLI signs `challenge` (base64 random bytes) with its paired Ed25519 key and
 * returns the signature. Validated strictly before signing so a malformed or
 * version-skewed frame is dropped rather than signed blindly.
 */
export const machineChallengeFrameSchema = z
  .object({
    challenge: z.string().min(1),
  })
  .strict();

/**
 * Terminal rejection reason on the `authenticated` failure response. Per the
 * WebSocketAuthResponse contract, `reason` is present ONLY when a machine
 * credential is rejected because it has been revoked; every other failure
 * (unknown machine, bad signature, transient server error) omits it. New enum
 * values may be added server-side over time, so this matches the one terminal
 * value exactly: any other value — an unknown future one, or an absent field —
 * fails the parse and is treated as a generic, non-terminal rejection that
 * re-authenticates and reconnects normally.
 */
export const authResponseRevokedReasonSchema = z.literal(
  WebSocketMachineAuthenticationErrorResponseReasonEnum.MachineRevoked,
);

export const PLATFORM_WS_NON_TRIGGER_SCHEMAS = {
  'agent_session.created': agentSessionCreatedFrameSchema,
  'agent_session.deleted': agentSessionDeletedFrameSchema,
  'agent_session.status_changed': agentSessionStatusChangedFrameSchema,
  'task.created': taskCreatedFrameSchema,
  'task.status_changed': taskStatusChangedFrameSchema,
  'conversation.updated': conversationUpdatedFrameSchema,
} as const;

type PlatformWsNonTriggerEventType = keyof typeof PLATFORM_WS_NON_TRIGGER_SCHEMAS;
