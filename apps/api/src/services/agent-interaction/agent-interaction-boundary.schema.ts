import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type {
  AdmissionEnvelopeAuthorization,
  AgentInteractionAdmissionRequest,
  AgentInteractionSettledTurn,
  TurnAdmissionSettledTurn,
  SubagentInteractionAdmissionRequest,
  SubagentSettledAttempt,
  SessionMessageInteractionAdmissionRequest,
} from '../../generated';

const id = z.string().uuid();
const instant = z.string().datetime({ offset: true });

const authority = z
  .object({
    kind: z.literal('MACHINE_SESSION'),
    machineId: id,
    sourceSessionId: id,
    targetSessionId: id,
    subagentCapability: z.literal('RESEARCH').optional(),
    expiresAt: instant.optional(),
  })
  .strict();

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);

/**
 * Closed two-arm admission union. Nested intent and descriptor content is
 * verified by ExecutionGrantService against the persisted, signed evidence.
 */
const admissionAuthorization = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('controller_assertion'),
      intent: z.object({ authorizationId: id }).passthrough(),
      credentialId: base64url,
      clientDataJSON: base64url,
      authenticatorData: base64url,
      signature: base64url,
      userHandle: base64url.nullable(),
      grantDescriptor: z.object({}).passthrough(),
    })
    .strict(),
  z.object({ kind: z.literal('bounded_grant'), grantId: id }).strict(),
]);

const admission = z
  .object({
    id,
    kind: z.enum(['SUBAGENT', 'SESSION_MESSAGE', 'SUPERVISION']),
    mode: z.enum(['FOREGROUND', 'BACKGROUND']),
    sourceSessionId: id,
    sourceRunId: id.optional(),
    sourceTurnId: id.optional(),
    targetSessionId: id,
    destinationSessionId: id,
    attemptId: id,
    expectedRevision: z.number().int().nonnegative(),
    generation: z.number().int().min(1),
    idempotencyKey: z.string().min(1),
    authority,
    objective: z.string().min(1).optional(),
    answerReference: id.optional(),
    expiresAt: instant.optional(),
  })
  .strict();

const settlement = z
  .object({
    attemptId: id,
    interactionId: id,
    generation: z.number().int().min(1),
    targetSessionId: id,
    targetTurnId: id,
    terminalOutcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
    settledAt: instant,
    completedAssistantMessageId: id.nullable(),
    reports: z.array(id),
  })
  .strict();

export const parseAgentInteractionAdmission = (
  value: unknown,
): AgentInteractionAdmissionRequest => {
  const result = admission.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      'Invalid AgentInteraction admission envelope.',
    );
  return result.data satisfies AgentInteractionAdmissionRequest;
};

export const parseSessionMessageInteractionAdmission = (
  value: unknown,
): SessionMessageInteractionAdmissionRequest => {
  const result = z
    .object({
      id,
      attemptId: id,
      sourceSessionId: id,
      targetSessionId: id,
      commandText: z.string().min(1),
      idempotencyKey: z.string().min(1),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict()
    .safeParse(value);
  if (!result.success)
    throw new BadRequestException('Invalid session-message request.');
  return result.data satisfies SessionMessageInteractionAdmissionRequest;
};

export const parseSubagentInteractionAdmission = (
  value: unknown,
): SubagentInteractionAdmissionRequest => {
  const result = z
    .object({
      id,
      attemptId: id,
      sourceSessionId: id,
      sourceRunId: id,
      mode: z.enum(['FOREGROUND', 'BACKGROUND']),
      capability: z.literal('RESEARCH'),
      objective: z.string().min(1),
      serviceIds: z.array(id).refine((ids) => new Set(ids).size === ids.length),
      idempotencyKey: z.string().min(1),
      expectedRevision: z.number().int().nonnegative(),
      expiresAt: instant.optional(),
      authorization: admissionAuthorization,
    })
    .strict()
    .safeParse(value);
  if (!result.success)
    throw new BadRequestException('Invalid subagent interaction request.');
  return {
    ...result.data,
    authorization: result.data.authorization as AdmissionEnvelopeAuthorization,
  } satisfies SubagentInteractionAdmissionRequest;
};

export const parseSubagentDispatchHeartbeat = (
  value: unknown,
): { leaseToken: string } => {
  const result = z.object({ leaseToken: id }).strict().safeParse(value);
  if (!result.success)
    throw new BadRequestException('Invalid child dispatch heartbeat.');
  return result.data;
};

export const parseSubagentCancellation = (
  value: unknown,
): { expectedRevision: number } => {
  const result = z
    .object({ expectedRevision: z.number().int().positive() })
    .strict()
    .safeParse(value);
  if (!result.success)
    throw new BadRequestException('Invalid subagent cancellation request.');
  return result.data;
};

export const parseSubagentSettledAttempt = (
  value: unknown,
): SubagentSettledAttempt => {
  const result = z
    .object({
      leaseToken: id,
      generation: z.number().int().min(1),
      targetTurnId: id,
      outcome: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED']),
      settledAt: instant,
      outputText: z.string().optional(),
      failureCode: z.string().optional(),
    })
    .strict()
    .safeParse(value);
  if (!result.success)
    throw new BadRequestException('Invalid child terminal outcome.');
  return result.data satisfies SubagentSettledAttempt;
};

export const parseAgentInteractionSettlement = (
  value: unknown,
): AgentInteractionSettledTurn => {
  const result = settlement.safeParse(value);
  if (!result.success)
    throw new BadRequestException('Invalid settled-Turn evidence envelope.');
  return result.data satisfies AgentInteractionSettledTurn;
};

export const parseTurnAdmissionClaim = (
  value: unknown,
): { turnId: string; admissionId?: string } => {
  const result = z
    .object({ turnId: id, admissionId: id.optional() })
    .strict()
    .safeParse(value);
  if (!result.success)
    throw new BadRequestException('Invalid Turn-admission claim envelope.');
  return result.data;
};

export const parseTurnAdmissionSettlement = (
  value: unknown,
): TurnAdmissionSettledTurn => {
  const result = z
    .object({
      admissionId: id,
      agentSessionId: id,
      generation: z.number().int().min(1),
      turnId: id,
      terminalOutcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
      settledAt: instant,
      completedAssistantMessageId: id.nullable(),
      reports: z.array(id),
    })
    .strict()
    .safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      'Invalid Turn-admission settlement envelope.',
    );
  return result.data satisfies TurnAdmissionSettledTurn;
};
