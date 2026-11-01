import { Chip, Paper, Stack, Typography } from "@mui/material";
import React from "react";
import type { CodingResearchUpdate, ReportDto } from "../../../api";
import { EntityIcon } from "../../Entity";
import { CodingResearchDiscussionAction } from "./CodingResearchDiscussionAction";
import type { CodingResearchFrameModel } from "./codingResearchReportModel";
import {
  ReportEntityMention,
  ReportItemCard,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";

export interface CodingResearchUpdatesSectionProps {
  updates?: CodingResearchUpdate[];
  /** Without a report there is nothing to discuss, so no action is shown. */
  report?: ReportDto;
  frameModel: CodingResearchFrameModel;
  reportTestId: string;
}

const UPDATE_TYPE_LABELS: Record<CodingResearchUpdate["type"], string> = {
  add: "Add",
  remove: "Remove",
  update: "Update",
};

export const CodingResearchUpdatesSection: React.FC<
  CodingResearchUpdatesSectionProps
> = ({ updates, report, frameModel, reportTestId }) => {
  const testId = `${reportTestId}-coding-research-updates`;

  if (!updates?.length) {
    return null;
  }

  return (
    <Paper
      data-testid={testId}
      sx={{ p: 1.5, backgroundColor: "action.hover" }}
      variant="outlined"
    >
      <ReportPanel testId={`${testId}-content`} title="Proposed changes">
        <Stack spacing={1.25}>
          <Stack spacing={1}>
            {updates.map((update, index) => (
              <CodingResearchUpdateCard
                key={`${update.type}-${index}`}
                update={update}
                testId={`${testId}-card-${index}`}
              />
            ))}
          </Stack>
          <Stack alignItems="flex-start" spacing={0.75} sx={{ pt: 0.25 }}>
            {report && (
              <>
                <Typography color="text.secondary" variant="caption">
                  Open a new conversation to review the reasoning and decide
                  what should change.
                </Typography>
                <CodingResearchDiscussionAction
                  frameModel={frameModel}
                  report={report}
                  testId={`${testId}-discuss`}
                />
              </>
            )}
          </Stack>
        </Stack>
      </ReportPanel>
    </Paper>
  );
};

interface CodingResearchUpdateCardProps {
  update: CodingResearchUpdate;
  testId: string;
}

const CodingResearchUpdateCard: React.FC<CodingResearchUpdateCardProps> = ({
  update,
  testId,
}) => (
  <ReportItemCard
    testId={testId}
    title={
      <Stack
        alignItems="center"
        data-testid={`${testId}-targets`}
        direction="row"
        flexWrap="wrap"
        spacing={1}
        useFlexGap
      >
        {update.targets.map((target, targetIndex) => (
          <Stack
            alignItems="center"
            data-testid={`${testId}-target-${targetIndex}`}
            direction="row"
            key={`${target.entityType}-${target.entityId}`}
            spacing={0.75}
          >
            <EntityIcon
              aria-hidden="true"
              data-testid="coding-research-update-entity-icon"
              entityType={target.entityType}
              size={24}
            />
            <ReportEntityMention
              entityId={target.entityId}
              entityName={target.title}
              entityType={target.entityType}
            />
          </Stack>
        ))}
      </Stack>
    }
    trailing={
      <Chip
        color="primary"
        data-testid={`${testId}-operation`}
        label={UPDATE_TYPE_LABELS[update.type]}
        size="small"
      />
    }
  >
    <ReportLabeledText
      label="Description"
      renderMentions
      testId={`${testId}-description`}
      value={update.description}
    />
    <ReportLabeledText
      label="Reason"
      renderMentions
      testId={`${testId}-reason`}
      value={update.reason}
    />
  </ReportItemCard>
);
