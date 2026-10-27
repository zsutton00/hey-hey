import { Box } from "@mui/material";
import React from "react";
import type { CodingResearchReportPayload } from "../../api";
import { EvaluationOutputBadge } from "../ProposalDispatchers/EvaluationOutputBadge";
import { CodingResearchReport } from "./viewer/CodingResearchReport";

export interface RetainedResearchReportProps {
  payload: CodingResearchReportPayload;
  testId: string;
}

/**
 * Research an eval attempt kept on its own record, shown as saved: marked as
 * evaluation output and without the actions a live report offers. It stands
 * for no report record, so none is implied.
 */
export const RetainedResearchReport: React.FC<RetainedResearchReportProps> = ({
  payload,
  testId,
}) => (
  <Box data-testid={testId}>
    <Box sx={{ mb: 1.5 }}>
      <EvaluationOutputBadge />
    </Box>
    <CodingResearchReport
      payload={payload}
      reportTestId={testId}
      evaluationOutput
    />
  </Box>
);
