import { useConversationMessages } from "../../../data/hooks/useConversationMessages";
import {
  Box,
  Chip,
  ClickAwayListener,
  Link,
  CircularProgress,
  LinearProgress,
  Paper,
  Popper,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import type {
  AgentSessionDto,
  ConversationResponseDto,
  DesignDocResponseDto,
  InitiativeResponseDto,
  MessageResponseDto,
  ProposalResponseDto,
  ReportDto,
  ServiceDto,
  SystemMessage,
  TaskResponseDto,
  WorkItemTypeDefinitionDto,
  WorkItemTypeSectionDefinition,
} from "../../../api";
import {
  AgentSessionType,
  ProposalAction,
  TargetEntityType,
  WorkItemTypeSectionDefinitionKindEnum,
} from "../../../api";
import type { PlanWorkItem } from "../../../data/plans/canonicalPlan";
import {
  useEntityDetails,
  type EntityDetailsData,
} from "../../../data/hooks/useEntityDetails";
import { useConversation } from "../../../data/hooks/useConversation";
import { useLatestMessage } from "../../../data/hooks/useLatestMessage";
import { useWorkItemTypeByKey } from "../../../data/hooks/useWorkItemTypes";
import { KEYS } from "../../../i18n/keys";
import { resolvePreviewEntityType } from "../../../utils/mentionFormatting";
import {
  decodeHtmlCssSectionContent,
  getTaskSectionContent,
  selectWorkItemSections,
} from "../../../utils/workItemSections";
import { resolveProposalWorkItemSections } from "../../ProposalDispatchers/workItemProposalSections";
import { getProposalDisplayTitle } from "../../ProposalDispatchers/getProposalDisplayTitle";
import { HtmlCssSectionThumbnail } from "../HtmlCssSectionThumbnail";
import { MarkdownRenderer } from "../MarkdownRenderer";

const MAX_PREVIEW_CHARS = 500;
// Card maxWidth (400) minus horizontal padding (2 × 16).
const HTML_CSS_THUMBNAIL_WIDTH = 368;
const LATEST_MESSAGE_HOVER_DELAY_MS = 250;
const LATEST_MESSAGE_PROGRESS_INTERVAL_MS = 40;

type MessageHoverGate = {
  anchorEl: HTMLElement;
  entityId: string;
};

type MessageHoverProgress = MessageHoverGate & {
  value: number;
};

const truncateText = (text: string): string => {
  if (text.length <= MAX_PREVIEW_CHARS) {
    return text;
  }
  return text.slice(0, MAX_PREVIEW_CHARS) + "…";
};

const getFirstSectionContent = (
  sections: Array<{ key: string; materializedMarkdown: string }> | undefined,
): string => {
  if (!sections?.length) {
    return "";
  }

  return truncateText(sections[0].materializedMarkdown);
};

type TaskPreviewContent =
  | { kind: "markdown"; text: string }
  | {
      kind: "html/css";
      value: string;
      definition: WorkItemTypeSectionDefinition;
    }
  | null;

const MOCKUP_TYPE_KEY = "mockup";

type PreviewCandidate = {
  definition: WorkItemTypeSectionDefinition;
  value: string;
};

const isHtmlCssDefinition = (definition: WorkItemTypeSectionDefinition) =>
  definition.kind === WorkItemTypeSectionDefinitionKindEnum.HtmlCss;

// First populated previewable section in registry order. Mockup items
// always lead with their HTML/CSS mockup when one is populated.
const pickPreviewContent = (
  typeKey: string | undefined,
  candidates: readonly PreviewCandidate[],
): TaskPreviewContent => {
  const ordered =
    typeKey === MOCKUP_TYPE_KEY
      ? [...candidates].sort(
          (a, b) =>
            Number(isHtmlCssDefinition(b.definition)) -
            Number(isHtmlCssDefinition(a.definition)),
        )
      : candidates;
  for (const { definition, value } of ordered) {
    const kind =
      definition.kind ?? WorkItemTypeSectionDefinitionKindEnum.Markdown;
    if (
      kind !== WorkItemTypeSectionDefinitionKindEnum.Markdown &&
      kind !== WorkItemTypeSectionDefinitionKindEnum.HtmlCss
    ) {
      continue;
    }
    if (!value.trim()) continue;
    if (kind === WorkItemTypeSectionDefinitionKindEnum.HtmlCss) {
      if (!decodeHtmlCssSectionContent(value)) continue;
      return { kind: "html/css", value, definition };
    }
    return { kind: "markdown", text: truncateText(value) };
  }

  return null;
};

const getTaskPreviewContent = (
  entity: TaskResponseDto,
  sectionSelection: ReturnType<typeof selectWorkItemSections>,
): TaskPreviewContent => {
  if (sectionSelection.status !== "resolved") {
    return null;
  }

  return pickPreviewContent(
    entity.type,
    sectionSelection.sections.map((definition) => ({
      definition,
      value: getTaskSectionContent(entity.sections, definition.key),
    })),
  );
};

type ProposalSectionsUpdates = {
  type?: string;
  sections?: Array<{ key: string; content: unknown }>;
};

const getProposalSectionsUpdates = (
  proposal: ProposalResponseDto,
): ProposalSectionsUpdates =>
  (proposal.updates ?? {}) as ProposalSectionsUpdates;

const getProposalPreviewContent = (
  proposal: ProposalResponseDto,
  typeKey: string | undefined,
  definition: WorkItemTypeDefinitionDto | undefined,
): TaskPreviewContent => {
  if (!typeKey || !definition || definition.key !== typeKey) {
    return null;
  }

  return pickPreviewContent(
    typeKey,
    resolveProposalWorkItemSections({
      definition,
      proposedSections: getProposalSectionsUpdates(proposal).sections,
    }).map((section) => ({
      definition: section.definition,
      value: section.proposedContent,
    })),
  );
};

const getMessageContent = (message: MessageResponseDto): string => {
  if (message.type === "SYSTEM") {
    const systemMessage = message as SystemMessage;
    const response = systemMessage.data as unknown as
      Record<string, unknown> | undefined;
    if (typeof response?.response === "string" && response.response.trim()) {
      return truncateText(response.response);
    }
  }

  const messageData = message.data as Record<string, unknown> | undefined;
  if (!messageData) {
    return "";
  }

  if (typeof messageData.comment === "string" && messageData.comment.trim()) {
    return truncateText(messageData.comment);
  }

  if (typeof messageData.text === "string" && messageData.text.trim()) {
    return truncateText(messageData.text);
  }

  const agentInput = messageData.agentInput as
    Record<string, unknown> | undefined;
  if (
    typeof agentInput?.userMessage === "string" &&
    agentInput.userMessage.trim()
  ) {
    return truncateText(agentInput.userMessage);
  }

  const serialized = JSON.stringify(messageData, null, 2);
  return serialized && serialized !== "{}" ? truncateText(serialized) : "";
};

export interface EntityHoverCardProps {
  entityId: string;
  entityType: string;
  organizationId: string;
  projectId?: string;
  anchorEl: HTMLElement | null;
  onPopoverMouseEnter?: () => void;
  onPopoverMouseLeave?: () => void;
  placement?: "bottom-start" | "right-start";
  /** Canonical href; when set, the preview title navigates to it. */
  titleHref?: string;
  /**
   * Dismisses an explicitly opened preview on Escape or an outside click.
   * Clicks on the anchor are left to the anchor's own toggle.
   */
  onClose?: () => void;
  /** Moves focus into the preview when it opens, for keyboard activation. */
  focusOnOpen?: boolean;
}

export const EntityHoverCard: React.FC<EntityHoverCardProps> = ({
  entityId,
  entityType,
  organizationId,
  projectId,
  anchorEl,
  onPopoverMouseEnter,
  onPopoverMouseLeave,
  placement = "bottom-start",
  titleHref,
  onClose,
  focusOnOpen = false,
}) => {
  const { t } = useTranslation();
  const baseEntityType = resolvePreviewEntityType(entityType);
  const { data, isLoading, error } = useEntityDetails({
    entityId,
    entityType: baseEntityType,
    organizationId,
    projectId,
    enabled: !!anchorEl,
  });
  const agentSession =
    baseEntityType === "agent_session" && data
      ? (data as AgentSessionDto)
      : null;
  const entityConversationSession =
    agentSession?.type === AgentSessionType.EntityConversation
      ? agentSession
      : null;
  const entityConversationId = entityConversationSession?.conversationId ?? "";
  const conversation = useConversation(
    organizationId,
    projectId,
    { conversationId: entityConversationId },
    {
      enabled: Boolean(
        anchorEl && entityConversationSession && entityConversationId,
      ),
      enablePolling: false,
    },
  );
  const conversationTitle =
    anchorEl &&
    entityConversationSession &&
    conversation.data?.id === entityConversationId
      ? conversation.data.title?.trim()
      : undefined;
  const taskType =
    baseEntityType === "task" && data
      ? (data as TaskResponseDto).type
      : undefined;
  const workItemType = useWorkItemTypeByKey(
    organizationId,
    projectId,
    taskType,
  );
  const taskSectionSelection = selectWorkItemSections({
    typeKey: taskType,
    definition: workItemType.workItemTypeDefinition,
    isFetched: workItemType.isFetched,
  });
  const proposal =
    baseEntityType === "proposal" && data
      ? (data as ProposalResponseDto)
      : null;
  const proposalUpdates = proposal ? getProposalSectionsUpdates(proposal) : {};
  const isWorkItemProposal =
    proposal?.targetEntityType === TargetEntityType.Task &&
    Array.isArray(proposalUpdates.sections) &&
    proposalUpdates.sections.length > 0;
  // CREATE proposals carry their own type and a placeholder target ID that
  // must never be fetched; UPDATE proposals read the existing target's type.
  const isUpdateWorkItemProposal =
    isWorkItemProposal && proposal?.action === ProposalAction.Update;
  const proposalTarget = useEntityDetails({
    entityId: isUpdateWorkItemProposal ? proposal.targetEntityId : "",
    entityType: "task",
    organizationId,
    projectId,
    enabled: Boolean(anchorEl && isUpdateWorkItemProposal),
  });
  const proposalTypeKey =
    !anchorEl || !isWorkItemProposal
      ? undefined
      : proposal?.action === ProposalAction.Create
        ? proposalUpdates.type
        : isUpdateWorkItemProposal
          ? (proposalUpdates.type ??
            (proposalTarget.data as TaskResponseDto | null)?.type)
          : undefined;
  const proposalWorkItemType = useWorkItemTypeByKey(
    organizationId,
    projectId,
    proposalTypeKey,
  );
  const proposalPreview = proposal
    ? getProposalPreviewContent(
        proposal,
        proposalTypeKey,
        proposalWorkItemType.workItemTypeDefinition,
      )
    : null;
  const sessionConversationId = agentSession?.conversationId ?? undefined;
  const [messageHoverGate, setMessageHoverGate] =
    useState<MessageHoverGate | null>(null);
  const [messageHoverProgress, setMessageHoverProgress] =
    useState<MessageHoverProgress | null>(null);
  const isMessageHoverGateOpen =
    baseEntityType === "agent_session" &&
    Boolean(anchorEl) &&
    messageHoverGate?.anchorEl === anchorEl &&
    messageHoverGate.entityId === entityId;
  const latestMessageProgress =
    messageHoverProgress?.anchorEl === anchorEl &&
    messageHoverProgress.entityId === entityId
      ? messageHoverProgress.value
      : 0;

  useEffect(() => {
    if (baseEntityType !== "agent_session" || !anchorEl) {
      setMessageHoverGate(null);
      setMessageHoverProgress(null);
      return;
    }

    const identity = { anchorEl, entityId };
    const startedAt = Date.now();
    setMessageHoverGate(null);
    setMessageHoverProgress({ ...identity, value: 0 });

    const progressInterval = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setMessageHoverProgress({
        ...identity,
        value: Math.min((elapsed / LATEST_MESSAGE_HOVER_DELAY_MS) * 100, 100),
      });
    }, LATEST_MESSAGE_PROGRESS_INTERVAL_MS);
    const gateTimer = window.setTimeout(() => {
      window.clearInterval(progressInterval);
      setMessageHoverProgress({ ...identity, value: 100 });
      setMessageHoverGate(identity);
    }, LATEST_MESSAGE_HOVER_DELAY_MS);

    return () => {
      window.clearInterval(progressInterval);
      window.clearTimeout(gateTimer);
    };
  }, [anchorEl, baseEntityType, entityId]);

  const latestMessage = useLatestMessage(
    organizationId,
    projectId,
    sessionConversationId,
    {
      enabled: Boolean(isMessageHoverGateOpen && sessionConversationId),
    },
  );

  // Popper portals its content after mount, so focus from the ref callback
  // rather than an effect that would run before the Paper exists.
  const focusPaper = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && focusOnOpen && anchorEl) node.focus();
    },
    [anchorEl, focusOnOpen],
  );

  const paper = (
    <Paper
      ref={focusPaper}
      elevation={8}
      tabIndex={-1}
      onMouseEnter={onPopoverMouseEnter}
      onMouseLeave={onPopoverMouseLeave}
      onKeyDown={
        onClose
          ? (event: React.KeyboardEvent) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              onClose();
            }
          : undefined
      }
      data-testid="entity-hover-card"
      sx={{
        maxWidth: 400,
        maxHeight: 300,
        overflow: "auto",
        mt: 1,
      }}
    >
      <EntityHoverCardContent
        data={data}
        entityType={baseEntityType}
        isLoading={isLoading}
        error={error}
        errorLabel={t(KEYS.common.error)}
        latestMessage={latestMessage.data}
        isLatestMessageLoading={latestMessage.isLoading}
        latestMessageError={latestMessage.error}
        isLatestMessageEnabled={isMessageHoverGateOpen}
        latestMessageProgress={latestMessageProgress}
        taskSectionSelection={taskSectionSelection}
        conversationTitle={conversationTitle}
        proposalPreview={proposalPreview}
        titleHref={titleHref}
      />
    </Paper>
  );

  return (
    <Popper
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      placement={placement}
      sx={{ zIndex: (theme) => theme.zIndex.tooltip }}
    >
      {onClose ? (
        <ClickAwayListener
          onClickAway={(event) => {
            if (anchorEl?.contains(event.target as Node)) return;
            onClose();
          }}
        >
          {paper}
        </ClickAwayListener>
      ) : (
        paper
      )}
    </Popper>
  );
};

