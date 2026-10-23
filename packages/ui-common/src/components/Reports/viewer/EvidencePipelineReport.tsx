import { Stack, Typography } from "@mui/material";
import type { EvidencePipelineReportPayload } from "../../../api";
import { EvidenceItemGroupsSection } from "./EvidenceItemGroupsSection";
import { EvidenceKeySection } from "./EvidenceKeySection";
import { EvidencePayloadDebugSection } from "./EvidencePayloadDebugSection";
import { EvidencePipelineExecutionSection } from "./EvidencePipelineExecutionSection";
import { EvidencePipelinePlannerInputSection } from "./EvidencePipelinePlannerInputSection";
import { EvidencePipelineSearchResultsSection } from "./EvidencePipelineSearchResultsSection";
import { EvidencePipelineSearchStepsSection } from "./EvidencePipelineSearchStepsSection";
import { parseEvidencePipelineReportPayload } from "./evidencePipelineTypes";
import type { ReportRenderer } from "./rendererContract";

export const EvidencePipelineReport: ReportRenderer<
  EvidencePipelineReportPayload
> = ({ report }) => {
  // The OpenAPI EvidencePipelineReportPayload type omits several runtime fields
  // (implementationHintSearch* and per-item hintType) the server actually sends,
  // so we fall back to the local parser to surface them until the spec is updated.
  const parsed = parseEvidencePipelineReportPayload(report.payload);

  if (!parsed) {
    return (
      <Typography
        color="text.secondary"
        data-report-id={report.id}
        data-testid="report-viewer-evidence-pipeline-empty"
        variant="body2"
      >
        Evidence pipeline payload is unavailable.
      </Typography>
    );
  }

  return (
    <Stack
      data-report-id={report.id}
      data-testid="report-viewer-evidence-pipeline"
      spacing={2}
    >
      <EvidencePipelinePlannerInputSection plannerInput={parsed.plannerInput} />
      <EvidencePipelineSearchStepsSection searchSteps={parsed.searchSteps} />
      <EvidencePipelineSearchResultsSection
        reportId={report.id}
        results={parsed.searchResults}
      />
      <EvidenceKeySection
        emptyMessage="No selected evidence keys"
        keys={parsed.selectedEvidenceKeys}
        reportId={report.id}
        testId="report-viewer-evidence-pipeline-selected-keys"
        title="Selected Evidence Keys"
      />
      <EvidenceKeySection
        emptyMessage="No excluded evidence keys"
        keys={parsed.excludedEvidenceKeys}
        reportId={report.id}
        testId="report-viewer-evidence-pipeline-excluded-keys"
        title="Excluded Evidence Keys"
      />
      <EvidenceKeySection
        emptyMessage="No hydrated evidence keys"
        keys={parsed.hydratedEvidenceKeys}
        reportId={report.id}
        testId="report-viewer-evidence-pipeline-hydrated-keys"
        title="Hydrated Evidence Keys"
      />
      <EvidencePipelineSearchStepsSection
        emptyMessage={
          parsed.implementationHintSearchEnabled
            ? "No implementation hint search steps"
            : "Implementation hint search disabled"
        }
        searchSteps={parsed.implementationHintSearchSteps}
        title="Implementation Hint Search Steps"
      />
      <EvidencePipelineSearchResultsSection
        emptyMessage={
          parsed.implementationHintSearchEnabled
            ? "No implementation hint search results"
            : "Implementation hint search disabled"
        }
        reportId={report.id}
        results={parsed.implementationHintSearchResults}
        title="Implementation Hint Search Results"
      />
      <EvidenceItemGroupsSection
        emptyMessage="No implementation hints returned"
        items={parsed.implementationHints}
        reportId={report.id}
        testId="report-viewer-evidence-pipeline-implementation-hints"
        title="Implementation Hints"
      />
      <EvidenceItemGroupsSection
        emptyMessage="No final evidence returned"
        items={parsed.finalEvidence}
        reportId={report.id}
        testId="report-viewer-evidence-pipeline-final-evidence"
        title="Final Evidence Payload"
      />
      <EvidencePipelineExecutionSection execution={parsed.execution} />
      <EvidencePayloadDebugSection payload={report.payload} />
    </Stack>
  );
};
