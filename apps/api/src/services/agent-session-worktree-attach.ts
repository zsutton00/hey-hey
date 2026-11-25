import {
  AgentRequestWorktreeAttachPayload,
  AgentSessionServicePlaceKind,
} from '@hey-hey/contracts/api/models';

/** `responseType` of the card the CLI posts for a worktree-attach request. */
export const WORKTREE_ATTACH_RESPONSE_TYPE = 'agent_request_worktree_attach_v1';

export type WorktreeAttachChange = {
  requestId: string;
  serviceId: string;
  branch: string;
  worktreePath: string;
};

export type ActiveServicePlace = {
  kind: string | null;
  branch: string | null;
  worktreePath: string | null;
};

/**
 * - NOT_APPROVED: no approved card matches this request, Service, branch and path.
 * - STALE: a later approved attach for the Service has already been applied.
 * - APPLY: the request is approved and nothing later has been applied.
 */
export type WorktreeAttachVerdict = 'NOT_APPROVED' | 'STALE' | 'APPLY';

type DecidedCard = {
  requestId: string;
  branch: string;
  worktreePath: string;
  decidedAtMs: number;
  failed: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Message data is written by the CLI, so shape is checked once, here. */
export function isWorktreeAttachPayload(
  value: unknown,
): value is AgentRequestWorktreeAttachPayload {
  if (
    !isRecord(value) ||
    value.responseType !== WORKTREE_ATTACH_RESPONSE_TYPE
  ) {
    return false;
  }
  const request = value.worktreeAttachRequest;
  return (
    isRecord(request) &&
    typeof request.id === 'string' &&
    typeof request.serviceId === 'string' &&
    typeof request.branch === 'string' &&
    typeof request.worktreePath === 'string'
  );
}

function approvedCardsFor(
  messageData: readonly unknown[],
  serviceId: string,
): DecidedCard[] {
  const cards: DecidedCard[] = [];
  for (const data of messageData) {
    const elements = isRecord(data) ? data.uiElements : undefined;
    if (!Array.isArray(elements)) {
      continue;
    }
    for (const element of elements) {
      const payload = isRecord(element) ? element.payload : undefined;
      if (!isWorktreeAttachPayload(payload)) {
        continue;
      }
      const decidedAtMs = Date.parse(payload.decidedAt ?? '');
      const approved = payload.decision === 'approve';
      const request = payload.worktreeAttachRequest;
      if (
        !approved ||
        Number.isNaN(decidedAtMs) ||
        request.serviceId !== serviceId
      ) {
        continue;
      }
      cards.push({
        requestId: request.id,
        branch: request.branch,
        worktreePath: request.worktreePath,
        decidedAtMs,
        failed: Boolean(payload.failureReason),
      });
    }
  }
  return cards;
}

/**
 * Decides one attach delivery from the approved cards stored on the session's
 * conversation and the Service's active place.
 *
 * The membership records no applied-request ID, so "applied" is read from the
 * active place: another request counts as applied when its card did not fail
 * and its destination is where the Service works now. A request is stale when
 * such a request was decided at or after it; equal decision times count as
 * later, so ties never move the Service back. An approved request that failed,
 * or was never applied, does not supersede anything.
 */
export function decideWorktreeAttach(input: {
  messageData: readonly unknown[];
  change: WorktreeAttachChange;
  activePlace: ActiveServicePlace;
}): WorktreeAttachVerdict {
  const { change, activePlace } = input;
  const cards = approvedCardsFor(input.messageData, change.serviceId);

  const requested = cards.find(
    (card) =>
      card.requestId === change.requestId &&
      card.branch === change.branch &&
      card.worktreePath === change.worktreePath,
  );
  if (!requested) {
    return 'NOT_APPROVED';
  }

  const worksInWorktree =
    activePlace.kind === AgentSessionServicePlaceKind.Worktree;
  const supersededByApplied = cards.some(
    (card) =>
      card.requestId !== requested.requestId &&
      !card.failed &&
      card.decidedAtMs >= requested.decidedAtMs &&
      worksInWorktree &&
      card.branch === activePlace.branch &&
      card.worktreePath === activePlace.worktreePath,
  );
  return supersededByApplied ? 'STALE' : 'APPLY';
}