const EntityHoverCardContent: React.FC<{
  data: EntityDetailsData | null;
  entityType: string;
  isLoading: boolean;
  error: Error | null;
  errorLabel: string;
  latestMessage: MessageResponseDto | null;
  isLatestMessageLoading: boolean;
  latestMessageError: Error | null;
  isLatestMessageEnabled: boolean;
  latestMessageProgress: number;
  taskSectionSelection: ReturnType<typeof selectWorkItemSections>;
  conversationTitle?: string;
  proposalPreview: TaskPreviewContent;
  titleHref?: string;
}> = ({
  data,
  entityType,
  isLoading,
  error,
  errorLabel,
  latestMessage,
  isLatestMessageLoading,
  latestMessageError,
  isLatestMessageEnabled,
  latestMessageProgress,
  taskSectionSelection,
  conversationTitle,
  proposalPreview,
  titleHref,
}) => {
  if (isLoading) {
    return (
      <Box sx={{ p: 2, display: "flex", justifyContent: "center" }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="error" variant="caption">
          {errorLabel}
        </Typography>
      </Box>
    );
  }

  if (!data) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          No data available
        </Typography>
      </Box>
    );
  }

  switch (entityType) {
    case "initiative":
      return <InitiativePreview entity={data as InitiativeResponseDto} />;
    case "design_doc":
      return <DesignDocPreview entity={data as DesignDocResponseDto} />;
    case "task":
      return (
        <TaskPreview
          entity={data as TaskResponseDto}
          sectionSelection={taskSectionSelection}
          titleHref={titleHref}
        />
      );
    case "service":
      return <ServicePreview entity={data as ServiceDto} />;
    case "message":
      return <MessagePreview message={data as MessageResponseDto} />;
    case "conversation":
      return (
        <ConversationPreview conversation={data as ConversationResponseDto} />
      );
    case "agent_session":
      return (
        <AgentSessionPreview
          session={data as AgentSessionDto}
          latestMessage={latestMessage}
          isLatestMessageLoading={isLatestMessageLoading}
          latestMessageError={latestMessageError}
          isLatestMessageEnabled={isLatestMessageEnabled}
          latestMessageProgress={latestMessageProgress}
          conversationTitle={conversationTitle}
        />
      );
    case "plan":
      return <PlanPreview plan={data as PlanWorkItem} />;
    case "report":
      return <ReportPreview report={data as ReportDto} />;
    case "proposal":
      return (
        <ProposalPreview
          proposal={data as ProposalResponseDto}
          preview={proposalPreview}
          titleHref={titleHref}
        />
      );
    default:
      return null;
  }
};

