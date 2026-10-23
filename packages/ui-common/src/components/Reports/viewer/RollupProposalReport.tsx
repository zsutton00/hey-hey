import { Stack, Typography } from "@mui/material";
import React from "react";
import {
  ReportRelatedEntityType,
  type RollupProposalReportPayload,
} from "../../../api";
import {
  ReportEntityMention,
  ReportItemCard,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const RollupProposalReport: ReportRenderer<
  RollupProposalReportPayload
> = ({ payload, reportTestId }) => {
  const parentFeatures = payload.parentFeatures;
  const relatedFeatures = payload.relatedFeatures;

  return (
    <Stack data-testid={`${reportTestId}-rollup-proposal`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-rollup-proposal-summary`}
        value={payload.summary}
      />
      <ReportLabeledText
        label="Task"
        testId={`${reportTestId}-rollup-proposal-task-block`}
        value={
          <Stack
            data-testid={`${reportTestId}-rollup-proposal-task`}
            direction="row"
            spacing={0.5}
          >
            <ReportEntityMention
              entityId={payload.taskId}
              entityType={ReportRelatedEntityType.Task}
            />
          </Stack>
        }
      />
      <ReportLabeledText
        label="Triggered by"
        testId={`${reportTestId}-rollup-proposal-triggered-by`}
        value={payload.triggeredBy}
      />
      <ReportLabeledText
        label="Triggered at"
        testId={`${reportTestId}-rollup-proposal-triggered-at`}
        value={payload.triggeredAt}
      />
      <ReportPanel
        emptyMessage="No parent feature proposals were created."
        isEmpty={parentFeatures.length === 0}
        testId={`${reportTestId}-rollup-proposal-parent-features`}
        title="Parent feature proposals"
      >
        <Stack
          data-testid={`${reportTestId}-rollup-proposal-parent-features-list`}
          spacing={1}
        >
          {parentFeatures.map((proposalId, index) => (
            <ProposalIdCard
              key={`parent-${index}`}
              proposalId={proposalId}
              testIdPrefix={`${reportTestId}-rollup-proposal-parent-feature-${index}`}
            />
          ))}
        </Stack>
      </ReportPanel>
      <ReportPanel
        emptyMessage="No related feature proposals were created."
        isEmpty={relatedFeatures.length === 0}
        testId={`${reportTestId}-rollup-proposal-related-features`}
        title="Related feature proposals"
      >
        <Stack
          data-testid={`${reportTestId}-rollup-proposal-related-features-list`}
          spacing={1}
        >
          {relatedFeatures.map((proposalId, index) => (
            <ProposalIdCard
              key={`related-${index}`}
              proposalId={proposalId}
              testIdPrefix={`${reportTestId}-rollup-proposal-related-feature-${index}`}
            />
          ))}
        </Stack>
      </ReportPanel>
    </Stack>
  );
};

interface ProposalIdCardProps {
  proposalId: string;
  testIdPrefix: string;
}

const ProposalIdCard: React.FC<ProposalIdCardProps> = ({
  proposalId,
  testIdPrefix,
}) => (
  <ReportItemCard
    testId={`${testIdPrefix}-card`}
    title={
      <Typography
        data-testid={`${testIdPrefix}-title`}
        sx={{ fontFamily: "monospace" }}
        variant="subtitle2"
      >
        {proposalId}
      </Typography>
    }
  />
);
