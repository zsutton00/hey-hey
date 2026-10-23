import { Alert, Box, Chip, Divider, Stack, Typography } from "@mui/material";
import React from "react";
import { EntityIcon } from "../../Entity/EntityIcon";
import type {
  CodingPromptFinalAssessmentArtifactUpdateSuggestion,
  CodingPromptFinalAssessmentEvidenceCorrection,
  CodingPromptFinalAssessmentHierarchyWalkEntry,
  CodingPromptFinalAssessmentTaskAssessment,
  CodingPromptMergedFinalAssessmentPayload,
  CodingPromptNeighborhoodTaskUpdate,
} from "../../../api";
import type { FieldComponentProps } from "./types";

export type MergedFinalAssessmentStructuredFieldProps =
  FieldComponentProps<CodingPromptMergedFinalAssessmentPayload>;

// -- Utility functions --

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const isMergedPayload = (
  value: unknown
): value is CodingPromptMergedFinalAssessmentPayload => {
  if (!isRecord(value)) return false;
  return (
    value.responseType === "merged_final_assessment_v1" &&
    isRecord(value.taskAssessment)
  );
};

// -- Chip color helpers --

const toVerdictChipColor = (
  verdict: string
): "default" | "success" | "warning" | "error" => {
  switch (verdict) {
    case "completed":
      return "success";
    case "partiallyCompleted":
      return "warning";
    case "blocked":
    case "notCompleted":
      return "error";
    case "unknown":
    default:
      return "default";
  }
};

const toStatusChipColor = (
  status: string
): "default" | "success" | "warning" | "error" => {
  if (status === "COMPLETED") return "success";
  if (status === "ACTIVE") return "warning";
  if (status === "CANCELLED") return "error";
  return "default";
};

const toSeverityChipColor = (
  severity: string
): "default" | "warning" | "error" => {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  return "default";
};

// -- Sub-sections --

const TaskAssessmentSection: React.FC<{
  taskAssessment: CodingPromptFinalAssessmentTaskAssessment;
}> = ({ taskAssessment }) => (
  <Stack spacing={1.5}>
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
      <Typography variant="subtitle1" fontWeight={600}>
        Final Assessment
      </Typography>
      <Chip
        size="small"
        label="merged_final_assessment_v1"
        variant="outlined"
        color="primary"
      />
    </Stack>

    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Chip
        size="small"
        color={toVerdictChipColor(taskAssessment.verdict)}
        label={`Verdict: ${taskAssessment.verdict}`}
      />
      <Chip
        size="small"
        color={toStatusChipColor(taskAssessment.statusRecommendation.status)}
        label={`Recommended status: ${taskAssessment.statusRecommendation.status}`}
      />
      {taskAssessment.target && (
        <Chip
          size="small"
          variant="outlined"
          label={`Target: ${taskAssessment.target.entityType} ${taskAssessment.target.entityId}`}
        />
      )}
    </Stack>

    <Typography variant="body2">{taskAssessment.summary}</Typography>
    <Typography variant="body2" color="text.secondary">
      {taskAssessment.statusRecommendation.reason}
    </Typography>
  </Stack>
);

const ArtifactUpdateSuggestionsSection: React.FC<{
  suggestions: CodingPromptFinalAssessmentArtifactUpdateSuggestion[];
}> = ({ suggestions }) => {
  if (suggestions.length === 0) return null;
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" fontWeight={600}>
        Artifact Update Suggestions
      </Typography>
      {suggestions.map((s, i) => (
        <Box key={i} sx={{ pl: 1, borderLeft: 2, borderColor: "primary.main" }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
            <Chip size="small" variant="outlined" label={s.updateType} />
            <Typography variant="caption" color="text.secondary">
              {s.target.entityType} {s.target.entityId}
            </Typography>
          </Stack>
          <Typography variant="body2">{s.reasoning}</Typography>
        </Box>
      ))}
    </Stack>
  );
};