const PreviewTitle: React.FC<{
  href?: string;
  children: React.ReactNode;
}> = ({ href, children }) => (
  <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
    {href ? (
      <Link
        component={RouterLink}
        to={href}
        color="inherit"
        underline="hover"
        data-testid="entity-hover-card-title-link"
      >
        {children}
      </Link>
    ) : (
      children
    )}
  </Typography>
);

const PreviewDescription: React.FC<{ text: string }> = ({ text }) => {
  if (!text) {
    return null;
  }

  return (
    <MarkdownRenderer
      allowMentionEscapes
      sx={{
        display: "-webkit-box",
        WebkitLineClamp: 6,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        mb: 1,
        color: "text.secondary",
        fontSize: "0.75rem",
        lineHeight: 1.4,
      }}
    >
      {text}
    </MarkdownRenderer>
  );
};

const StatusChip: React.FC<{ status?: string }> = ({ status }) => {
  if (!status) {
    return null;
  }

  return (
    <Box sx={{ mt: 1, mb: 1 }}>
      <Chip label={status} size="small" variant="outlined" />
    </Box>
  );
};

const TagList: React.FC<{ tags?: string[] }> = ({ tags }) => {
  if (!tags?.length) {
    return null;
  }

  return (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
      {tags.slice(0, 3).map((tag) => (
        <Chip key={tag} label={tag} size="small" variant="outlined" />
      ))}
    </Box>
  );
};

