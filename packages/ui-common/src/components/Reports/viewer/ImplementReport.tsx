import { Box, Stack, Typography } from "@mui/material";
import React from "react";
import type {
  ImplementReportPayload,
  ImplementReportPayloadAllOfDecisions,
} from "../../../api";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import {
  ReportItemCard,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const ImplementReport: ReportRenderer<ImplementReportPayload> = ({
  payload,
  reportTestId,
}) => {
  const filesChanged = payload.filesChanged;
  const decisions = payload.decisions ?? [];

  return (
    <Stack data-testid={`${reportTestId}-implement`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-implement-summary`}
        value={payload.summary}
      />
      <ReportPanel
        emptyMessage="No files were changed."
        isEmpty={filesChanged.length === 0}
        testId={`${reportTestId}-implement-files`}
        title="Files changed"
      >
        <Stack
          component="ul"
          data-testid={`${reportTestId}-implement-files-list`}
          spacing={0.25}
          sx={{ listStyle: "disc", m: 0, pl: 3 }}
        >
          {filesChanged.map((path, index) => (
            <Box
              component="li"
              data-testid={`${reportTestId}-implement-files-item-${index}`}
              key={`file-${index}`}
            >
              <Typography
                sx={{
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                variant="body2"
              >
                {path}
              </Typography>
            </Box>
          ))}
        </Stack>
      </ReportPanel>
      {decisions.length > 0 ? (
        <ReportPanel
          testId={`${reportTestId}-implement-decisions`}
          title="Decisions"
        >
          <Stack
            data-testid={`${reportTestId}-implement-decisions-list`}
            spacing={1}
          >
            {decisions.map((decision, index) => (
              <ImplementDecisionCard
                decision={decision}
                key={`decision-${index}`}
                testIdPrefix={`${reportTestId}-implement-decision-${index}`}
              />
            ))}
          </Stack>
        </ReportPanel>
      ) : null}
    </Stack>
  );
};

interface ImplementDecisionCardProps {
  decision: ImplementReportPayloadAllOfDecisions;
  testIdPrefix: string;
}

const ImplementDecisionCard: React.FC<ImplementDecisionCardProps> = ({
  decision,
  testIdPrefix,
}) => (
  <ReportItemCard
    testId={`${testIdPrefix}-card`}
    title={
      <Typography data-testid={`${testIdPrefix}-title`} variant="subtitle2">
        {renderInlineMentions(decision.topic, "minimal")}
      </Typography>
    }
  >
    <ReportLabeledText
      label="Choice"
      testId={`${testIdPrefix}-choice-block`}
      value={
        <Typography
          component="span"
          data-testid={`${testIdPrefix}-choice`}
          variant="body2"
        >
          {renderInlineMentions(decision.choice, "minimal")}
        </Typography>
      }
    />
    {decision.reasoning ? (
      <ReportLabeledText
        label="Reasoning"
        testId={`${testIdPrefix}-reasoning-block`}
        value={
          <Typography
            color="text.secondary"
            component="span"
            data-testid={`${testIdPrefix}-reasoning`}
            variant="body2"
          >
            {renderInlineMentions(decision.reasoning, "minimal")}
          </Typography>
        }
      />
    ) : null}
  </ReportItemCard>
);
