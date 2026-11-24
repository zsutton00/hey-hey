import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import SyncAlt from "@mui/icons-material/SyncAlt";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { useApolloClient } from "@apollo/client/react";
import React, { useCallback, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  ReportType,
  SuggestionType,
  type CodingResearchUpdate,
  type ReportDto,
} from "../../../api";
import { usePathService } from "../../../contexts";
import { refreshConversation } from "../../../data/graphql/conversationCache";
import { useSuggestionDecision } from "../../../data/hooks/useSuggestionDecision";
import { log } from "../../../utils/logger";
import { MachinePicker } from "../../AgentSession/MachinePicker";
import { SessionErrorAlert } from "../../AgentSession/SessionErrorAlert";
import { supportsFastMode } from "../../AgentSession/capabilityCatalog";
import { useMachineResolution } from "../../AgentSession/runtime/coding/useMachineResolution";
import { DISCUSS_SURFACE_ID } from "../../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../../AgentSession/useSurfaceSelection";
import type { EntityConversationProjectAssistantConfig } from "../../InteractionComponent/graphConversationLaunchInput";
import { useEntityConversationLauncher } from "../../InteractionComponent/useEntityConversationLauncher";
import { narrowReportPayload } from "../../Reports/viewer/rendererContract";
import {
  buildProposedUpdateDiscussionPrompt,
  buildProposedUpdateKeys,
} from "../../Reports/viewer/codingResearchProposedUpdate";
import {
  createCodingResearchFrameModel,
  getCodingResearchFocalNode,
  type CodingResearchFrameNode,
} from "../../Reports/viewer/codingResearchReportModel";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import {
  ConversationCard,
  ConversationCardRelatedRows,
  ConversationCardSection,
} from "../Card";
import { useConversationContext } from "./ConversationContext";

const PROJECT_ASSISTANT_DISABLED = {
  enabled: false,
} as const satisfies EntityConversationProjectAssistantConfig;

const OPERATION_LABELS: Record<CodingResearchUpdate["type"], string> = {
  add: "Add",
  remove: "Remove",
  update: "Update",
};

/** What a conversation message knows that its update cards need. */
export interface ProposedUpdateCardContext {
  messageId: string;
  conversationId: string;
  organizationId: string;
  projectId: string;
}

export interface ReportProposedUpdatesProps {
  report: ReportDto;
  context: ProposedUpdateCardContext;
}

/**
 * Project Assistant's proposed updates as one card each, placed after the
 * report message in the order it gave them. Written reports and reports
 * without updates render nothing.
 */
export const ReportProposedUpdates: React.FC<ReportProposedUpdatesProps> = ({
  report,
  context,
}) => {
  const payload =
    report.reportType === ReportType.CodingResearch
      ? narrowReportPayload(report)
      : null;
  if (
    !payload ||
    payload.reportType !== ReportType.CodingResearch ||
    payload.format === "SUBAGENT_PARENT"
  ) {
    return null;
  }

  const updates = payload.updates ?? [];
  if (updates.length === 0) {
    return null;
  }

  return (
    <ProposedUpdateCards
      context={context}
      focalNode={getCodingResearchFocalNode(
        createCodingResearchFrameModel(payload.frame),
      )}
      report={report}
      updates={updates}
    />
  );
};

interface ProposedUpdateCardsProps {
  report: ReportDto;
  context: ProposedUpdateCardContext;
  updates: CodingResearchUpdate[];
  focalNode: CodingResearchFrameNode | null;
}

const ProposedUpdateCards: React.FC<ProposedUpdateCardsProps> = ({
  report,
  context,
  updates,
  focalNode,
}) => {
  const keys = useMemo(
    () => buildProposedUpdateKeys(context.messageId, updates),
    [context.messageId, updates],
  );

  return (
    <Stack spacing={1.5} data-testid="report-proposed-updates">
      {updates.map((update, index) => (
        <ProposedUpdateCard
          context={context}
          decisionKey={keys[index]}
          focalNode={focalNode}
          key={keys[index]}
          report={report}
          update={update}
        />
      ))}
    </Stack>
  );
};

interface ProposedUpdateCardProps {
  report: ReportDto;
  context: ProposedUpdateCardContext;
  update: CodingResearchUpdate;
  decisionKey: string;
  focalNode: CodingResearchFrameNode | null;
}

