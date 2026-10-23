import type { AgentSessionDto, RunAttachmentReference } from "../../../../api";
import { resolveHasSentInitialPrompt } from "../coding/agent-session-helpers";
import type { LocalCliForSessionState } from "./useLocalCliForSession";

export interface RunAttachmentTarget {
  runId: string;
  machineId: string;
}

export type FileAttachmentDestination =
  | ({ kind: "run" } & RunAttachmentTarget)
  | { kind: "pre-run"; machineId: string };

export function resolveRunAttachmentTarget(
  session: AgentSessionDto | null,
  context: {
    organizationId: string;
    projectId: string;
    agentSessionId: string;
    conversationId: string;
  },
): RunAttachmentTarget | null {
  if (
    !session ||
    !session.machineId ||
    session.id !== context.agentSessionId ||
    session.organizationId !== context.organizationId ||
    session.projectId !== context.projectId ||
    session.conversationId !== context.conversationId ||
    !resolveHasSentInitialPrompt({ agentSessionStatus: session.status })
  )
    return null;
  return { runId: session.id, machineId: session.machineId };
}

export const isFileDrop = (transfer: Pick<DataTransfer, "types">): boolean =>
  Array.from(transfer.types).includes("Files");

export function attachmentDropRejection(
  target: RunAttachmentTarget | FileAttachmentDestination | null,
  local: LocalCliForSessionState,
  available: boolean | string,
): string | null {
  if (typeof available === "string") return available;
  if (!available)
    return "File attachments are unavailable while this composer is disabled.";
  if (!target) return "Select a destination machine before attaching files.";
  if (local.status === "checking")
    return "The destination machine is still being checked. Drop the files again once it is ready.";
  if (local.status !== "local" || local.machineId !== target.machineId)
    return "runId" in target
      ? "Files can only be attached from the machine that owns this Run. Its local CLI must be reachable."
      : "Files can only be attached from the selected destination machine. Its local CLI must be reachable.";
  return null;
}

export type RunAttachmentEntry =
  | { key: string; fileName: string; status: "uploading" }
  | {
      key: string;
      fileName: string;
      status: "ready";
      reference: RunAttachmentReference;
    }
  | {
      key: string;
      fileName: string;
      status: "error";
      message: string;
      code:
        | import("../../../../local-agent-api/generated/api").CliReadErrorCode
        | null;
    };

export const attachmentReferences = (
  entries: readonly RunAttachmentEntry[],
): RunAttachmentReference[] =>
  entries.flatMap((entry) =>
    entry.status === "ready" ? [entry.reference] : [],
  );
