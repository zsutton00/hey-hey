import { Box } from "@mui/material";
import React, { useLayoutEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  MessageStatus,
  MessageType,
  type PaginatedAgentSessionItemDto,
  type SystemMessageData,
  type UserMessageData,
} from "../../api";
import { AgentSessionCurrentStateIndicator } from "../AgentSession/AgentSessionCurrentStateIndicator";
import { getAgentSessionCurrentStatePresentation } from "../AgentSession/agentSessionCurrentStatePresentation";
import { SystemMessage } from "../Conversation/Components/SystemMessage";
import { EntityListItem } from "../Entity/EntityListItem";
import { agentSessionAdapter } from "../Entity/adapters";
import {
  InterstitialThought,
  isInterstitialMessageData,
  splitInterstitialThoughts,
} from "../LlmForms/Registry/InterstitialField";
import {
  MetadataDisclosure,
  type MetadataDisclosureRow,
} from "../shared/MetadataDisclosure";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { EntityConversationTitle } from "./EntityConversationTitle";

export type AgentSessionListItemVariant = "coding" | "conversations";

type SessionMessagePresentation =
  | {
      kind: "system";
      messageData: SystemMessageData;
      text: string;
    }
  | {
      kind: "interstitial";
      messageData: SystemMessageData;
      thought: string;
    }
  | {
      kind: "user";
      text: string;
    };

const PERMISSION_REQUEST_DECISION_LABELS: Record<string, string> = {
  approve: "Request approved",
  always_approve: "Request approved",
  whitelist: "Request approved",
  deny: "Request denied",
};

const getSessionMessagePresentation = (
  messageData: SystemMessageData
): SessionMessagePresentation => {
  const permissionRequestElement = messageData.uiElements?.find(
    (element) => element.type === "agent-request-permission"
  );
  const payload = permissionRequestElement?.payload;
  const decision =
    payload && typeof payload === "object" && "decision" in payload
      ? payload.decision
      : undefined;
  const resolvedPermissionText =
    typeof decision === "string"
      ? PERMISSION_REQUEST_DECISION_LABELS[decision]
      : undefined;
  const responseText =
    typeof messageData.response === "string" ? messageData.response : "";

  if (resolvedPermissionText) {
    return {
      kind: "system",
      messageData: { ...messageData, response: resolvedPermissionText },
      text: resolvedPermissionText,
    };
  }

  const finalThought = isInterstitialMessageData(messageData)
    ? splitInterstitialThoughts(responseText).at(-1)
    : undefined;

  return finalThought
    ? { kind: "interstitial", messageData, thought: finalThought }
    : { kind: "system", messageData, text: responseText };
};

export interface AgentSessionListItemProps {
  buildSessionPath?: (agentSessionId: string) => string;
  item: PaginatedAgentSessionItemDto;
  onDeleteSession?: () => void | Promise<void>;
  onSessionNavigate?: () => void;
  projectId: string;
  variant: AgentSessionListItemVariant;
}

const getSessionMetadata = (
  metadata: readonly MetadataDisclosureRow[] | undefined
): readonly MetadataDisclosureRow[] | undefined =>
  metadata && metadata.length > 0 ? metadata : undefined;