const InitiativePreview: React.FC<{
  entity: InitiativeResponseDto;
}> = ({ entity }) => {
  const description = getFirstSectionContent(entity.sections);

  return (
    <Box sx={{ p: 2, maxWidth: 400 }}>
      <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
        {entity.name}
      </Typography>
      <PreviewDescription text={description} />
      <StatusChip status={entity.status} />
      <TagList tags={entity.tags} />
    </Box>
  );
};

const DesignDocPreview: React.FC<{
  entity: DesignDocResponseDto;
}> = ({ entity }) => {
  const description = getFirstSectionContent(entity.sections);

  return (
    <Box sx={{ p: 2, maxWidth: 400 }}>
      <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
        {entity.name}
      </Typography>
      <PreviewDescription text={description} />
      <StatusChip status={entity.status} />
      <TagList tags={entity.tags} />
    </Box>
  );
};

const TaskPreview: React.FC<{
  entity: TaskResponseDto;
  sectionSelection: ReturnType<typeof selectWorkItemSections>;
  titleHref?: string;
}> = ({ entity, sectionSelection, titleHref }) => {
  const preview = getTaskPreviewContent(entity, sectionSelection);

  return (
    <Box sx={{ p: 2, maxWidth: 400 }}>
      <PreviewTitle href={titleHref}>{entity.name}</PreviewTitle>
      {preview?.kind === "html/css" ? (
        <Box sx={{ mb: 1 }}>
          <HtmlCssSectionThumbnail
            content={preview.value}
            definition={preview.definition}
            width={HTML_CSS_THUMBNAIL_WIDTH}
            title={`${entity.name} mockup thumbnail`}
          />
        </Box>
      ) : (
        <PreviewDescription text={preview?.text ?? ""} />
      )}
      <StatusChip status={entity.status} />
    </Box>
  );
};

