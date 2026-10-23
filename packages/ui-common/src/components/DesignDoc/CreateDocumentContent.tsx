import React, { useCallback, useState } from "react";
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
import GavelIcon from "@mui/icons-material/Gavel";
import DecisionIcon from "@mui/icons-material/HowToVote";
import BrainstormIcon from "@mui/icons-material/Lightbulb";
import { useTranslation } from "react-i18next";
import {
  useCreateAdr,
  useCreateDesignDoc,
  useGenerateSuggestedDesignDoc,
} from "../../data/hooks";
import { useUserIdentity } from "../../hooks";
import {
  DesignDocTemplate,
  type CreateDesignDocLinkDto,
  type CreateSuggestedDesignDocResponseDto,
  type DesignDocParentEntityType,
  type DesignDocResponseDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import type { DocumentTemplate } from "./types";

type CreateDocumentContentBaseProps = {
  projectId: string;
  organizationId?: string;
  initialTitle?: string;
  initialSummary?: string;
  parentEntityId?: string | null;
  parentEntityType?: DesignDocParentEntityType | null;
  linkedEntity?: CreateDesignDocLinkDto;
  onClose: () => void;
  onError?: (error: string) => void;
};

type CreateDocumentContentBlankProps = CreateDocumentContentBaseProps & {
  mode: "blank_doc";
  onSuccess?: (doc: DesignDocResponseDto) => void;
};

type CreateDocumentContentSuggestedProps = CreateDocumentContentBaseProps & {
  mode: "suggested_doc";
  sourceConversationId: string;
  sourceMessageId: string;
  suggestionId: string;
  trigger?: string;
  onSuccess?: (response: CreateSuggestedDesignDocResponseDto) => void;
};

export type CreateDocumentContentProps =
  | CreateDocumentContentBlankProps
  | CreateDocumentContentSuggestedProps;

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

export const CreateDocumentContent: React.FC<CreateDocumentContentProps> = (
  props
) => {
  const {
    projectId,
    organizationId: organizationIdProp,
    initialTitle = "",
    initialSummary = "",
    parentEntityId,
    parentEntityType,
    linkedEntity,
    onClose,
    onError,
  } = props;
  const { t } = useTranslation();
  const { currentOrgId } = useUserIdentity() || {};
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] =
    useState<DocumentTemplate | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);

  const organizationId = organizationIdProp ?? currentOrgId ?? null;

  const linkDesignDoc = useCallback(
    async (designDocId: string): Promise<void> => {
      if (!linkedEntity || !organizationId) {
        return;
      }

      try {
        await unifiedApiClient.createDesignDocLinks({
          organizationId,
          designDocId,
          createDesignDocLinkDto: [linkedEntity],
        });
      } catch (linkError) {
        console.error("Failed to link design document to entity", linkError, {
          organizationId,
          designDocId,
          linkedEntity,
        });
      }
    },
    [linkedEntity, organizationId]
  );

  const { mutate: createAdr, isPending: isCreatingAdr } = useCreateAdr({
    onSuccess: async (newDoc) => {
      if (props.mode !== "blank_doc") {
        return;
      }

      await linkDesignDoc(newDoc.id);
      resetForm();
      props.onSuccess?.(newDoc);
      onClose();
    },
    onError: (err) => {
      if (props.mode !== "blank_doc") {
        return;
      }

      const message =
        (err as { message?: string })?.message ||
        "Failed to create ADR document";
      setError(message);
      onError?.(message);
    },
  });

  const { mutate: createDesignDoc, isPending: isCreatingDesignDoc } =
    useCreateDesignDoc({
      onSuccess: async (newDoc) => {
        if (props.mode !== "blank_doc") {
          return;
        }

        await linkDesignDoc(newDoc.id);
        resetForm();
        props.onSuccess?.(newDoc);
        onClose();
      },
      onError: (err) => {
        if (props.mode !== "blank_doc") {
          return;
        }

        const message =
          (err as { message?: string })?.message || "Failed to create document";
        setError(message);
        onError?.(message);
      },
    });

  const {
    mutate: generateSuggestedDesignDoc,
    isPending: isGeneratingSuggestedDesignDoc,
  } = useGenerateSuggestedDesignDoc({
    onSuccess: (response) => {
      if (props.mode !== "suggested_doc") {
        return;
      }

      resetForm();
      props.onSuccess?.(response);
      onClose();
    },
    onError: (err) => {
      if (props.mode !== "suggested_doc") {
        return;
      }

      const message =
        (err as { message?: string })?.message || "Failed to generate document";
      setError(message);
      onError?.(message);
    },
  });

  const isCreating =
    isCreatingAdr || isCreatingDesignDoc || isGeneratingSuggestedDesignDoc;

  const resetForm = useCallback((): void => {
    setSelectedTemplate(null);
    setTitle(initialTitle);
    setSummary(initialSummary);
    setError(null);
  }, [initialSummary, initialTitle]);

  const handleTemplateSelect = (template: DocumentTemplate): void => {
    setError(null);
    setSelectedTemplate(template);
  };

  const handleBack = (): void => {
    setSelectedTemplate(null);
    setError(null);
  };

  const resolveSuggestedTemplate = (): DesignDocTemplate =>
    selectedTemplate?.type ?? DesignDocTemplate.Brainstorm;

  const handleCreateDocument = (): void => {
    if (!organizationId) {
      const message = "Organization ID is required";
      setError(message);
      onError?.(message);
      return;
    }

    if (!title.trim()) {
      const message = "Title is required";
      setError(message);
      onError?.(message);
      return;
    }

    setError(null);

    if (props.mode === "suggested_doc") {
      const { sourceConversationId, sourceMessageId, suggestionId, trigger } =
        props;
      generateSuggestedDesignDoc({
        organizationId,
        request: {
          suggestionId,
          name: title.trim(),
          projectId,
          description: summary,
          template: resolveSuggestedTemplate(),
          sourceConversationId,
          sourceMessageId,
          trigger,
        },
      });
      return;
    }

    if (selectedTemplate?.type === DesignDocTemplate.Adr) {
      createAdr({
        organizationId,
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
      });
      return;
    }

    createDesignDoc({
      organizationId,
      designDoc: {
        name: title.trim(),
        projectId,
        summary,
        parentEntityId,
        parentEntityType,
        template: selectedTemplate?.type ?? DesignDocTemplate.Brainstorm,
      },
    });
  };

  const handleClose = useCallback((): void => {
    if (!isCreating) {
      resetForm();
      onClose();
    }
  }, [isCreating, onClose, resetForm]);

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
          </Stack>
        </>
      )}

      {selectedTemplate && !isCreating ? (
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
      ) : (
        <Box sx={{ display: "flex", justifyContent: "flex-start", mt: 3 }}>
          <Button onClick={handleClose} disabled={isCreating}>
            {t("common.cancel", "Cancel")}
          </Button>
        </Box>
      )}
    </Box>
  );
};
