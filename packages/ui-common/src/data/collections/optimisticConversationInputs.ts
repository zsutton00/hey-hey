import { useSyncExternalStore } from "react";
import type {
  MessageRecordDto,
  RunAttachmentReference,
  UserMessageAgentInputProvenance,
} from "../../api";
import type { DirectTriggerInput } from "../../components/AgentSession/operations/AgentOperationCoordinator";
import { readUserMessageDisplayText } from "../../utils/conversationMessageText";

// Local presentation evidence, never a fabricated canonical Message. A sent
// input renders as a submission preview until the canonical read places its
// Message in the timeline. Once the platform confirms the submission, its
// returned Message carries the admission disposition the preview follows.
export interface OptimisticConversationInput {
  operationId: string;
  input: DirectTriggerInput;
  confirmed?: MessageRecordDto;
  /** Definitive failure; the preview stays visible until dismissed. */
  failure?: { reason: string };
}
let inputs: readonly OptimisticConversationInput[] = [];
const listeners = new Set<() => void>();
export const inputScope = (
  organizationId: string,
  projectId: string,
  conversationId: string,
) => JSON.stringify([organizationId, projectId, conversationId]);
const scopeOf = (input: DirectTriggerInput) =>
  inputScope(input.organizationId, input.projectId, input.conversationId);
const publish = (next: readonly OptimisticConversationInput[]) => {
  inputs = next;
  listeners.forEach((listener) => listener());
};
const update = (
  operationId: string,
  change: (row: OptimisticConversationInput) => OptimisticConversationInput,
) => {
  if (!inputs.some((row) => row.operationId === operationId)) return;
  publish(
    inputs.map((row) => (row.operationId === operationId ? change(row) : row)),
  );
};
export function beginOptimisticInput(
  operationId: string,
  input: DirectTriggerInput,
) {
  if (input.intent.parentMessageId) return;
  publish([...inputs, { operationId, input }]);
}
export function confirmOptimisticInput(
  operationId: string,
  message: MessageRecordDto,
) {
  update(operationId, (row) => ({ ...row, confirmed: message }));
}
export function failOptimisticInput(operationId: string, reason: string) {
  update(operationId, (row) => ({ ...row, failure: { reason } }));
}
export function removeOptimisticInput(operationId: string) {
  const next = inputs.filter((row) => row.operationId !== operationId);
  if (next.length !== inputs.length) publish(next);
}
export function observeCanonicalInputs(
  scope: string,
  messages: readonly MessageRecordDto[],
) {
  const settled = new Set(
    messages
      .filter((message) => message.executionStatus !== "queued")
      .map((message) => message.executionOperationId),
  );
  const next = inputs.filter(
    (row) => scopeOf(row.input) !== scope || !settled.has(row.operationId),
  );
  if (next.length !== inputs.length) publish(next);
}
export const subscribeOptimisticInputs = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getOptimisticInputs = () => inputs;
export function useOptimisticInputs() {
  return useSyncExternalStore(
    subscribeOptimisticInputs,
    getOptimisticInputs,
    getOptimisticInputs,
  );
}

// Operation and Message ids already shown as previews, per conversation, so
// the timeline does not animate the canonical message in a second time.
const shownAsPreview = new Map<string, Set<string>>();
export function recordShownPreviews(scope: string, ids: readonly string[]) {
  if (!ids.length) return;
  const shown = shownAsPreview.get(scope) ?? new Set<string>();
  ids.forEach((id) => shown.add(id));
  shownAsPreview.set(scope, shown);
}
export function wasShownAsPreview(
  scope: string,
  message: Pick<MessageRecordDto, "id" | "executionOperationId">,
) {
  const shown = shownAsPreview.get(scope);
  if (!shown) return false;
  return (
    shown.has(message.id) ||
    (!!message.executionOperationId && shown.has(message.executionOperationId))
  );
}

type SubmissionPreviewState =
  | { kind: "sending" }
  | { kind: "starting" }
  | { kind: "awaiting-delivery" }
  | {
      kind: "queued";
      messageId: string;
      operationId: string | null;
      cancellationRequested: boolean;
    }
  | { kind: "failed"; operationId: string; reason: string };

