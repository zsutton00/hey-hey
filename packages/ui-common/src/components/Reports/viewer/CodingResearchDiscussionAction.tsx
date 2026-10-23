import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { Button, CircularProgress, Stack, Typography } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import type { ReportDto } from "../../../api";
import { MachinePicker } from "../../AgentSession/MachinePicker";
import { SessionErrorAlert } from "../../AgentSession/SessionErrorAlert";
import { supportsFastMode } from "../../AgentSession/capabilityCatalog";
import { useMachineResolution } from "../../AgentSession/runtime/coding/useMachineResolution";
import { DISCUSS_SURFACE_ID } from "../../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../../AgentSession/useSurfaceSelection";
import type { EntityConversationProjectAssistantConfig } from "../../InteractionComponent/graphConversationLaunchInput";
import { useEntityConversationLauncher } from "../../InteractionComponent/useEntityConversationLauncher";
import { formatMention } from "../../../utils/mentionFormatting";
import {
  getCodingResearchFocalNode,
  type CodingResearchFrameModel,
} from "./codingResearchReportModel";

const DISCUSSION_SENTENCE =
  "The user wants to discuss the updates that were proposed.";

const PROJECT_ASSISTANT_DISABLED = {
  enabled: false,
} as const satisfies EntityConversationProjectAssistantConfig;

export const buildCodingResearchDiscussionPrompt = (
  report: ReportDto,
): string =>
  [
    formatMention({
      entityType: "report",
      entityId: report.id,
      entityName: report.title,
    }),
    DISCUSSION_SENTENCE,
  ].join("\n\n");

export interface CodingResearchDiscussionActionProps {
  frameModel: CodingResearchFrameModel;
  report: ReportDto;
  testId: string;
}

export const CodingResearchDiscussionAction: React.FC<
  CodingResearchDiscussionActionProps
> = ({ frameModel, report, testId }) => {
  const focalNode = getCodingResearchFocalNode(frameModel);

  if (!report.projectId || !focalNode) {
    return null;
  }

  return (
    <AvailableCodingResearchDiscussionAction
      focalNode={focalNode}
      projectId={report.projectId}
      report={report}
      testId={testId}
    />
  );
};

interface AvailableCodingResearchDiscussionActionProps {
  focalNode: NonNullable<ReturnType<typeof getCodingResearchFocalNode>>;
  projectId: string;
  report: ReportDto;
  testId: string;
}

const AvailableCodingResearchDiscussionAction: React.FC<
  AvailableCodingResearchDiscussionActionProps
> = ({ focalNode, projectId, report, testId }) => {
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
    () => buildCodingResearchDiscussionPrompt(report),
    [report],
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
    });
  }, [focalNode, launcher, prompt, selectedMachine, selection]);

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
          Connect or pair a CLI machine to review these proposed changes.
        </Typography>
      ) : null}
      <Button
        aria-busy={launcher.isLoading}
        data-testid={testId}
        disabled={
          launcher.isLoading ||
          !isMachineInventoryReady ||
          selectedMachine === null ||
          selection === null
        }
        onClick={handleLaunch}
        size="small"
        startIcon={<ChatBubbleOutlineIcon />}
        sx={{ alignSelf: "flex-start" }}
        variant="outlined"
      >
        {launcher.isLoading ? (
          <CircularProgress
            aria-label="Starting review conversation"
            color="inherit"
            size={18}
          />
        ) : (
          "Review proposed changes"
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