const EvidenceCorrectionsSection: React.FC<{
  corrections: CodingPromptFinalAssessmentEvidenceCorrection[];
}> = ({ corrections }) => {
  if (corrections.length === 0) return null;
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" fontWeight={600}>
        Evidence Corrections
      </Typography>
      {corrections.map((c, i) => (
        <Box key={i} sx={{ pl: 1, borderLeft: 2, borderColor: "warning.main" }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
            <Chip
              size="small"
              color={toSeverityChipColor(c.severity)}
              label={c.severity}
            />
            <Chip size="small" variant="outlined" label={c.issueType} />
            <Typography variant="caption" color="text.secondary">
              {c.target.entityType} {c.target.entityId}
            </Typography>
          </Stack>
          <Typography variant="body2">{c.reasoning}</Typography>
          {c.sourceExcerpt && (
            <Typography
              variant="caption"
              component="blockquote"
              sx={{ fontStyle: "italic", color: "text.secondary", mt: 0.5 }}
            >
              "{c.sourceExcerpt}"
            </Typography>
          )}
          {c.suggestedReplacement && (
            <Typography variant="body2" color="success.main" mt={0.5}>
              Suggested: {c.suggestedReplacement}
            </Typography>
          )}
        </Box>
      ))}
    </Stack>
  );
};

const NeighborhoodTaskUpdatesSection: React.FC<{
  updates: CodingPromptNeighborhoodTaskUpdate[];
}> = ({ updates }) => {
  if (updates.length === 0) return null;
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" fontWeight={600}>
        Neighborhood Task Updates
      </Typography>
      {updates.map((u, i) => (
        <Box key={i} sx={{ pl: 1, borderLeft: 2, borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Task {u.taskId}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {u.reasoning}
          </Typography>
          {u.descriptionUpdate && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Description: {u.descriptionUpdate}
            </Typography>
          )}
          {u.acceptanceCriteriaUpdate && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Acceptance criteria: {u.acceptanceCriteriaUpdate}
            </Typography>
          )}
        </Box>
      ))}
    </Stack>
  );
};

const HierarchyWalkSection: React.FC<{
  entries: CodingPromptFinalAssessmentHierarchyWalkEntry[];
}> = ({ entries }) => {
  if (entries.length === 0) return null;
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2" fontWeight={600}>
        Hierarchy Walk
      </Typography>
      {entries.map((entry, i) => (
        <Stack key={i} direction="row" spacing={0.75} alignItems="center">
          <EntityIcon entityType={entry.entityType} size={18} round />
          <Typography variant="body2">
            {entry.name} [{entry.action}] - {entry.rationale}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
};

// -- Main Component --

export const MergedFinalAssessmentStructuredField: React.FC<
  MergedFinalAssessmentStructuredFieldProps
> = ({ config, value }) => {
  const payload = isMergedPayload(value) ? value : null;

  if (!payload) {
    return (
      <Alert
        severity="info"
        data-testid={`merged-final-assessment-field-empty-${config.field}`}
      >
        Merged final assessment details are unavailable.
      </Alert>
    );
  }

  return (
    <Box
      data-testid={`merged-final-assessment-field-${config.field}`}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
      }}
    >
      <Stack spacing={2} divider={<Divider />}>
        <TaskAssessmentSection taskAssessment={payload.taskAssessment} />

        {payload.implementationNotes && (
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" fontWeight={600}>
              Implementation Notes
            </Typography>
            <Typography variant="body2">
              {payload.implementationNotes}
            </Typography>
          </Stack>
        )}

        <ArtifactUpdateSuggestionsSection
          suggestions={payload.artifactUpdateSuggestions ?? []}
        />

        <EvidenceCorrectionsSection
          corrections={payload.evidenceCorrections ?? []}
        />

        <NeighborhoodTaskUpdatesSection
          updates={payload.neighborhoodTaskUpdates ?? []}
        />

        <HierarchyWalkSection entries={payload.hierarchyWalk ?? []} />
      </Stack>
    </Box>
  );
};
