import {
  Alert,
  Box,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";
import { ProposalAction } from "../../../api";
import type {
  FeatureListProposalNode,
  FeatureListRefinement,
  RepositoryGroundingCompletion,
  ServiceDto,
} from "../../../api";
import { useServices } from "../../../data/hooks/useServices";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import { ProposalMetadata } from "../../ProposalDispatchers/ProposalHeader";
import { staticProposalTypePresentation } from "../../ProposalDispatchers/proposalHeaderType";
import { getEntityColors, getEntityIcon } from "../../../utils/entityIcons";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import { getRepositoryGroundingProviderLabel } from "./repositoryGroundingUtils";
import type { FieldComponentContext, FieldComponentProps } from "./types";
import type { FeatureListValue } from "./types";
import { FeatureListChildren } from "./FeatureListChildren";

export interface FeatureListFieldProps extends Omit<
  FieldComponentProps<FeatureListValue>,
  "onChange" | "value"
> {
  value: FeatureListValue;
  onChange?: (value: FeatureListValue) => void;
  context: FieldComponentContext;
}

const emptyRefinement = (): FeatureListRefinement => ({
  sections: {},
  overall: "",
});

type RepositoryGroundingSuccess = Extract<
  RepositoryGroundingCompletion,
  { outcome: "success" }
>;

const FeatureIcon = getEntityIcon("feature");
const featureTypePresentation = staticProposalTypePresentation(
  "Feature",
  FeatureIcon,
  getEntityColors("feature"),
);

const FeatureProposalMetadata: React.FC = () => (
  <Box data-testid="feature-list-proposal-metadata">
    <ProposalMetadata
      action={ProposalAction.Create}
      typePresentation={featureTypePresentation}
    />
  </Box>
);

const formatEvidenceLocation = (
  path: string,
  lineStart?: number,
  lineEnd?: number,
): string => {
  if (lineStart === undefined && lineEnd === undefined) return path;
  if (lineStart !== undefined && lineEnd !== undefined) {
    return `${path}:${lineStart}-${lineEnd}`;
  }
  return `${path}:${lineStart ?? lineEnd}`;
};

type RepositoryEvidenceServiceResolution =
  | { status: "loading"; message: string }
  | { status: "error"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "resolved"; name: string };

const resolveRepositoryEvidenceService = (input: {
  serviceId: string;
  services: ReadonlyArray<Pick<ServiceDto, "id" | "name">>;
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  error: unknown;
}): RepositoryEvidenceServiceResolution => {
  if (input.error) {
    return {
      status: "error",
      message: "The Service could not be loaded for this evidence.",
    };
  }

  const service = input.services.find(
    (candidate) => candidate.id === input.serviceId,
  );
  if (service && service.name.trim().length > 0) {
    return { status: "resolved", name: service.name.trim() };
  }

  if (input.isLoading || input.isFetching || !input.isFetched) {
    return { status: "loading", message: "Loading Services…" };
  }

  return {
    status: "unavailable",
    message: "The selected Service is unavailable in this project.",
  };
};

const RepositoryEvidenceSummary: React.FC<{
  completion: RepositoryGroundingSuccess;
  organizationId: string;
  projectId: string;
}> = ({ completion, organizationId, projectId }) => {
  const evidence = completion.evidence;
  const briefDiscrepancies = completion.briefDiscrepancies;
  const servicesQuery = useServices(organizationId, { projectId });
  const serviceResolution = resolveRepositoryEvidenceService({
    serviceId: completion.serviceId,
    services: servicesQuery.services,
    isLoading: servicesQuery.isLoading,
    isFetching: servicesQuery.isFetching,
    isFetched: servicesQuery.isFetched,
    error: servicesQuery.error,
  });

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, mb: 3 }}
      data-testid="feature-list-repository-evidence"
    >
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="h6" component="div">
            Repository evidence
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Service:{" "}
            {serviceResolution.status === "resolved" ? (
              serviceResolution.name
            ) : (
              <span data-testid="feature-list-repository-service-state">
                {serviceResolution.message}
              </span>
            )}
          </Typography>
        </Box>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Typography variant="body2">
            <strong>Provider:</strong> {completion.provider}
          </Typography>
          <Typography variant="body2">
            <strong>Model:</strong> {completion.resolvedFrontierModel}
          </Typography>
          <Typography variant="body2">
            <strong>
              {getRepositoryGroundingProviderLabel(completion.provider)} usage:
            </strong>{" "}
            Repository analysis with evidence-backed capability synthesis and
            coherence review.
          </Typography>
        </Stack>

        <Divider />

        <Box>
          <Typography variant="subtitle2">Included evidence</Typography>
          {evidence.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No repository evidence references were supplied by the result.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {evidence.map((item) => (
                <Box
                  key={`${item.path}-${item.lineStart ?? ""}-${
                    item.lineEnd ?? ""
                  }`}
                >
                  <Typography variant="body2">
                    {formatEvidenceLocation(
                      item.path,
                      item.lineStart,
                      item.lineEnd,
                    )}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.summary}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Box>

        <Box>
          <Typography variant="subtitle2">
            Service-brief discrepancies
          </Typography>
          {briefDiscrepancies.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No service-brief discrepancies were reported by the result.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {briefDiscrepancies.map((discrepancy, index) => (
                <Box key={`${discrepancy.summary}-${index}`}>
                  <Typography variant="body2">
                    {discrepancy.material ? "Material: " : "Discrepancy: "}
                    {renderInlineMentions(discrepancy.summary)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {renderInlineMentions(discrepancy.rationale)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Supporting paths:{" "}
                    {discrepancy.evidencePaths?.length
                      ? discrepancy.evidencePaths.join(", ")
                      : "None supplied by result."}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      </Stack>
    </Paper>
  );
};

export const FeatureListField: React.FC<FeatureListFieldProps> = ({
  config,
  value,
  onChange,
  context,
}) => {
  const { t } = useTranslation();

  const narrative = value?.narrative ?? "";
  const topLevels: FeatureListProposalNode[] = value?.topLevels ?? [];
  const refinement = value?.refinement ?? emptyRefinement();
  const repositoryGroundingCompletion = value?.repositoryGroundingCompletion;

  const handleSectionChange = (topLevelId: string, text: string) => {
    if (!onChange) return;
    onChange({
      ...value,
      refinement: {
        ...refinement,
        sections: {
          ...refinement.sections,
          [topLevelId]: text,
        },
      },
    });
  };

  const handleOverallChange = (text: string) => {
    if (!onChange) return;
    onChange({
      ...value,
      refinement: {
        ...refinement,
        overall: text,
      },
    });
  };

  if (topLevels.length === 0) {
    return (
      <Box data-testid={`feature-list-field-${config.field}`}>
        {repositoryGroundingCompletion?.outcome === "success" && (
          <RepositoryEvidenceSummary
            completion={repositoryGroundingCompletion}
            organizationId={context.organizationId}
            projectId={context.projectId}
          />
        )}
        <Alert severity="info">
          {t("featureList.empty", "No features have been generated yet.")}
        </Alert>
      </Box>
    );
  }

  return (
    <Box data-testid={`feature-list-field-${config.field}`}>
      {repositoryGroundingCompletion?.outcome === "success" && (
        <RepositoryEvidenceSummary
          completion={repositoryGroundingCompletion}
          organizationId={context.organizationId}
          projectId={context.projectId}
        />
      )}
      {narrative && (
        <Box sx={{ mb: 3 }} data-testid="feature-list-narrative">
          <Typography variant="body1" component="div">
            <MarkdownRenderer>{narrative}</MarkdownRenderer>
          </Typography>
        </Box>
      )}

      <Stack spacing={3}>
        {topLevels.map((topLevel) => (
          <Paper
            key={topLevel.id}
            variant="outlined"
            sx={{ p: 2 }}
            data-testid={`feature-list-section-${topLevel.id}`}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
              sx={{ mb: 0.5 }}
            >
              <Typography
                variant="h6"
                component="div"
                sx={{ flex: 1, minWidth: 0 }}
              >
                {topLevel.name}
              </Typography>
              <FeatureProposalMetadata />
            </Stack>
            {topLevel.description && (
              <Typography
                variant="body2"
                color="text.secondary"
                component="div"
                sx={{ mb: 2 }}
              >
                <MarkdownRenderer>{topLevel.description}</MarkdownRenderer>
              </Typography>
            )}

            <FeatureListChildren items={topLevel.children} />

            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={6}
              size="small"
              placeholder={t(
                "featureList.sectionFeedbackPlaceholder",
                "Anything to change about {{name}}?",
                { name: topLevel.name },
              )}
              value={refinement.sections[topLevel.id] ?? ""}
              onChange={(event) =>
                handleSectionChange(topLevel.id, event.target.value)
              }
              data-testid={`feature-list-section-input-${topLevel.id}`}
            />
          </Paper>
        ))}
      </Stack>

      <Box sx={{ mt: 2 }}>
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={6}
          size="small"
          placeholder={t(
            "featureList.overallFeedbackPlaceholder",
            "Anything else? (e.g. add a top-level, merge two, move a child across buckets)",
          )}
          value={refinement.overall}
          onChange={(event) => handleOverallChange(event.target.value)}
          data-testid="feature-list-overall-input"
        />
      </Box>
    </Box>
  );
};
