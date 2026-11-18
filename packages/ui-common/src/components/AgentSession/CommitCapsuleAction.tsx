import CommitIcon from "@mui/icons-material/Commit";
import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
import { useModalState } from "../Modals/useModalState";
import { CapsuleAction } from "../ActionsCapsule/CapsuleAction";
import type { Stable } from "../../types";
import { toErrorMessage } from "./runtime/coding/agent-session-helpers";
import type { FollowupSubmissionAction } from "./runtime/coding/agent-session-helpers";
import type { UnavailableOutcome } from "./codingSessionFeedback";
import {
  FollowupActionModal,
  type FollowupActionSubmission,
} from "./FollowupActionModal";
import type { AgentSessionInteractionAccess } from "./operations/AgentOperationCoordinator";
import type { RemoteChangedFilesCountState } from "./runtime/hooks/useRemoteChangedFilesCount";
import type { SubmitPromptResult } from "./runtime/hooks/usePromptRunSubmission";
import type { AgentProvider } from "./runtime/index";
import type { RuntimeModelCatalogSource } from "./useRuntimeModelCatalog";
import { COMMIT_SURFACE_ID } from "./surfaceSelectionMemory";
import { useSubmitCommitPrompt } from "./useSubmitCommitPrompt";

export const resolveCommitBlockedReason = (
  interactionAccess: AgentSessionInteractionAccess,
  changedFiles: RemoteChangedFilesCountState,
): string | null => {
  if (!interactionAccess.isDeviceEnabled) {
    return interactionAccess.unavailable.message;
  }

  if (changedFiles.status === "success") {
    return changedFiles.count === 0
      ? "There are no changed files available to commit."
      : null;
  }

  if (changedFiles.status === "unavailable") {
    return changedFiles.error;
  }

  return "Changed files are still being checked. Please wait before committing.";
};

interface CommitFailure {
  readonly submission: FollowupActionSubmission;
  readonly reason: string;
  readonly failureIdentity: { readonly reason: string };
  readonly isRetrying: boolean;
}

export interface CommitCapsuleActionProps {
  runId: string | null;
  providerRunId: string;
  provider: AgentProvider;
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  interactionAccess: AgentSessionInteractionAccess;
  catalogSource: RuntimeModelCatalogSource | null;
  /** The same changed-files count read the "N files" entry renders. */
  changedFiles: RemoteChangedFilesCountState;
  /**
   * Whether the capsule entry is rendered. The modal and an in-flight commit
   * stay mounted either way, so a count refresh cannot drop them.
   */
  showAction: boolean;
  requestingCommit: boolean;
  setSubmittingPrompt: Dispatch<SetStateAction<boolean>>;
  setSubmittingFollowupAction: Dispatch<
    SetStateAction<FollowupSubmissionAction | null>
  >;
  trackSubmitPromptTelemetry: Stable<(result: SubmitPromptResult) => void>;
  order: number;
}

/** The Commit capsule entry, its modal and its retry feedback. */
export const CommitCapsuleAction: React.FC<CommitCapsuleActionProps> = ({
  runId,
  providerRunId,
  provider,
  organizationId,
  projectId,
  agentSessionId,
  conversationId,
  interactionAccess,
  catalogSource,
  changedFiles,
  showAction,
  requestingCommit,
  setSubmittingPrompt,
  setSubmittingFollowupAction,
  trackSubmitPromptTelemetry,
  order,
}) => {
  const [modalOpen, setModalOpen, modalOpenOwnerKey] = useModalState(false);
  const [failure, setFailure] = useState<CommitFailure | null>(null);
  const failureGenerationRef = useRef(0);
  const submitCommitPrompt = useSubmitCommitPrompt({
    runId,
    providerRunId,
    provider,
    setSubmittingPrompt,
    setSubmittingFollowupAction,
    agentSessionId,
    conversationId,
    projectId,
    organizationId,
    trackSubmitPromptTelemetry,
    interactionAccess,
  });
  const blockedReason = resolveCommitBlockedReason(
    interactionAccess,
    changedFiles,
  );

  const runCommit = useCallback(
    async (submission: FollowupActionSubmission): Promise<void> => {
      setFailure((current) =>
        current ? { ...current, isRetrying: true } : null,
      );
      try {
        if (blockedReason !== null) {
          throw new Error(blockedReason);
        }
        await submitCommitPrompt(submission);
        setFailure(null);
      } catch (error) {
        const generation = ++failureGenerationRef.current;
        setFailure({
          submission,
          reason: toErrorMessage(error, "Commit could not be submitted."),
          failureIdentity: { reason: `commit:${String(generation)}` },
          isRetrying: false,
        });
      }
    },
    [blockedReason, submitCommitPrompt],
  );
  const retry = useCallback(() => {
    if (failure) void runCommit(failure.submission);
  }, [failure, runCommit]);
  const handleClick = useCallback(() => {
    if (blockedReason === null) setModalOpen(true);
  }, [blockedReason, setModalOpen]);
  const handleSubmit = useCallback(
    (submission: FollowupActionSubmission) => {
      setModalOpen(false);
      void runCommit(submission);
    },
    [runCommit, setModalOpen],
  );

  const feedback = failure
    ? ({
        status: "unavailable",
        presentationScope: "action",
        reason: blockedReason ?? failure.reason,
        errorCode: null,
        retryable: blockedReason === null,
        failureIdentity: failure.failureIdentity,
        retry,
        isRetrying: failure.isRetrying,
      } satisfies Extract<UnavailableOutcome, { presentationScope: "action" }>)
    : undefined;

  return (
    <>
      {showAction ? (
        <CapsuleAction
          behavior="click"
          id="commit"
          disabled={!feedback && blockedReason !== null}
          label="Commit"
          icon={CommitIcon}
          onClick={handleClick}
          feedback={feedback}
          inProgress={requestingCommit}
          actionGroup="page"
          tier="page"
          order={order}
        />
      ) : null}
      <ModalWorkOwner.Provider value={modalOpenOwnerKey}>
        <FollowupActionModal
          open={modalOpen}
          surfaceId={COMMIT_SURFACE_ID}
          catalogSource={catalogSource}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
          submitting={requestingCommit}
          title="Commit Changes"
          submitLabel="Commit"
          submittingLabel="Committing..."
          placeholder="Add any specific commit instructions... (optional)"
        />
      </ModalWorkOwner.Provider>
    </>
  );
};
