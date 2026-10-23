import { useCreateAdr, useCreateDesignDoc } from "../../data";
import { useUserIdentity } from "../../hooks";
import GavelIcon from "@mui/icons-material/Gavel";
import DecisionIcon from "@mui/icons-material/HowToVote";
import BrainstormIcon from "@mui/icons-material/Lightbulb";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  DesignDocParentEntityType,
  DesignDocTemplate,
  type DesignDocResponseDto,
} from "../../api";
import { usePathService } from "../../contexts";
import {
  FeatureSelector,
  TaskSelector,
  WorkItemSelector,
  type WorkItemSelectorValue,
} from "../Selectors";
import type { DocumentTemplate, LinkedItemMode } from "./types";
import { useLinkedItem } from "./useLinkedItem";

interface CreateDocumentFormProps {
  projectId: string;
  organizationId?: string;
  linkedItemMode?: LinkedItemMode;
  linkedItemValue?:
    | WorkItemSelectorValue
    | string
    | { type: string; id: string }
    | null;
  linkedItemReadOnly?: boolean;
  onSuccess?: (doc: DesignDocResponseDto) => void;
  onError?: (error: string) => void;
}

const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "adr",
    name: "Architecture Decision Record",
    description:
      "Document an architecture decision with context, decision, and consequences",
    icon: <GavelIcon />,
    type: DesignDocTemplate.Adr,
  },
  {
    id: "brainstorm",
    name: "Brainstorm",
    description: "Capture ideas, options, and open questions",
    icon: <BrainstormIcon />,
    type: DesignDocTemplate.Brainstorm,
  },
  {
    id: "decision",
    name: "Decision",
    description: "Summarize a decision with rationale and next steps",
    icon: <DecisionIcon />,
    type: DesignDocTemplate.Decision,
  },
];