const PlanPreview: React.FC<{ plan: PlanWorkItem }> = ({ plan }) => {
  const description = ["outcome", "description"]
    .map(
      (key) =>
        plan.sections?.find((section) => section.key === key)
          ?.materializedMarkdown,
    )
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n");
  const stageCount = plan.childCounts?.total ?? 0;

  return (
    <Box sx={{ p: 2, maxWidth: 400 }}>
      <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
        {plan.name}
      </Typography>
      <PreviewDescription text={truncateText(description)} />
      <StatusChip status={plan.status} />
      {stageCount > 0 && (
        <Typography variant="caption" color="text.secondary">
          {stageCount} {stageCount === 1 ? "stage" : "stages"}
        </Typography>
      )}
    </Box>
  );
};

const ReportPreview: React.FC<{ report: ReportDto }> = ({ report }) => (
  <Box sx={{ p: 2, maxWidth: 400 }}>
    <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
      {report.title}
    </Typography>
    <Typography color="text.secondary" variant="caption">
      {report.reportType}
    </Typography>
  </Box>
);

const ProposalPreview: React.FC<{
  proposal: ProposalResponseDto;
  preview: TaskPreviewContent;
  titleHref?: string;
}> = ({ proposal, preview, titleHref }) => {
  const title = getProposalDisplayTitle(proposal);

  return (
    <Box sx={{ p: 2, maxWidth: 400 }}>
      <PreviewTitle href={titleHref}>{title}</PreviewTitle>
      <Typography variant="caption" color="text.secondary">
        {proposal.action} {proposal.targetEntityType}
      </Typography>
      <StatusChip status={proposal.status} />
      {preview?.kind === "html/css" ? (
        <Box sx={{ mb: 1 }}>
          <HtmlCssSectionThumbnail
            content={preview.value}
            definition={preview.definition}
            width={HTML_CSS_THUMBNAIL_WIDTH}
            title={`${title} mockup thumbnail`}
          />
        </Box>
      ) : preview?.kind === "markdown" ? (
        <PreviewDescription text={preview.text} />
      ) : null}
    </Box>
  );
};