export interface SubmissionPreview {
  /** Stable across confirmation and refresh: operation id, else Message id. */
  key: string;
  /** Every identity this preview has shown under. */
  identities: readonly string[];
  text: string | null;
  provenance: UserMessageAgentInputProvenance | null;
  author: { name: string; id: string | null } | null;
  /** Stored id and file name of each file sent with the submission. */
  attachments: readonly RunAttachmentReference[];
  state: SubmissionPreviewState;
}

const messageText = (message: MessageRecordDto) =>
  message.type === "USER"
    ? readUserMessageDisplayText(message.data)
    : typeof message.data.response === "string"
      ? message.data.response
      : null;

const messageProvenance = (message: MessageRecordDto) =>
  message.type === "USER"
    ? (message.data.agentInput?.provenance ?? null)
    : null;

const messageAttachments = (
  message: MessageRecordDto,
): RunAttachmentReference[] | undefined =>
  message.type === "USER" ? message.data.attachments : undefined;

const messageAuthor = (message: MessageRecordDto) =>
  message.type === "USER" && message.user?.name
    ? { name: message.user.name, id: message.userId ?? null }
    : null;

/** State straight from the server disposition; no client idle check or timer. */
function dispositionState(message: MessageRecordDto): SubmissionPreviewState {
  const disposition =
    message.type === "USER" ? message.executionAdmissionDisposition : undefined;
  if (message.executionQueueConfirmed === true || disposition === "QUEUED")
    return {
      kind: "queued",
      messageId: message.id,
      operationId: message.executionOperationId ?? null,
      cancellationRequested: message.executionCancellationRequested === true,
    };
  if (disposition === "IMMEDIATE") return { kind: "starting" };
  if (disposition === "PENDING") return { kind: "awaiting-delivery" };
  // No disposition: a dated message has started; an undated one is still
  // awaiting delivery.
  return message.createdAt !== null
    ? { kind: "starting" }
    : { kind: "awaiting-delivery" };
}

/**
 * One preview per submission that has not entered the timeline, in send order.
 * Submissions match canonical Messages by operation or Message identity, never
 * by text. Canonical queued inputs come first in their read order; local
 * submissions the canonical read has not observed follow in send order.
 */
export function selectSubmissionPreviews(
  scope: string,
  timeline: readonly MessageRecordDto[],
  undated: readonly MessageRecordDto[],
  optimistic: readonly OptimisticConversationInput[],
): SubmissionPreview[] {
  const local = optimistic.filter((row) => scopeOf(row.input) === scope);
  const rowFor = (message: MessageRecordDto) =>
    local.find(
      (row) =>
        row.operationId === message.executionOperationId ||
        row.confirmed?.id === message.id,
    );
  const matched = new Set<string>();
  [...timeline, ...undated].forEach((message) => {
    const row = rowFor(message);
    if (row) matched.add(row.operationId);
  });

  const previews: SubmissionPreview[] = undated
    .filter((message) => message.executionStatus === "queued")
    .map((message) => {
      const row = rowFor(message);
      const operationId = row?.operationId ?? message.executionOperationId;
      return {
        key: operationId ?? message.id,
        identities: [message.id, ...(operationId ? [operationId] : [])],
        text: messageText(message),
        provenance: messageProvenance(message),
        author: messageAuthor(message),
        attachments: messageAttachments(message) ?? [],
        state: dispositionState(message),
      };
    });

  local
    .filter((row) => !matched.has(row.operationId))
    .forEach((row) => {
      previews.push({
        key: row.operationId,
        identities: [
          row.operationId,
          ...(row.confirmed ? [row.confirmed.id] : []),
        ],
        text:
          (row.confirmed && messageText(row.confirmed)) ??
          readUserMessageDisplayText(row.input.intent.data),
        provenance:
          (row.confirmed && messageProvenance(row.confirmed)) ??
          row.input.intent.data.agentInput?.provenance ??
          null,
        author: row.confirmed ? messageAuthor(row.confirmed) : null,
        attachments:
          (row.confirmed && messageAttachments(row.confirmed)) ??
          row.input.intent.data.attachments ??
          [],
        state: row.failure
          ? {
              kind: "failed",
              operationId: row.operationId,
              reason: row.failure.reason,
            }
          : row.confirmed
            ? dispositionState(row.confirmed)
            : { kind: "sending" },
      });
    });
  return previews;
}
