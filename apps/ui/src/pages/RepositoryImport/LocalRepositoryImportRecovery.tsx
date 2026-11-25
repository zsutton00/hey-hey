import {
  ConversationStatus,
  type ConversationResponseDto,
} from "@hey-hey/contracts/api";
import { useStartConversation } from "@hey-hey/ui-common/data";
import { Alert, Button } from "@mui/material";
import { useTranslation } from "react-i18next";

export function LocalRepositoryImportRecovery({
  conversation,
  onRecovered,
}: {
  conversation: ConversationResponseDto;
  onRecovered: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { mutate, isPending, error } = useStartConversation({
    onSuccess: () => void onRecovered(),
  });

  if (
    conversation.status !== ConversationStatus.Failed &&
    conversation.status !== ConversationStatus.Recoverable &&
    conversation.status !== ConversationStatus.Started &&
    conversation.status !== ConversationStatus.NotStarted
  ) {
    return null;
  }

  const handleRetry = () => {
    void mutate({
      organizationId: conversation.organizationId,
      projectId: conversation.projectId,
      conversationId: conversation.id,
    }).catch(() => {
      // The mutation supplies the error for the alert.
    });
  };

  return (
    <Alert
      severity={error ? "error" : "info"}
      action={
        <Button disabled={isPending} onClick={handleRetry}>
          {t("common.retry", { defaultValue: "Retry" })}
        </Button>
      }
    >
      {error?.message ??
        t("repositoryImport.recovery.message", {
          defaultValue: "Resume setup for this repository import.",
        })}
    </Alert>
  );
}