const ServicePreview: React.FC<{ entity: ServiceDto }> = ({ entity }) => (
  <Box sx={{ p: 2, maxWidth: 400 }}>
    <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
      {entity.name}
    </Typography>
    {entity.description && (
      <PreviewDescription text={truncateText(entity.description)} />
    )}
    <StatusChip status={entity.status} />
    {(entity.serviceType || entity.language || entity.framework) && (
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
        {entity.serviceType && (
          <Chip label={entity.serviceType} size="small" variant="outlined" />
        )}
        {entity.language && (
          <Chip label={entity.language} size="small" variant="outlined" />
        )}
        {entity.framework && (
          <Chip label={entity.framework} size="small" variant="outlined" />
        )}
      </Box>
    )}
  </Box>
);

const MessagePreview: React.FC<{ message: MessageResponseDto }> = ({
  message,
}) => {
  const content = getMessageContent(message);

  return (
    <Box sx={{ p: 2, maxWidth: 400 }}>
      <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
        Message
      </Typography>
      {content ? (
        <PreviewDescription text={content} />
      ) : (
        <Typography variant="caption" color="text.secondary">
          No content available
        </Typography>
      )}
    </Box>
  );
};

const ConversationPreview: React.FC<{
  conversation: ConversationResponseDto;
}> = ({ conversation }) => {
  const messageQuery = useConversationMessages(
    conversation.organizationId,
    conversation.projectId,
    conversation.id,
  );
  const messageCount = messageQuery.orderedData.length;
  const lastMessage =
    messageCount > 0 ? messageQuery.orderedData[messageCount - 1] : null;
  const lastMessageContent = lastMessage ? getMessageContent(lastMessage) : "";

  return (
    <Box sx={{ p: 2, maxWidth: 400 }}>
      <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
        {conversation.title ?? "Conversation"}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
        {messageQuery.error
          ? messageQuery.error.message
          : !messageQuery.isFetched
            ? "Loading messages…"
            : `${messageCount} ${messageCount === 1 ? "message" : "messages"}`}
      </Typography>
      {lastMessageContent && (
        <Box sx={{ mt: 1 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            fontWeight="bold"
          >
            Last message:
          </Typography>
          <PreviewDescription text={lastMessageContent} />
        </Box>
      )}
      <StatusChip status={conversation.status} />
    </Box>
  );
};

const AgentSessionPreview: React.FC<{
  session: AgentSessionDto;
  latestMessage: MessageResponseDto | null;
  isLatestMessageLoading: boolean;
  latestMessageError: Error | null;
  isLatestMessageEnabled: boolean;
  latestMessageProgress: number;
  conversationTitle?: string;
}> = ({
  session,
  latestMessage,
  isLatestMessageLoading,
  latestMessageError,
  isLatestMessageEnabled,
  latestMessageProgress,
  conversationTitle,
}) => {
  const latestMessageContent = latestMessage
    ? getMessageContent(latestMessage)
    : "";
  const isSystemMessage = latestMessage?.type === "SYSTEM";

  return (
    <Box sx={{ p: 2, maxWidth: 400 }}>
      <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
        {conversationTitle?.trim() || session.title}
      </Typography>
      {session.type === AgentSessionType.Coding && (
        <StatusChip status={session.status} />
      )}
      {session.provider && (
        <Typography variant="caption" color="text.secondary">
          {session.provider}
        </Typography>
      )}
      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary" fontWeight="bold">
          Latest message:
        </Typography>
        {!isLatestMessageEnabled ? (
          <LinearProgress
            aria-label="Waiting to load latest message"
            data-testid="agent-session-hover-card-message-delay"
            variant="determinate"
            value={latestMessageProgress}
            sx={{ mt: 0.75 }}
          />
        ) : isLatestMessageLoading ? (
          <Typography variant="caption" color="text.secondary" display="block">
            Loading latest message…
          </Typography>
        ) : latestMessageError ? (
          <Typography variant="caption" color="text.secondary" display="block">
            Latest message unavailable
          </Typography>
        ) : latestMessageContent ? (
          <Box
            data-testid="agent-session-hover-card-latest-message"
            data-message-type={latestMessage?.type.toLowerCase()}
            sx={(theme) => ({
              maxHeight: 128,
              overflow: "hidden",
              wordBreak: "break-word",
              ...(isSystemMessage && {
                backgroundColor:
                  theme.palette.mode === "dark"
                    ? theme.palette.primary.dark
                    : theme.palette.primary.light,
                border: `2px solid ${
                  theme.palette.attention?.main ?? theme.palette.primary.main
                }`,
                borderRadius: 1,
                boxShadow: `0 4px 12px ${
                  theme.palette.mode === "dark"
                    ? "rgba(8, 126, 139, 0.4)"
                    : "rgba(8, 126, 139, 0.16)"
                }`,
                color:
                  theme.palette.attention?.contrastText ??
                  theme.palette.primary.contrastText,
                p: 1,
              }),
              "& h1, & h2, & h3, & h4, & h5, & h6": {
                fontSize: "inherit",
                margin: 0,
                border: 0,
                padding: 0,
              },
              "& pre": { maxHeight: 96, overflow: "hidden", m: 0 },
            })}
          >
            <MarkdownRenderer
              allowMentionEscapes
              sx={{ color: "inherit", fontSize: "0.75rem", lineHeight: 1.4 }}
            >
              {latestMessageContent}
            </MarkdownRenderer>
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary" display="block">
            No messages yet
          </Typography>
        )}
      </Box>
    </Box>
  );
};
