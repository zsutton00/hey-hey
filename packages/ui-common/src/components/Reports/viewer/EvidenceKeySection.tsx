import { Box } from "@mui/material";
import React from "react";
import { ReportSection } from "./ReportSection";

export interface EvidenceKeySectionProps {
  title: string;
  testId: string;
  reportId: string;
  keys: string[];
  emptyMessage: string;
}

export const EvidenceKeySection: React.FC<EvidenceKeySectionProps> = ({
  title,
  testId,
  reportId,
  keys,
  emptyMessage,
}) => {
  const items = keys.map((value, index) => ({
    id: `${index}`,
    title: `Evidence key ${index + 1}`,
    detail: value,
  }));

  return (
    <Box data-report-id={reportId} data-testid={testId}>
      <ReportSection
        emptyMessage={emptyMessage}
        items={items}
        testId={testId}
        title={title}
      />
    </Box>
  );
};