const ProposedUpdateCard: React.FC<ProposedUpdateCardProps> = ({
  report,
  context,
  update,
  decisionKey,
  focalNode,
}) => {
  const { suggestionDecisions } = useConversationContext();
  const decision = suggestionDecisions.getDecision(decisionKey);
  const savedMetadata =
    decision?.accepted && decision.metadata?.kind === "PROJECT_ASSISTANT_UPDATE"
      ? decision.metadata
      : null;
  // A started session whose save failed stays linked so saving can be retried
  // without launching again.
  const [unsaved, setUnsaved] = useState<{
    agentSessionId: string;
    failed: boolean;
  } | null>(null);
  const startedSessionId =
    savedMetadata?.agentSessionId ?? unsaved?.agentSessionId;

  const decisionMutation = useSuggestionDecision();
  const apolloClient = useApolloClient();
  const paths = usePathService();

  const saveStart = useCallback(
    async (agentSessionId: string) => {
      setUnsaved({ agentSessionId, failed: false });
      try {
        const saved = await decisionMutation.mutate({
          organizationId: context.organizationId,
          type: SuggestionType.ProjectAssistantUpdate,
          suggestionId: decisionKey,
          accepted: true,
          sourceConversationId: context.conversationId,
          sourceMessageId: context.messageId,
          metadata: { kind: "PROJECT_ASSISTANT_UPDATE", agentSessionId },
        });
        suggestionDecisions.upsertDecision(saved);
        setUnsaved(null);
        // Launching navigates away and unmounts this card; refreshing the
        // cached conversation is what shows the started state on return.
        await refreshConversation(apolloClient, context.conversationId);
      } catch (error) {
        log.error("ui", "Failed to record Project Assistant update start", {
          decisionKey,
          reportId: report.id,
          error,
        });
        setUnsaved({ agentSessionId, failed: true });
      }
    },
    [
      apolloClient,
      context,
      decisionKey,
      decisionMutation,
      report.id,
      suggestionDecisions,
    ],
  );

  const targetRows = update.targets.map((target) => ({
    key: `${target.entityType}-${target.entityId}`,
    mention: {
      entityType: target.entityType,
      entityId: target.entityId,
      entityName: target.title,
    },
  }));

  return (
    <ConversationCard
      chips={
        <Chip
          data-testid="proposed-update-operation"
          label={OPERATION_LABELS[update.type]}
          size="small"
          variant="outlined"
        />
      }
      data-testid="proposed-update-card"
      footer={{
        content: (
          <ProposedUpdateFooter
            focalNode={focalNode}
            onLaunched={(agentSessionId) => void saveStart(agentSessionId)}
            onRetrySave={
              unsaved?.failed && !savedMetadata
                ? () => void saveStart(unsaved.agentSessionId)
                : null
            }
            report={report}
            sessionPath={
              startedSessionId
                ? paths.agentSession({
                    projectId: context.projectId,
                    agentSessionId: startedSessionId,
                  })
                : null
            }
            update={update}
          />
        ),
      }}
      icon={<SyncAlt fontSize="small" />}
      kindLabel="Project sync · Proposed update"
      lead={
        <MarkdownRenderer allowMentionEscapes>
          {update.description}
        </MarkdownRenderer>
      }
      tone={{ role: "projectSync" }}
    >
      <ConversationCardSection label="Reason">
        <MarkdownRenderer allowMentionEscapes>{update.reason}</MarkdownRenderer>
      </ConversationCardSection>
      {targetRows.length > 0 ? (
        <div data-testid="proposed-update-targets">
          <ConversationCardSection label="Affects">
            <ConversationCardRelatedRows rows={targetRows} />
          </ConversationCardSection>
        </div>
      ) : null}
    </ConversationCard>
  );
};

interface ProposedUpdateFooterProps {
  report: ReportDto;
  update: CodingResearchUpdate;
  focalNode: CodingResearchFrameNode | null;
  /** Set once a discussion has been started for this update. */
  sessionPath: string | null;
  onLaunched: (agentSessionId: string) => void;
  /** Set only when a started discussion could not be saved. */
  onRetrySave: (() => void) | null;
}

