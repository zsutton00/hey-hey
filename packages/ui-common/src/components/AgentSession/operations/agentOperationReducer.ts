import type { MessageRecordDto } from "../../../api";

export type AgentOperationTerminalState =
  | "accepted"
  | "succeeded"
  | "cancelled"
  | "denied"
  | "failed";

export type AgentOperationState =
  | "created"
  | "resolving_authorization"
  | "awaiting_approval"
  | "submitting"
  | "dispatch_pending"
  | "reconciling"
  | AgentOperationTerminalState;

export interface AgentOperationSnapshotBase {
  readonly operationId: string;
  readonly kind: "start_run" | "submit_message";
  readonly fingerprint: string;
}

export type AgentOperationSnapshot =
  | (AgentOperationSnapshotBase & {
      readonly state: Exclude<AgentOperationState, AgentOperationTerminalState>;
    })
  | (AgentOperationSnapshotBase & {
      readonly state: "succeeded";
      readonly messageId: string;
      readonly triggerMessageId: string;
    })
  | (AgentOperationSnapshotBase & {
      readonly state: "accepted";
      readonly messageId: string;
      readonly triggerMessageId: string;
      /** The confirmed Message returned by submission, when the response carried it. */
      readonly message?: MessageRecordDto;
    })
  | (AgentOperationSnapshotBase & { readonly state: "cancelled" })
  | (AgentOperationSnapshotBase & {
      readonly state: "denied" | "failed";
      readonly code: string;
      readonly message: string;
    });

export type AgentOperationEvent =
  | {
      type: "ADVANCE";
      state:
        | "resolving_authorization"
        | "awaiting_approval"
        | "submitting"
        | "dispatch_pending"
        | "reconciling";
    }
  | { type: "SUCCEED"; messageId: string; triggerMessageId: string }
  | { type: "CANCEL" }
  | { type: "DENY" | "FAIL"; code: string; message: string };

export const reduceAgentOperation = (
  current: AgentOperationSnapshot,
  event: AgentOperationEvent,
): AgentOperationSnapshot => {
  if (["succeeded", "cancelled", "denied", "failed"].includes(current.state)) {
    return current;
  }
  switch (event.type) {
    case "ADVANCE":
      return { ...current, state: event.state };
    case "SUCCEED":
      return {
        ...current,
        state: "succeeded",
        messageId: event.messageId,
        triggerMessageId: event.triggerMessageId,
      };
    case "CANCEL":
      return { ...current, state: "cancelled" };
    case "DENY":
      return {
        ...current,
        state: "denied",
        code: event.code,
        message: event.message,
      };
    case "FAIL":
      return {
        ...current,
        state: "failed",
        code: event.code,
        message: event.message,
      };
  }
};
