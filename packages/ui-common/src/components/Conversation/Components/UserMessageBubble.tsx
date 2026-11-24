import {
  Box,
  Button,
  Chip,
  Stack,
  Typography,
  useTheme,
  type Theme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import React, { useState } from "react";
import type {
  RunAttachmentReference,
  UserMessageAgentInputProvenance,
} from "../../../api";
import {
  createDirectoryBindingApi,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../../AgentSession/runtime/directoryBindingApi";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import {
  getUserMessageAuthorship,
  MessageAuthorCaption,
} from "./MessageAuthorCaption";
import { useSentAttachmentOpenTarget } from "./SentAttachmentOpenContext";

/**
 * Where a user message stands. Canonical timeline messages are `delivered`;
 * temporary submission previews carry the state the server disposition gives.
 */
export type UserMessageDelivery =
  | { state: "delivered" }
  | { state: "sending" }
  | { state: "starting" }
  | { state: "awaiting-delivery" }
  | {
      state: "queued";
      cancelling: boolean;
      canCancel: boolean;
      onCancel: () => void;
      error: string | null;
    }
  | { state: "failed"; reason: string; onDismiss: () => void };

export interface UserMessageBubbleProps {
  /** Identity used for the caption test id; a Message id or a preview key. */
  identity: string;
  "data-testid": string;
  text: string | null;
  provenance: UserMessageAgentInputProvenance | null | undefined;
  author: { name: string; id: string | null } | null;
  createdAt: string | null;
  renderTimestamp: boolean;
  projectId: string;
  delivery: UserMessageDelivery;
  /** Stored references of files sent with the message; shown as chips. */
  attachments?: readonly RunAttachmentReference[];
  /** Rendered between the bubble and the caption (e.g. message proposals). */
  children?: React.ReactNode;
}

/**
 * Purple treatment for monitor-authored messages, so they never read as a
 * person's (blue) message or as plain agent text. It is self-contained: the
 * agent message it overrides has no bubble of its own.
 */
export const getMonitorVisualTreatmentSx = (theme: Theme) => ({
  backgroundColor: theme.palette.monitorMessage.soft,
  border: `1px solid ${theme.palette.monitorMessage.border}`,
  borderRadius: 1,
  p: { xs: 1.25, sm: 2 },
  boxShadow: "none",
  minHeight: "auto",
  color: theme.palette.text.primary,
  fontFamily: [
    '"Tilt Neon"',
    '"Fira Code"',
    '"Source Code Pro"',
    '"SF Mono"',
    '"Cascadia Code"',
    '"Consolas"',
    "monospace",
  ].join(","),
  fontSize: "1.1rem",
  lineHeight: 1.6,
});

/** Blue "your message" bubble surface shared by every place a person's message is shown. */
export const getHumanBubbleSx = (theme: Theme, failed = false) => {
  const yourMessage = theme.palette.conversationCard.roles.yourMessage;

  return {
    bgcolor: yourMessage.main,
    color: yourMessage.contrastText,
    border: `1px solid ${failed ? theme.palette.error.main : yourMessage.main}`,
  };
};

/**
 * The Markdown renderer sets its own page-colored text, headings, links and
 * fills, so the blue bubble's foreground has to be handed to it directly.
 */
export const getHumanMarkdownSx = (theme: Theme) => {
  const { contrastText } = theme.palette.conversationCard.roles.yourMessage;

  return {
    color: contrastText,
    "& h1, & h2, & h3, & h4, & h5, & h6, & blockquote, & a, & a:hover": {
      color: contrastText,
    },
    "& h1, & h2, & h3": { borderBottomColor: alpha(contrastText, 0.4) },
    "& blockquote": { borderLeftColor: contrastText },
    "& code, & pre, & th": { backgroundColor: alpha(contrastText, 0.18) },
    "& pre code": { backgroundColor: "transparent" },
    "& th, & td": { borderColor: alpha(contrastText, 0.4) },
  };
};

const DELIVERY_LABEL: Record<
  Exclude<UserMessageDelivery["state"], "delivered">,
  string
> = {
  sending: "Sending…",
  starting: "Starting…",
  "awaiting-delivery": "Awaiting delivery",
  queued: "Queued",
  failed: "Not sent",
};

/** Text-styled so inline actions keep the caption's line height. */
const INLINE_ACTION_SX = {
  minWidth: 0,
  p: 0,
  ml: 1,
  font: "inherit",
  lineHeight: "inherit",
  textTransform: "none",
  verticalAlign: "baseline",
  textDecoration: "underline",
  "&:hover": { background: "none", textDecoration: "underline" },
} as const;

/**
 * Delivery status rendered inline in the caption's timestamp slot — pending
 * inputs have no real date — so status changes never shift the layout.
 */
function DeliveryStatus({ delivery }: { delivery: UserMessageDelivery }) {
  if (delivery.state === "delivered") return null;
  return (
    <Box
      component="span"
      data-testid="user-message-delivery"
      data-delivery-state={delivery.state}
    >
      <Box
        component="span"
        role="status"
        sx={{ color: delivery.state === "failed" ? "error.main" : undefined }}
      >
        {DELIVERY_LABEL[delivery.state]}
        {delivery.state === "failed" ? ` · ${delivery.reason}` : null}
      </Box>
      {delivery.state === "queued" && (
        <Button
          disableRipple
          color="inherit"
          sx={INLINE_ACTION_SX}
          disabled={delivery.cancelling || !delivery.canCancel}
          onClick={delivery.onCancel}
        >
          {delivery.cancelling ? "Cancellation requested…" : "Cancel"}
        </Button>
      )}
      {delivery.state === "failed" && (
        <Button
          disableRipple
          color="inherit"
          sx={INLINE_ACTION_SX}
          onClick={delivery.onDismiss}
        >
          Dismiss
        </Button>
      )}
      {delivery.state === "queued" && delivery.error && (
        <Box component="span" role="alert" sx={{ color: "error.main", ml: 1 }}>
          {delivery.error}
        </Box>
      )}
    </Box>
  );
}

const ATTACHMENT_UNAVAILABLE = "Attachment unavailable";

/**
 * Chips for files sent with a message. With a verified same-machine CLI for
 * the conversation's Run they open (images) or reveal (other files) the stored
 * file on that computer; otherwise they stay inert name-only chips. The files
 * go away with their Run, so a failed open shows one short notice, makes no
 * retry and changes nothing else.
 */
export function SentAttachmentChips({
  attachments,
  sx,
}: {
  attachments: readonly RunAttachmentReference[] | undefined;
  sx?: Record<string, unknown>;
}) {
  const target = useSentAttachmentOpenTarget();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  if (!attachments?.length) return null;

  const open = async (attachment: RunAttachmentReference) => {
    if (!target || pendingId) return;
    setPendingId(attachment.attachmentId);
    setUnavailable(false);
    try {
      await createDirectoryBindingApi(
        resolveLocalDirectoryRuntimeBaseUrl(),
      ).openRunAttachment(
        target.runId,
        attachment.attachmentId,
        target.machineId,
        attachment.fileName,
      );
    } catch {
      setUnavailable(true);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Box data-testid="sent-attachments" sx={{ minWidth: 0, ...sx }}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}
      >
        {attachments.map((attachment) => (
          <Chip
            key={attachment.attachmentId}
            size="small"
            data-testid="sent-attachment-chip"
            data-attachment-id={attachment.attachmentId}
            label={attachment.fileName}
            sx={{ maxWidth: "100%" }}
            {...(target
              ? {
                  onClick: () => void open(attachment),
                  disabled: pendingId !== null,
                  "aria-label": `Open attachment ${attachment.fileName}`,
                }
              : {})}
          />
        ))}
      </Stack>
      {unavailable && (
        <Typography
          role="status"
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", textAlign: "right" }}
        >
          {ATTACHMENT_UNAVAILABLE}
        </Typography>
      )}
    </Box>
  );
}

/**
 * The one user-message presentation, shared by canonical messages and
 * temporary submission previews so a submission keeps its look on confirmation.
 */
export function UserMessageBubble({
  identity,
  "data-testid": dataTestId,
  text,
  provenance,
  author,
  createdAt,
  renderTimestamp,
  projectId,
  delivery,
  attachments,
  children,
}: UserMessageBubbleProps) {
  const theme = useTheme();
  const isMonitor = getUserMessageAuthorship(provenance) === "monitor";
  const isPending = delivery.state !== "delivered";
  const hasAttachments = Boolean(attachments?.length);
  const humanBubbleSx = getHumanBubbleSx(theme, delivery.state === "failed");
  const humanMarkdownSx = getHumanMarkdownSx(theme);
  return (
    <Box
      data-testid="user-message-presentation"
      data-authorship={isMonitor ? "monitor" : "human"}
      sx={{
        display: "flow-root",
        // Your messages sit on the right; monitor messages stay on the left
        // so they are never mistaken for something you wrote.
        ...(isMonitor ? {} : { ml: "auto" }),
        ...(hasAttachments || !isMonitor
          ? { width: "fit-content", maxWidth: "min(100%, max(600px, 90%))" }
          : {}),
      }}
    >
      {text ? (
        <Box
          data-testid={dataTestId}
          aria-busy={isPending && delivery.state !== "failed"}
          data-user-message-provenance={provenance ?? undefined}
          sx={{
            opacity: isPending ? 0.7 : 1,
            ...(isMonitor
              ? {
                  display: "inline-flex",
                  maxWidth: hasAttachments
                    ? "100%"
                    : "min(100%, max(600px, 90%))",
                  ...(hasAttachments ? { width: "100%" } : {}),
                }
              : {
                  // Fits its text and sits at the right edge, above the
                  // right-justified caption and chips.
                  display: "flex",
                  width: "fit-content",
                  maxWidth: "100%",
                  ml: "auto",
                }),
            boxSizing: "border-box",
            p: { xs: 1.25, sm: 2 },
            borderRadius: isMonitor ? 1 : 2,
            mb: 3,
            ...(isMonitor ? getMonitorVisualTreatmentSx(theme) : humanBubbleSx),
          }}
        >
          <Typography
            component="div"
            sx={{
              width: "100%",
              minWidth: 0,
              maxWidth: "100%",
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            <MarkdownRenderer sx={isMonitor ? undefined : humanMarkdownSx}>
              {text}
            </MarkdownRenderer>
          </Typography>
        </Box>
      ) : null}
      {children}
      <Box
        data-testid="user-message-footer"
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1,
          mb: 2,
          // Human messages: chips first, caption at the bubble's right edge.
          ...(isMonitor ? {} : { justifyContent: "flex-end" }),
        }}
      >
        {isMonitor ? null : (
          <SentAttachmentChips
            attachments={attachments}
            sx={{ maxWidth: "100%", flex: "0 1 auto" }}
          />
        )}
        <MessageAuthorCaption
          messageId={identity}
          createdAt={createdAt}
          renderTimestamp={renderTimestamp}
          userMessageProvenance={provenance}
          userName={isMonitor ? undefined : author?.name}
          userId={isMonitor ? undefined : author?.id}
          projectId={projectId}
          status={
            isPending ? <DeliveryStatus delivery={delivery} /> : undefined
          }
          sx={{
            display: "block",
            mt: 0,
            mb: 0,
            flexShrink: 0,
            maxWidth: "100%",
          }}
        />
        {isMonitor ? (
          <SentAttachmentChips
            attachments={attachments}
            sx={{ ml: "auto", maxWidth: "100%", flex: "0 1 auto" }}
          />
        ) : null}
      </Box>
    </Box>
  );
}
