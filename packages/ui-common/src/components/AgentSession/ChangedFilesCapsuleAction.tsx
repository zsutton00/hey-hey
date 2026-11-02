import CodeIcon from "@mui/icons-material/Code";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useCallback, useState } from "react";
import type { AgentSessionCurrentState } from "../../api";
import { useAgentSession } from "../../data/hooks/useAgentSession";
import { useAgentSessionCurrentState } from "../../data/hooks/useAgentSessionCurrentState";
import { CapsuleAction } from "../ActionsCapsule/CapsuleAction";
import { CollatedFileDiffModalContainer } from "./CollatedFileDiffModal/CollatedFileDiffModalContainer";
import type { UnavailableOutcome } from "./codingSessionFeedback";
import {
  useRemoteChangedFilesCount,
  type RemoteChangedFilesCountState,
} from "./runtime/hooks/useRemoteChangedFilesCount";
import { useRemoteChangedFilesInventory } from "./runtime/hooks/useRemoteChangedFilesInventory";
import { useTurnCompletionRevision } from "./runtime/hooks/useTurnCompletionRevision";

type ChangedFilesActionState =
  | { kind: "available"; count: number }
  | {
      kind: "unavailable-with-reason";
      feedback: Extract<UnavailableOutcome, { presentationScope: "action" }>;
    };

const resolveChangedFilesActionState = (
  state: RemoteChangedFilesCountState,
  retry: () => void,
): ChangedFilesActionState | null => {
  if (state.status === "success" && state.count > 0) {
    return { kind: "available", count: state.count };
  }
  if (state.status === "loading" && state.previousFailure) {
    return {
      kind: "unavailable-with-reason",
      feedback: {
        status: "unavailable",
        presentationScope: "action",
        reason: state.previousFailure.reason,
        errorCode: state.previousFailure.errorCode,
        retryable: state.previousFailure.retryable,
        failureIdentity: state.previousFailure.failureIdentity,
        retry,
        isRetrying: true,
      },
    };
  }
  if (state.status === "unavailable") {
    return {
      kind: "unavailable-with-reason",
      feedback: {
        status: "unavailable",
        presentationScope: "action",
        reason: state.error,
        errorCode: state.errorCode,
        retryable: state.retryable,
        failureIdentity: state.failureIdentity,
        retry,
        isRetrying: false,
      },
    };
  }
  return null;
};

export interface UseChangedFilesCapsuleParams {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  runId: string | null;
  enabled: boolean;
  canonicalCurrentState: AgentSessionCurrentState | undefined;
}

/**
 * The Run's changed-file count, its lazily read inventory, the viewer's open
 * state and the refresh at each Turn boundary.
 */
export const useChangedFilesCapsule = (
  params: UseChangedFilesCapsuleParams,
) => {
  const {
    organizationId,
    projectId,
    agentSessionId,
    runId,
    enabled,
    canonicalCurrentState,
  } = params;
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const count = useRemoteChangedFilesCount({
    organizationId,
    projectId,
    agentSessionId,
    runId,
    enabled,
  });
  const inventory = useRemoteChangedFilesInventory({
    organizationId,
    projectId,
    agentSessionId,
    runId,
    open: diffModalOpen,
  });
  const retryCount = count.retry;
  const retryInventory = inventory.retry;
  const currentState = useAgentSessionCurrentState(
    organizationId,
    projectId,
    agentSessionId,
    { canonicalCurrentState },
  ).currentState;
  const refreshAtTurnBoundary = useCallback(() => {
    retryCount();
    if (diffModalOpen) {
      retryInventory();
    }
  }, [diffModalOpen, retryCount, retryInventory]);
  useTurnCompletionRevision(currentState, refreshAtTurnBoundary);

  return { count, inventory, diffModalOpen, setDiffModalOpen };
};

export type ChangedFilesCapsule = ReturnType<typeof useChangedFilesCapsule>;

export interface ChangedFilesCapsuleActionProps {
  capsule: ChangedFilesCapsule;
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  runId: string | null;
  order: number;
}

/** The "N files" capsule entry and the diff viewer it opens. */
export const ChangedFilesCapsuleAction: React.FC<
  ChangedFilesCapsuleActionProps
> = ({ capsule, organizationId, projectId, agentSessionId, runId, order }) => {
  const { count, inventory, diffModalOpen, setDiffModalOpen } = capsule;
  const actionState = resolveChangedFilesActionState(count, count.retry);
  const handleClick = useCallback(() => {
    if (actionState?.kind === "available") {
      setDiffModalOpen(true);
    }
    // The unavailable branch is handled by the action-owned feedback
    // surface and never opens the changed-files view or starts another read.
  }, [actionState, setDiffModalOpen]);
  const handleClose = useCallback(
    () => setDiffModalOpen(false),
    [setDiffModalOpen],
  );

  return (
    <>
      {actionState ? (
        <CapsuleAction
          behavior="click"
          id="view-diffs"
          label={
            actionState.kind === "available"
              ? actionState.count === 1
                ? "1 file"
                : `${String(actionState.count)} files`
              : "Files"
          }
          icon={actionState.kind === "available" ? CodeIcon : WarningAmberIcon}
          iconStyle={
            actionState.kind === "unavailable-with-reason"
              ? { backgroundColor: "transparent", color: "text.secondary" }
              : undefined
          }
          textColor={
            actionState.kind === "unavailable-with-reason"
              ? "text.secondary"
              : undefined
          }
          feedback={
            actionState.kind === "unavailable-with-reason"
              ? actionState.feedback
              : undefined
          }
          onClick={handleClick}
          actionGroup="page"
          tier="page"
          order={order}
        />
      ) : null}
      <CollatedFileDiffModalContainer
        open={diffModalOpen}
        onClose={handleClose}
        entries={inventory.entries ?? []}
        readState={
          inventory.status === "success"
            ? { status: "ready" }
            : inventory.status === "unavailable"
              ? { status: "error", message: inventory.error }
              : { status: "loading" }
        }
        onRetry={inventory.retry}
        organizationId={organizationId}
        projectId={projectId}
        agentSessionId={agentSessionId}
        runId={runId}
      />
    </>
  );
};

export interface SessionChangedFilesCapsuleActionProps extends UseChangedFilesCapsuleParams {
  order: number;
}

/**
 * Self-contained changed-files entry for pages that don't need the count
 * state. A Service can be admitted during a Turn without any push to the
 * client, so the session is re-read at each Turn boundary to let the entry's
 * gate open without reopening the page.
 */
export const SessionChangedFilesCapsuleAction: React.FC<
  SessionChangedFilesCapsuleActionProps
> = ({ order, ...params }) => {
  const capsule = useChangedFilesCapsule(params);
  const { refetch } = useAgentSession(
    params.organizationId,
    params.projectId,
    params.agentSessionId,
  );
  const currentState = useAgentSessionCurrentState(
    params.organizationId,
    params.projectId,
    params.agentSessionId,
    { canonicalCurrentState: params.canonicalCurrentState },
  ).currentState;
  const refreshSession = useCallback(() => void refetch(), [refetch]);
  useTurnCompletionRevision(currentState, refreshSession);

  return (
    <ChangedFilesCapsuleAction
      capsule={capsule}
      organizationId={params.organizationId}
      projectId={params.projectId}
      agentSessionId={params.agentSessionId}
      runId={params.runId}
      order={order}
    />
  );
};