export const AgentSessionListItem: React.FC<AgentSessionListItemProps> = ({
  buildSessionPath,
  item,
  onDeleteSession,
  onSessionNavigate,
  projectId,
  variant,
}) => {
  const { agentSession, lastMessage, reports, services } = item;
  const sessionProps = agentSessionAdapter.toEntityListItemProps(agentSession, {
    projectId,
    showEntityKind: false,
  });
  const {
    href: sessionHref,
    metadata: sessionMetadata,
    status: lifecycleStatus,
    ...sessionItemPropsWithoutStatus
  } = sessionProps;
  const resolvedSessionHref = buildSessionPath
    ? buildSessionPath(agentSession.id)
    : sessionHref;
  const isCoding = variant === "coding";
  const currentStateLabel = isCoding
    ? undefined
    : getAgentSessionCurrentStatePresentation(agentSession.currentState).label;
  const conversationTitle = agentSession.title || "Untitled agent session";
  const title = (
    <EntityConversationTitle
      conversationTitle={conversationTitle}
      entityId={agentSession.entityId}
    />
  );
  const sessionItemProps = isCoding
    ? { ...sessionItemPropsWithoutStatus, status: lifecycleStatus, title }
    : currentStateLabel === undefined
    ? {
        ...sessionItemPropsWithoutStatus,
        metadata: getSessionMetadata(sessionMetadata),
        title,
      }
    : {
        ...sessionItemPropsWithoutStatus,
        metadata: getSessionMetadata(sessionMetadata),
        status: currentStateLabel,
        title,
      };
  const contextTags = [
    ...(sessionProps.tags ?? []),
    ...services.map((service) =>
      service.id === agentSession.launchServiceId
        ? `Launch service: ${service.name}`
        : `Service: ${service.name}`
    ),
  ];
  const userMessageText =
    lastMessage?.type === MessageType.User
      ? (lastMessage.data as UserMessageData).agentInput?.userMessage
      : undefined;
  const messagePresentation: SessionMessagePresentation | null =
    lastMessage?.type === MessageType.System
      ? getSessionMessagePresentation(lastMessage.data as SystemMessageData)
      : typeof userMessageText === "string" && userMessageText.trim()
      ? { kind: "user", text: userMessageText }
      : null;
  const itemName = isCoding ? "coding-session" : "conversation";
  const messagePreviewRef = useRef<HTMLDivElement | null>(null);
  const messagePreviewContentRef = useRef<HTMLDivElement | null>(null);
  const [isMessagePreviewOverflowing, setIsMessagePreviewOverflowing] =
    useState(false);

  useLayoutEffect(() => {
    const preview = messagePreviewRef.current;
    const content = messagePreviewContentRef.current;
    if (!preview || !content) {
      setIsMessagePreviewOverflowing(false);
      return;
    }

    const updateOverflow = () => {
      setIsMessagePreviewOverflowing(
        content.scrollHeight > preview.clientHeight + 1
      );
    };

    updateOverflow();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(content);
    return () => observer.disconnect();
  }, [lastMessage?.id, reports]);

  return (
    <Box
      {...(resolvedSessionHref
        ? {
            component: RouterLink,
            onClick: onSessionNavigate,
            to: resolvedSessionHref,
          }
        : { component: "div" })}
      data-testid={`${itemName}-container-${agentSession.id}`}
      sx={{
        backgroundColor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        color: "inherit",
        display: "block",
        overflow: "hidden",
        textDecoration: "none",
        "&:hover": {
          backgroundColor: "action.hover",
        },
        "& .MuiListItem-root": {
          backgroundColor: "transparent",
          border: 0,
          borderRadius: 0,
          mb: 0,
          "&:hover": {
            backgroundColor: "transparent",
          },
        },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <EntityListItem
          {...sessionItemProps}
          statusLeadingAdornment={
            isCoding ? (
              <AgentSessionCurrentStateIndicator
                currentState={agentSession.currentState}
                presentation="icon"
              />
            ) : undefined
          }
          tags={isCoding ? undefined : [...new Set(contextTags)]}
          titleStatusLayout="row"
          onDelete={
            onDeleteSession
              ? () => {
                  void onDeleteSession();
                }
              : undefined
          }
        />
      </Box>
      {lastMessage && messagePresentation ? (
        <Box
          data-testid={`${itemName}-message-${agentSession.id}`}
          ref={messagePreviewRef}
          sx={{
            borderRadius: 1,
            mb: 0.75,
            maxHeight: 200,
            ml: { xs: 2, sm: 6 },
            minWidth: 0,
            mr: 1.5,
            mt: 1,
            overflow: "hidden",
            position: "relative",
            ...(!isCoding && {
              "&::after": {
                background: (theme) =>
                  `linear-gradient(to bottom, rgba(0, 0, 0, 0), ${theme.palette.background.paper})`,
                bottom: 0,
                content: '""',
                height: 64,
                left: 0,
                pointerEvents: "none",
                position: "absolute",
                right: 0,
              },
            }),
          }}
        >
          <Box
            data-testid={`${itemName}-message-content-${agentSession.id}`}
            ref={messagePreviewContentRef}
          >
            {messagePresentation.kind === "user" ? (
              <MarkdownRenderer>{messagePresentation.text}</MarkdownRenderer>
            ) : messagePresentation.kind === "interstitial" ? (
              <InterstitialThought
                inlineReports={reports}
                isActive={lastMessage.status !== MessageStatus.Completed}
                messageType={messagePresentation.messageData.type ?? "N/A"}
                position="only"
                thought={messagePresentation.thought}
              />
            ) : (
              <SystemMessage
                animationType="minimal"
                enableTypingAnimation={false}
                inlineReports={reports}
                isCompleted={lastMessage.status === MessageStatus.Completed}
                messageData={messagePresentation.messageData}
                text={messagePresentation.text}
                type={messagePresentation.messageData.type ?? "N/A"}
              />
            )}
          </Box>
          {isCoding && isMessagePreviewOverflowing ? (
            <Box
              aria-hidden
              data-testid="coding-session-message-overflow-indicator"
              sx={{
                alignItems: "center",
                backgroundColor: "background.paper",
                border: 1,
                borderColor: "divider",
                borderRadius: "999px",
                bottom: 1,
                boxShadow: 1,
                color: "text.secondary",
                display: "flex",
                fontSize: "1rem",
                height: 24,
                justifyContent: "center",
                left: "50%",
                minWidth: 36,
                pointerEvents: "none",
                position: "absolute",
                transform: "translateX(-50%)",
              }}
            >
              …
            </Box>
          ) : null}
        </Box>
      ) : null}
      {isCoding && sessionMetadata?.[0] ? (
        <Box
          data-testid={`${itemName}-metadata-footer-${agentSession.id}`}
          sx={{ display: "flex", justifyContent: "flex-end", px: 1.5, pb: 1.5 }}
        >
          <MetadataDisclosure
            rows={sessionMetadata}
            title="More details"
            testIdPrefix="entity-list-item-metadata"
            mobileBreakpoint="md"
            mobileTrigger={{
              primaryRow: sessionMetadata[0],
              closedAriaLabel: "Show more details",
              openAriaLabel: "Hide more details",
            }}
            desktopJustifyContent="flex-end"
            desktopChipVariant="muted"
            sx={{ maxWidth: "100%", width: "fit-content" }}
          />
        </Box>
      ) : null}
    </Box>
  );
};
