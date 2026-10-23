import { Stack, Typography } from "@mui/material";
import React from "react";
import type {
  PhaseGroundingReportPayload,
  PhaseGroundingReportTouchPoint,
} from "../../../api";
import {
  ReportItemCard,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const PhaseGroundingReport: ReportRenderer<
  PhaseGroundingReportPayload
> = ({ payload, reportTestId }) => {
  const touchPoints = payload.touchPoints;

  return (
    <Stack data-testid={`${reportTestId}-phase-grounding`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-phase-grounding-summary`}
        value={payload.summary}
      />
      {payload.planAdjustment ? (
        <ReportLabeledText
          label="Plan adjustment"
          renderMentions
          testId={`${reportTestId}-phase-grounding-plan-adjustment`}
          value={payload.planAdjustment}
        />
      ) : null}
      <ReportPanel
        emptyMessage="No touch points were committed for this phase."
        isEmpty={touchPoints.length === 0}
        testId={`${reportTestId}-phase-grounding-touch-points`}
        title="Touch points"
      >
        <Stack
          data-testid={`${reportTestId}-phase-grounding-touch-points-list`}
          spacing={1}
        >
          {touchPoints.map((touchPoint, index) => (
            <PhaseGroundingTouchPointCard
              key={`touch-point-${index}`}
              testIdPrefix={`${reportTestId}-phase-grounding-touch-point-${index}`}
              touchPoint={touchPoint}
            />
          ))}
        </Stack>
      </ReportPanel>
    </Stack>
  );
};

interface PhaseGroundingTouchPointCardProps {
  touchPoint: PhaseGroundingReportTouchPoint;
  testIdPrefix: string;
}

const PhaseGroundingTouchPointCard: React.FC<
  PhaseGroundingTouchPointCardProps
> = ({ touchPoint, testIdPrefix }) => (
  <ReportItemCard
    testId={`${testIdPrefix}-card`}
    title={
      <Typography
        data-testid={`${testIdPrefix}-file`}
        sx={{ fontFamily: "monospace" }}
        variant="subtitle2"
      >
        {touchPoint.file}
      </Typography>
    }
  >
    <ReportLabeledText
      label="Expected outcome"
      renderMentions
      testId={`${testIdPrefix}-expected-outcome-block`}
      value={touchPoint.expectedOutcome}
    />
    {touchPoint.divergenceFromInitialPlan ? (
      <ReportLabeledText
        label="Divergence from initial plan"
        renderMentions
        testId={`${testIdPrefix}-divergence-block`}
        value={touchPoint.divergenceFromInitialPlan}
      />
    ) : null}
  </ReportItemCard>
);