export const CreateDocumentForm: React.FC<CreateDocumentFormProps> = ({
  projectId,
  organizationId: organizationIdProp,
  linkedItemMode = "workItem",
  linkedItemValue = null,
  linkedItemReadOnly = false,
  onSuccess,
  onError,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathService = usePathService();
  const identity = useUserIdentity();
  const currentOrgId = organizationIdProp ?? identity?.currentOrgId ?? null;
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] =
    useState<DocumentTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [itemSelection, setItemSelection] = useState<
    WorkItemSelectorValue | string | { type: string; id: string } | null
  >(linkedItemValue);

  useEffect(() => {
    setItemSelection(linkedItemValue);
  }, [linkedItemValue]);

  // Hook for creating ADR documents
  const { mutate: createAdr, isPending: isCreatingAdr } = useCreateAdr();

  // Hook for creating blank design documents
  const { mutate: createDesignDoc, isPending: isCreatingDesignDoc } =
    useCreateDesignDoc();

  const isCreating = isCreatingAdr || isCreatingDesignDoc;

  const resetForm = useCallback((): void => {
    setSelectedTemplate(null);
    setTitle("");
    setSummary("");
    setError(null);
    setItemSelection(linkedItemValue ?? null);
  }, [linkedItemValue]);

  const handleTemplateSelect = useCallback(
    (template: DocumentTemplate): void => {
      setError(null);
      setSelectedTemplate(template);
    },
    []
  );

  const handleBack = useCallback((): void => {
    setSelectedTemplate(null);
    setError(null);
  }, []);

  const resolvedSelectorMode: LinkedItemMode = linkedItemMode;
  const isSelectorReadOnly = linkedItemReadOnly;

  const linkedItem = useLinkedItem(
    currentOrgId,
    resolvedSelectorMode,
    itemSelection
  );

  const selectorHelperText = isSelectorReadOnly
    ? t("documents.linkedItemReadOnly", "Linked item is managed automatically")
    : undefined;

  const selectorDisabled = isSelectorReadOnly || isCreating;

  const renderLinkedItemSelector = useCallback((): React.ReactNode => {
    if (!currentOrgId || resolvedSelectorMode === "none") {
      return null;
    }

    if (resolvedSelectorMode === "design-doc") {
      // Design doc is read-only and managed by parent
      return null;
    }

    switch (resolvedSelectorMode) {
      case "initiative": {
        const initiativeValue =
          typeof itemSelection === "string" ? itemSelection : null;
        return (
          <FeatureSelector
            organizationId={currentOrgId}
            projectId={projectId}
            value={initiativeValue}
            onChange={(initiativeId) => setItemSelection(initiativeId)}
            helperText={selectorHelperText}
            disabled={selectorDisabled}
          />
        );
      }
      case "task": {
        const taskValue =
          typeof itemSelection === "string" ? itemSelection : null;
        return (
          <TaskSelector
            organizationId={currentOrgId}
            projectId={projectId}
            value={taskValue}
            onChange={(taskId) => setItemSelection(taskId)}
            helperText={selectorHelperText}
            disabled={selectorDisabled}
          />
        );
      }
      case "workItem":
      default: {
        const workItemValue =
          itemSelection &&
          typeof itemSelection === "object" &&
          itemSelection !== null &&
          "type" in itemSelection &&
          "id" in itemSelection
            ? (itemSelection as WorkItemSelectorValue)
            : null;
        return (
          <WorkItemSelector
            organizationId={currentOrgId}
            projectId={projectId}
            value={workItemValue}
            onChange={(selection) => setItemSelection(selection)}
            helperText={selectorHelperText}
            disabled={selectorDisabled}
          />
        );
      }
    }
  }, [
    currentOrgId,
    resolvedSelectorMode,
    projectId,
    itemSelection,
    selectorHelperText,
    selectorDisabled,
  ]);

  const handleCreateDocument = useCallback(async (): Promise<void> => {
    if (!currentOrgId) {
      const errorMsg = "Organization ID is required";
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    if (!title.trim()) {
      const errorMsg = "Title is required";
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    setError(null);

    let parentEntityId: string | undefined;
    let parentEntityType: DesignDocParentEntityType | undefined;
    if (linkedItem) {
      if (linkedItem.type === "task") {
        parentEntityId = linkedItem.id;
        parentEntityType = DesignDocParentEntityType.Task;
      } else if (linkedItem.type === "design-doc") {
        parentEntityId = linkedItem.id;
        parentEntityType = DesignDocParentEntityType.DesignDoc;
      }
    }

    try {
      const newDoc: DesignDocResponseDto =
        selectedTemplate?.type === DesignDocTemplate.Adr
          ? await createAdr({
              organizationId: currentOrgId,
              adr: {
                name: title.trim(),
                summary,
                projectId,
                parentEntityId,
                parentEntityType,
                content: {
                  context: "",
                  consequences: "",
                  decision: "",
                },
              },
            })
          : await createDesignDoc({
              organizationId: currentOrgId,
              designDoc: {
                name: title.trim(),
                projectId,
                summary,
                parentEntityId,
                parentEntityType,
                template:
                  selectedTemplate?.type ?? DesignDocTemplate.Brainstorm,
              },
            });

      resetForm();
      onSuccess?.(newDoc);
      navigate(
        pathService.projectDocumentEdit({ projectId, documentId: newDoc.id })
      );
    } catch (err) {
      console.error("Failed to create document:", err);
      const errorMsg =
        (err as { message?: string })?.message ||
        "Failed to create document. Please try again.";
      setError(errorMsg);
      onError?.(errorMsg);
    }
  }, [
    currentOrgId,
    title,
    selectedTemplate?.type,
    summary,
    projectId,
    createAdr,
    createDesignDoc,
    linkedItem,
    resetForm,
    onSuccess,
    onError,
    navigate,
    pathService,
  ]);

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {isCreating ? (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          minHeight={200}
          gap={2}
        >
          <CircularProgress size={40} />
          <Typography variant="body2" color="text.secondary">
            {t("documents.creating", "Creating document...")}
          </Typography>
        </Box>
      ) : !selectedTemplate ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t("documents.selectTemplate", "Choose a template to get started")}
          </Typography>
          <Grid container spacing={2}>
            {DOCUMENT_TEMPLATES.map((template) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={template.id}>
                <Card
                  sx={{
                    height: "100%",
                    cursor: "pointer",
                    transition: "all 0.2s ease-in-out",
                    "&:hover": {
                      transform: "translateY(-2px)",
                      boxShadow: 3,
                    },
                  }}
                >
                  <CardActionArea
                    onClick={() => handleTemplateSelect(template)}
                    sx={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      p: 2,
                    }}
                  >
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 2,
                        bgcolor: "primary.light",
                        color: "primary.contrastText",
                        mb: 2,
                        fontSize: "24px",
                      }}
                    >
                      {template.icon}
                    </Box>

                    <Typography variant="h6" gutterBottom>
                      {template.name}
                    </Typography>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ flexGrow: 1 }}
                    >
                      {template.description}
                    </Typography>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t("documents.provideDetails", "Provide details for your document")}
          </Typography>
          <Stack spacing={3}>
            <TextField
              label={t("documents.title", "Title")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
              required
              autoFocus
              placeholder={
                selectedTemplate.type === DesignDocTemplate.Adr
                  ? "e.g., Use PostgreSQL for data storage"
                  : "e.g., My Document"
              }
            />
            <TextField
              label={t("documents.summary", "Summary")}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              fullWidth
              multiline
              rows={4}
              placeholder={t(
                "documents.summaryPlaceholder",
                "Provide a brief description or initial content..."
              )}
            />
            {currentOrgId && resolvedSelectorMode !== "none" && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t("documents.linkedItem", "Linked item (optional)")}
                </Typography>
                {renderLinkedItemSelector()}
              </Box>
            )}
          </Stack>
        </>
      )}

      {selectedTemplate && !isCreating && (
        <Box
          sx={{ display: "flex", gap: 2, mt: 3, justifyContent: "flex-start" }}
        >
          <Button onClick={handleBack}>{t("common.back", "Back")}</Button>
          <Button
            onClick={handleCreateDocument}
            variant="contained"
            disabled={!title.trim()}
          >
            {t("documents.ready", "Ready")}
          </Button>
        </Box>
      )}
    </Box>
  );
};
