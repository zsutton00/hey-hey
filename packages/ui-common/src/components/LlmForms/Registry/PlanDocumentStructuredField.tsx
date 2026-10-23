import {
  Alert,
  Button,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import React from "react";
import { useNavigate } from "react-router-dom";
import { DesignDocTemplate } from "../../../api";
import { usePathService } from "../../../contexts";
import { useDesignDoc } from "../../../data/hooks/useDesignDoc";
import { DesignDocReadView } from "../../shared/DesignDocReadView";
import type { FieldComponentProps } from "./types";

type StructuredResponseContainer = {
  structuredResponse?: {
    responseType?: string;
    parsed?: unknown;
  };
};

interface PlanDocumentViewResponse {
  responseType?: "plan_document_view_v1";
  entityId: string;
  template?: PlanDocumentViewTemplate;
  userMessage?: string;
}

type PlanDocumentFieldValue =
  | StructuredResponseContainer
  | PlanDocumentViewResponse;

export type PlanDocumentStructuredFieldProps =
  FieldComponentProps<PlanDocumentFieldValue>;

const PLAN_DOCUMENT_VIEW_ALLOWED_TEMPLATES = [
  DesignDocTemplate.PlanDocument,
  DesignDocTemplate.Brainstorm,
] as const;

type PlanDocumentViewTemplate =
  (typeof PLAN_DOCUMENT_VIEW_ALLOWED_TEMPLATES)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isPlanDocumentViewTemplate = (
  value: string
): value is PlanDocumentViewTemplate =>
  PLAN_DOCUMENT_VIEW_ALLOWED_TEMPLATES.includes(
    value as PlanDocumentViewTemplate
  );

const normalizePlanDocumentTemplate = (
  value: unknown
): PlanDocumentViewTemplate | undefined => {
  const template = readNonEmptyString(value);
  if (!template || !isPlanDocumentViewTemplate(template)) {
    return undefined;
  }

  return template;
};

const isPlanDocumentCompatibleTemplate = (
  value: DesignDocTemplate
): value is PlanDocumentViewTemplate =>
  PLAN_DOCUMENT_VIEW_ALLOWED_TEMPLATES.includes(
    value as PlanDocumentViewTemplate
  );

const toPlanDocumentViewResponse = (
  value: unknown
): PlanDocumentViewResponse | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.responseType !== undefined &&
    value.responseType !== "plan_document_view_v1"
  ) {
    return null;
  }

  const entityId =
    readNonEmptyString(value.entityId) ?? readNonEmptyString(value.designDocId);
  if (!entityId) {
    return null;
  }

  const template =
    normalizePlanDocumentTemplate(value.template) ??
    normalizePlanDocumentTemplate(value.designDocTemplate);
  const responseType =
    value.responseType === "plan_document_view_v1"
      ? "plan_document_view_v1"
      : undefined;

  return {
    entityId,
    ...(template ? { template } : {}),
    ...(responseType ? { responseType } : {}),
  };
};

const extractPlanDocumentResponse = (
  value: PlanDocumentFieldValue | undefined
): PlanDocumentViewResponse | null => {
  const directMatch = toPlanDocumentViewResponse(value);
  if (directMatch) {
    return directMatch;
  }

  if (!isRecord(value)) {
    return null;
  }

  const structured = value.structuredResponse;
  if (!isRecord(structured)) {
    return null;
  }

  if (
    structured.responseType !== undefined &&
    structured.responseType !== "plan_document_view_v1"
  ) {
    return null;
  }

  return toPlanDocumentViewResponse(structured.parsed);
};

export const PlanDocumentStructuredField: React.FC<
  PlanDocumentStructuredFieldProps
> = ({ config, value, context, disabled = false, onChange }) => {
  const navigate = useNavigate();
  const pathService = usePathService();
  const response = extractPlanDocumentResponse(value);

  const designDocQuery = useDesignDoc(
    context.organizationId,
    response?.entityId,
    {
      enabled: response !== null,
      preferStale: true,
    }
  );

  if (!response) {
    return (
      <Alert
        severity="info"
        data-testid={`plan-document-structured-field-empty-${config.field}`}
      >
        Plan document details are unavailable.
      </Alert>
    );
  }

  if (designDocQuery.isLoading || designDocQuery.isFetching) {
    return (
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        data-testid={`plan-document-structured-field-loading-${config.field}`}
      >
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Loading plan document...
        </Typography>
      </Stack>
    );
  }

  if (designDocQuery.error) {
    return (
      <Alert
        severity="error"
        data-testid={`plan-document-structured-field-error-${config.field}`}
      >
        Failed to load plan document.
      </Alert>
    );
  }

  const designDoc = designDocQuery.data;
  if (!designDoc) {
    return (
      <Alert
        severity="warning"
        data-testid={`plan-document-structured-field-missing-${config.field}`}
      >
        Plan document not found for entityId {response.entityId}.
      </Alert>
    );
  }

  if (!isPlanDocumentCompatibleTemplate(designDoc.template)) {
    return (
      <Alert
        severity="warning"
        data-testid={`plan-document-structured-field-template-mismatch-${config.field}`}
      >
        Expected a PLAN_DOCUMENT or BRAINSTORM design document but received{" "}
        {designDoc.template}.
      </Alert>
    );
  }

  return (
    <Box
      data-testid={`plan-document-structured-field-${config.field}`}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
        width: "100%",
        maxWidth: { xs: "100%", lg: 1100 },
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle1" fontWeight={600}>
            {config.description || "Plan Document"}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color="primary"
            label={response.responseType ?? "plan_document_view"}
          />
          <Chip
            size="small"
            variant="outlined"
            label={`Entity: ${response.entityId}`}
          />
        </Stack>

        <Typography variant="body2" color="text.secondary">
          Read-only preview.
        </Typography>

        <DesignDocReadView
          title={designDoc.name}
          summary={designDoc.summary}
          sections={designDoc.sections}
          status={designDoc.status}
          mentionConfig={{
            organizationId: context.organizationId,
            projectId: context.projectId,
            navigate,
          }}
        />

        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button
            variant="outlined"
            type="button"
            onClick={() => {
              const url = pathService.designDoc({
                projectId: context.projectId,
                designDocId: designDoc.id,
              });
              navigate(url);
            }}
            disabled={disabled}
            data-testid={`plan-document-structured-field-edit-${config.field}`}
          >
            Edit Plan Document
          </Button>
          <Button
            variant="contained"
            color="primary"
            type="submit"
            onClick={() => {
              onChange?.({
                entityId: response.entityId,
                ...(response.template ? { template: response.template } : {}),
                ...(response.responseType
                  ? { responseType: response.responseType }
                  : {}),
                userMessage: "The user approved the plan",
              });
            }}
            disabled={disabled}
            data-testid={`plan-document-structured-field-looks-good-${config.field}`}
          >
            Looks Good
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};
