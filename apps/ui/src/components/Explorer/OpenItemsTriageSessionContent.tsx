import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAgentSession } from "@hey-hey/ui-common/data";
import {
  OpenItemsTriagePage,
  type OpenItemsTriageReviewBinding,
} from "./OpenItemsTriageContent";
import { TriageModalState } from "./TriageModalState";
import { TriageLoading } from "./TriageLoading";

export function OpenItemsTriageSessionContent({
  organizationId,
  projectId,
  agentSessionId,
  onClose,
  onSessionFailed,
  review,
}: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  onClose: () => void;
  onSessionFailed: (message: string) => void;
  review: OpenItemsTriageReviewBinding;
}) {
  const { t } = useTranslation();
  const { agentSession, error } = useAgentSession(
    organizationId,
    projectId,
    agentSessionId,
  );
  const failure = error
    ? error instanceof Error
      ? error.message
      : t("triage.sessionError", "Unable to open triage.")
    : agentSession && !agentSession.conversationId
      ? t("triage.conversationError", "The triage conversation is unavailable.")
      : null;
  useEffect(() => {
    if (failure) onSessionFailed(failure);
  }, [failure, onSessionFailed]);
  if (!agentSession || failure)
    return (
      <TriageModalState onClose={onClose}>
        {review.closeGate ?? <TriageLoading />}
      </TriageModalState>
    );
  return (
    <OpenItemsTriagePage
      organizationId={organizationId}
      projectId={projectId}
      agentSession={agentSession}
      pageIdentity="observational"
      onClose={onClose}
      review={review}
    />
  );
}
