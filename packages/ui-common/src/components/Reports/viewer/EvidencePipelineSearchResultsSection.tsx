import { Chip, Stack, Typography } from "@mui/material";
import React from "react";
import { EvidenceItemGroupsSection } from "./EvidenceItemGroupsSection";
import { ReportItemCard, ReportPanel } from "./reportPrimitives";
import {
  formatSearchStepTitle,
  formatQueryValue,
  type EvidencePipelineReportSearchResult,
} from "./evidencePipelineTypes";

export interface EvidencePipelineSearchResultsSectionProps {
  results: EvidencePipelineReportSearchResult[];
  reportId: string;
  title?: string;
  emptyMessage?: string;
}

export const EvidencePipelineSearchResultsSection: React.FC<
  EvidencePipelineSearchResultsSectionProps
> = ({
  results,
  reportId,
  title = "Per-Step Results",
  emptyMessage = "No search results returned.",
}) => (
  <ReportPanel
    emptyMessage={emptyMessage}
    isEmpty={results.length === 0}
    reportId={reportId}
    testId="report-viewer-evidence-pipeline-search-results"
    title={title}
  >
    <Stack spacing={1}>
      {results.map((result, index) => (
        <ReportItemCard
          key={`${index}-${formatQueryValue(result.query)}`}
          reportId={reportId}
          testId="report-viewer-evidence-pipeline-search-result"
          title={formatSearchStepTitle(result.query, index)}
          trailing={
            <Chip
              label={result.fromCache ? "Cached" : "Fresh"}
              size="small"
              variant={result.fromCache ? "outlined" : "filled"}
            />
          }
        >
          <Typography color="text.secondary" variant="caption">
            Why: {result.why}
          </Typography>
          <Typography color="text.secondary" variant="caption">
            Perspective: {result.queryPerspective}
          </Typography>
          <EvidenceItemGroupsSection
            emptyMessage="No evidence items returned"
            items={result.evidenceItems}
            reportId={reportId}
            testId="report-viewer-evidence-pipeline-search-result-groups"
            title="Entity References"
          />
        </ReportItemCard>
      ))}
    </Stack>
  </ReportPanel>
);