const ProposedUpdateFooter: React.FC<ProposedUpdateFooterProps> = ({
  report,
  update,
  focalNode,
  sessionPath,
  onLaunched,
  onRetrySave,
}) => {
  if (sessionPath) {
    return (
      <Stack alignItems="flex-start" spacing={1}>
        <Stack alignItems="center" direction="row" spacing={1.5}>
          <Typography
            data-testid="proposed-update-started"
            sx={{ fontWeight: 600 }}
            variant="body2"
          >
            Discussion started
          </Typography>
          <Link
            component={RouterLink}
            data-testid="proposed-update-session-link"
            sx={(theme) => ({
              color: theme.palette.conversationCard.roles.projectSync.main,
              fontWeight: 600,
            })}
            to={sessionPath}
            underline="hover"
          >
            Open session →
          </Link>
        </Stack>
        {onRetrySave ? (
          <Alert
            action={
              <Button
                color="inherit"
                data-testid="proposed-update-retry-save"
                onClick={onRetrySave}
                size="small"
              >
                Retry saving
              </Button>
            }
            data-testid="proposed-update-save-failed"
            severity="warning"
          >
            Discussion started, but we could not save that for others. Retrying
            only saves it; it does not start the discussion again.
          </Alert>
        ) : null}
      </Stack>
    );
  }

  if (!report.projectId || !focalNode) {
    return null;
  }

  return (
    <ProposedUpdateDiscussAction
      focalNode={focalNode}
      onLaunched={onLaunched}
      projectId={report.projectId}
      report={report}
      update={update}
    />
  );
};

interface ProposedUpdateDiscussActionProps {
  report: ReportDto;
  update: CodingResearchUpdate;
  focalNode: CodingResearchFrameNode;
  projectId: string;
  onLaunched: (agentSessionId: string) => void;
}

const ProposedUpdateDiscussAction: React.FC<
  ProposedUpdateDiscussActionProps
> = ({ report, update, focalNode, projectId, onLaunched }) => {
  const launcher = useEntityConversationLauncher({
    organizationId: report.organizationId,
    projectId,
  });
  const {
    isReady: isMachineInventoryReady,
    machines,
    mode: machineMode,
    selectedMachine,
    setSelectedMachineId,
  } = useMachineResolution();
  const selectedMachineId = selectedMachine?.machineId ?? null;
  const catalogSource = useMemo(
    () =>
      selectedMachineId
        ? {
            organizationId: report.organizationId,
            projectId,
            machineId: selectedMachineId,
          }
        : null,
    [projectId, report.organizationId, selectedMachineId],
  );
  const { selection } = useSurfaceSelection({
    surfaceId: DISCUSS_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });
  const prompt = useMemo(
    () => buildProposedUpdateDiscussionPrompt(report, update),
    [report, update],
  );

  const handleLaunch = useCallback(async () => {
    if (!selectedMachine || !selection) {
      return;
    }

    launcher.clearError();
    await launcher.launch({
      provider: selection.provider,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
      machineId: selectedMachine.machineId,
      ...(supportsFastMode(selection.provider, selection.model)
        ? { fastMode: selection.fastMode ?? false }
        : {}),
      prompt,
      projectAssistant: PROJECT_ASSISTANT_DISABLED,
      context: {
        entityId: focalNode.id,
        entityType: focalNode.type,
        entityTitle: focalNode.title,
      },
      onLaunched,
    });
  }, [focalNode, launcher, onLaunched, prompt, selectedMachine, selection]);

  return (
    <Stack alignItems="flex-start" spacing={1}>
      {machineMode === "many" ? (
        <MachinePicker
          disabled={launcher.isLoading}
          machines={machines}
          mobileMode="editor"
          onSelect={setSelectedMachineId}
          selectedMachineId={selectedMachine?.machineId ?? null}
        />
      ) : null}
      {isMachineInventoryReady && machineMode === "zero" ? (
        <Typography color="error" variant="caption">
          Connect or pair a CLI machine to discuss this change.
        </Typography>
      ) : null}
      <Button
        aria-busy={launcher.isLoading}
        data-testid="proposed-update-discuss"
        disabled={
          launcher.isLoading ||
          !isMachineInventoryReady ||
          selectedMachine === null ||
          selection === null
        }
        onClick={handleLaunch}
        size="small"
        startIcon={<ChatBubbleOutlineIcon />}
        disableElevation
        sx={(theme) => ({
          alignSelf: "flex-start",
          backgroundColor: "var(--card-main)",
          color: "var(--card-contrast)",
          "&:hover": {
            backgroundColor: "var(--card-main)",
            filter: "brightness(0.92)",
          },
          "&.Mui-disabled": {
            backgroundColor: theme.palette.action.disabledBackground,
            color: theme.palette.action.disabled,
          },
        })}
        variant="contained"
      >
        {launcher.isLoading ? (
          <CircularProgress
            aria-label="Starting discussion"
            color="inherit"
            size={18}
          />
        ) : (
          "Discuss this change"
        )}
      </Button>
      {launcher.error ? (
        <SessionErrorAlert
          error={launcher.error.message}
          errorCode={launcher.error.code}
          onDismiss={launcher.clearError}
        />
      ) : null}
    </Stack>
  );
};
