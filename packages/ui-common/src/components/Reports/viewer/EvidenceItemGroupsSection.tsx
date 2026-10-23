import { Stack, Typography } from "@mui/material";
import React from "react";
import { ReportPanel } from "./reportPrimitives";
import {
  formatEntityTypeLabel,
  groupEvidenceItemsByEntityType,
  type EvidencePipelineReportEvidenceItemSummary,
} from "./evidencePipelineTypes";

export interface EvidenceItemGroupsSectionProps {
  title: string;
  testId: string;
  reportId: string;
  items: EvidencePipelineReportEvidenceItemSummary[];
  emptyMessage: string;
}

export const EvidenceItemGroupsSection: React.FC<
  EvidenceItemGroupsSectionProps
> = ({ title, testId, reportId, items, emptyMessage }) => {
  const groups = groupEvidenceItemsByEntityType(items);

  return (
    <ReportPanel
      emptyMessage={emptyMessage}
      isEmpty={groups.length === 0}
      reportId={reportId}
      testId={testId}
      title={title}
    >
      <Stack spacing={1}>
        {groups.map((group) => (
          <Stack
            data-entity-type={group.entityType}
            data-report-id={reportId}
            data-testid="report-viewer-evidence-pipeline-entity-group"
            key={group.entityType}
            spacing={0.5}
          >
            <Typography variant="body2">
              {formatEntityTypeLabel(group.entityType)}
            </Typography>
            <Stack
              component="ul"
              spacing={0.75}
              sx={{ m: 0, p: 0, listStyle: "none" }}
            >
              {group.items.map((item, index) => (
                <Stack
                  component="li"
                  data-entity-id={item.entityId}
                  data-entity-type={item.entityType}
                  data-report-id={reportId}
                  data-testid="report-viewer-evidence-pipeline-entity-item"
                  key={`${item.entityId}-${index}`}
                  spacing={0.25}
                  sx={{ pl: 1.5 }}
                >
                  <Typography variant="body2">Entity reference</Typography>
                  <Typography color="text.secondary" variant="caption">
                    Entity ID: {item.entityId}
                  </Typography>
                  {item.hintType ? (
                    <Typography color="text.secondary" variant="caption">
                      Hint type: {item.hintType}
                    </Typography>
                  ) : null}
                  {item.source ? (
                    <Typography color="text.secondary" variant="caption">
                      Source: {item.source}
                    </Typography>
                  ) : null}
                  {item.score !== undefined ? (
                    <Typography color="text.secondary" variant="caption">
                      Score: {item.score}
                    </Typography>
                  ) : null}
                </Stack>
              ))}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </ReportPanel>
  );
};
