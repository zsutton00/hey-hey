import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { Alert, Box, Button, Typography } from "@mui/material";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  inputScope,
  recordShownPreviews,
  removeOptimisticInput,
  selectSubmissionPreviews,
  useOptimisticInputs,
  type SubmissionPreview,
} from "../../data/collections/optimisticConversationInputs";
import { useConversationMessages } from "../../data/hooks/useConversationMessages";
import { cancelQueuedInput } from "../AgentSession/operations/AgentOperationProvider";
import {
  SentAttachmentChips,
  UserMessageBubble,
  type UserMessageDelivery,
} from "./Components/UserMessageBubble";

const CANCELLED_NOTICE = "Message cancelled";
const NOTICE_DURATION_MS = 6000;

export interface SubmissionPreviewsProps {
  organizationId: string;
  projectId: string;
  conversationId: string;
  agentSessionId: string;
}

/**
 * Submissions that have not entered the timeline, rendered directly after it.
 * Sending, starting, pending and failed submissions use the shared
 * user-message presentation; queued ones sit as compact cards in a separate
 * queued section, since they are not part of the conversation until they
 * start. Each submission appears once; its state follows the server's
 * admission disposition.
 */
export function SubmissionPreviews(props: SubmissionPreviewsProps) {
  const { organizationId, projectId, conversationId } = props;
  const messages = useConversationMessages(
    organizationId,
    projectId,
    conversationId,
    { refetchOnMount: false },
  );
  const optimistic = useOptimisticInputs();
  const scope = inputScope(organizationId, projectId, conversationId);
  const previews = useMemo(
    () =>
      selectSubmissionPreviews(
        scope,
        messages.orderedData,
        messages.undatedInputs,
        optimistic,
      ),
    [scope, messages.orderedData, messages.undatedInputs, optimistic],
  );
  useLayoutEffect(() => {
    recordShownPreviews(
      scope,
      previews.flatMap((preview) => preview.identities),
    );
  }, [scope, previews]);

  const [requests, setRequests] = useState<ReadonlySet<string>>(new Set());
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<
    ReadonlySet<string>
  >(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  // A fresh object per notice restarts the dismiss timer when the same text repeats.
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!awaitingConfirmation.size) return;
    // A cancelled input never gets a date, so it stays among the undated inputs.
    const settled = messages.undatedInputs.filter(
      (message) =>
        awaitingConfirmation.has(message.id) &&
        message.executionStatus !== "queued",
    );
    if (!settled.length) return;
    if (settled.some((message) => message.executionStatus === "cancelled"))
      setNotice({ text: CANCELLED_NOTICE });
    setAwaitingConfirmation((previous) => {
      const next = new Set(previous);
      for (const message of settled) next.delete(message.id);
      return next;
    });
  }, [awaitingConfirmation, messages.undatedInputs]);

  const cancel = async (messageId: string, operationId: string) => {
    setErrors((previous) => {
      const next = new Map(previous);
      next.delete(messageId);
      return next;
    });
    setRequests((previous) => new Set(previous).add(messageId));
    try {
      const outcome = await cancelQueuedInput({
        ...props,
        operationId,
        messageId,
      });
      if (outcome.executionStatus === "started")
        setNotice({ text: "This message has already started." });
      else if (outcome.executionStatus === "cancelled")
        setNotice({ text: CANCELLED_NOTICE });
      else
        setAwaitingConfirmation((previous) => new Set(previous).add(messageId));
      await messages.refetch();
    } catch (failure) {
      setErrors((previous) =>
        new Map(previous).set(
          messageId,
          failure instanceof Error
            ? failure.message
            : "Cancellation could not be requested.",
        ),
      );
    } finally {
      setRequests((previous) => {
        const next = new Set(previous);
        next.delete(messageId);
        return next;
      });
    }
  };

  const deliveryOf = (preview: SubmissionPreview): UserMessageDelivery => {
    const { state } = preview;
    switch (state.kind) {
      case "queued": {
        const { messageId, operationId } = state;
        return {
          state: "queued",
          cancelling: state.cancellationRequested || requests.has(messageId),
          canCancel: operationId !== null,
          onCancel: () => {
            if (operationId) void cancel(messageId, operationId);
          },
          error: errors.get(messageId) ?? null,
        };
      }
      case "failed":
        return {
          state: "failed",
          reason: state.reason,
          onDismiss: () => removeOptimisticInput(state.operationId),
        };
      case "sending":
      case "starting":
      case "awaiting-delivery":
        return { state: state.kind };
    }
  };

  const queuedPreviews = previews.filter(
    (preview) => preview.state.kind === "queued",
  );
  const messagePreviews = previews.filter(
    (preview) => preview.state.kind !== "queued",
  );

  if (!previews.length && !notice) return null;
  return (
    <>
      {notice && (
        <Alert
          severity="info"
          onClose={
            notice.text === CANCELLED_NOTICE ? undefined : () => setNotice(null)
          }
        >
          {notice.text}
        </Alert>
      )}
      {messagePreviews.length > 0 && (
        <Box
          component="section"
          aria-label="Submitted messages"
          data-testid="submission-previews"
          sx={{ minWidth: 0, maxWidth: "100%" }}
        >
          {messagePreviews.map((preview) => (
            <Box
              key={preview.key}
              data-testid="submission-preview"
              data-preview-key={preview.key}
              data-delivery-state={preview.state.kind}
              sx={{ mb: 1, minWidth: 0, maxWidth: "100%" }}
            >
              <UserMessageBubble
                identity={preview.key}
                data-testid={`submission-preview-message-${preview.key}`}
                text={preview.text ?? "Submitted input"}
                provenance={preview.provenance}
                author={preview.author}
                createdAt={null}
                renderTimestamp={false}
                projectId={projectId}
                delivery={deliveryOf(preview)}
                attachments={preview.attachments}
              />
            </Box>
          ))}
        </Box>
      )}
      {queuedPreviews.length > 0 && (
        <Box
          component="section"
          aria-label="Queued messages"
          data-testid="queued-previews"
          sx={{ minWidth: 0, maxWidth: "100%", mb: 2 }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <AccessTimeIcon fontSize="small" color="disabled" />
            <Typography variant="caption" color="text.secondary">
              Queued · {queuedPreviews.length}
            </Typography>
            <Typography variant="caption" color="text.disabled">
              Sent when the agent is ready
            </Typography>
          </Box>
          {queuedPreviews.map((preview) => {
            const delivery = deliveryOf(preview);
            if (delivery.state !== "queued") return null;
            return (
              <Box
                key={preview.key}
                data-testid="submission-preview"
                data-preview-key={preview.key}
                data-delivery-state={preview.state.kind}
                sx={{
                  mb: 1,
                  px: 1.5,
                  py: 1,
                  border: 1,
                  borderStyle: "dashed",
                  borderColor: "divider",
                  borderRadius: 1,
                  opacity: delivery.cancelling ? 0.6 : 1,
                  minWidth: 0,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <AccessTimeIcon fontSize="small" color="disabled" />
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    noWrap
                    sx={{ flex: 1, minWidth: 0, fontStyle: "italic" }}
                  >
                    {preview.text ?? "Submitted input"}
                  </Typography>
                  {delivery.canCancel && (
                    <Button
                      size="small"
                      onClick={delivery.onCancel}
                      disabled={delivery.cancelling}
                    >
                      {delivery.cancelling ? "Cancelling…" : "Cancel"}
                    </Button>
                  )}
                </Box>
                <SentAttachmentChips
                  attachments={preview.attachments}
                  sx={{ mt: 0.5 }}
                />
                {delivery.error && (
                  <Typography variant="caption" color="error" role="alert">
                    {delivery.error}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </>
  );
}
