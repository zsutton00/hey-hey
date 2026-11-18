import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  AgentSessionContinuationState,
  type AgentSessionContinuationMarker,
  type AgentSessionHostActionPreparation,
  type ControllerStartInputs,
  type HostActionPreparation,
  type StartRunPromptPayload,
} from '@hey-hey/contracts/api/models';

/**
 * Attempt states in which the destination may act on the session before the
 * binding moves to it. After the binding moves, the destination is the bound
 * machine and needs no continuation clause.
 */
const PRE_REBIND_ADMISSION_STATES = [
  AgentSessionContinuationState.Inspected,
  AgentSessionContinuationState.AwaitingHistoryConfirmation,
];

/**
 * The one rule for which Agent Sessions a machine may act on: the session is
 * bound to it, or, when no continuation is named, the session has no computer
 * yet and is bound when it starts. With a continuation, the machine must
 * instead be the destination of the named attempt before that attempt has
 * moved the binding; a session with no computer is never admitted that way.
 * Authorization preparation (`/resolve`, `/prepare`) and submission admission
 * both use this, so they cannot disagree about the same request.
 */
export function agentSessionMachineAdmission(
  machineId: string,
  continuationId: string | undefined,
): Prisma.AgentSessionWhereInput {
  const bound = { machineId } satisfies Prisma.AgentSessionWhereInput;
  if (!continuationId) {
    return { OR: [bound, { machineId: null }] };
  }

  const continuationDestination = {
    continuations: {
      some: {
        id: continuationId,
        destinationMachineId: machineId,
        bindingMovedAt: null,
        state: { in: PRE_REBIND_ADMISSION_STATES },
      },
    },
  } satisfies Prisma.AgentSessionWhereInput;
  return { OR: [bound, continuationDestination] };
}

/**
 * Names why an Agent Session target was rejected, so one log line tells an
 * operator which launcher precondition was missing. Reports only ids the
 * user owns and states, never request content.
 */
export async function agentSessionTargetFailure(
  db: PrismaService['db'],
  owned: Prisma.AgentSessionWhereInput,
  continuationId: string | undefined,
): Promise<Record<string, unknown>> {
  const session = await db.agentSession.findFirst({
    where: owned,
    select: {
      machineId: true,
      continuations: continuationId
        ? {
            where: { id: continuationId },
            select: {
              state: true,
              destinationMachineId: true,
              bindingMovedAt: true,
            },
          }
        : false,
    },
  });
  if (!session) {
    return { failedCheck: 'agent_session_not_owned' };
  }

  const continuation = session.continuations?.[0];
  return {
    failedCheck:
      session.machineId === null
        ? 'agent_session_unbound'
        : 'agent_session_bound_elsewhere',
    boundMachineId: session.machineId,
    ...(continuationId
      ? {
          continuationId,
          continuationState: continuation?.state ?? 'NOT_FOUND',
          continuationDestinationMachineId: continuation?.destinationMachineId,
          continuationBindingMoved: continuation
            ? continuation.bindingMovedAt !== null
            : undefined,
        }
      : {}),
  };
}

export type ContinuationStartPreparation = AgentSessionHostActionPreparation & {
  inputs: ControllerStartInputs & {
    payload: StartRunPromptPayload & {
      continuation: AgentSessionContinuationMarker;
    };
  };
};

/** A materialize-only start_run authored for one inspected continuation. */
export function isContinuationStart(
  action: HostActionPreparation,
): action is ContinuationStartPreparation {
  return (
    action.targetKind === 'AGENT_SESSION' &&
    action.inputs?.kind === 'START_RUN' &&
    action.inputs.payload.continuation !== undefined
  );
}
