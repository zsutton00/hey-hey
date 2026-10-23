import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import React, { useCallback, useMemo, useState } from "react";
import type {
  WorkItemHtmlCssAnnotationTarget,
  WorkItemStructuredMockupAnnotationCategory,
  WorkItemTypeSectionDefinition,
} from "../../api";
import { getCurrentUser } from "../../services/authService";
import { decodeHtmlCssSectionContent } from "../../utils/workItemSections";
import { HtmlCssSectionRenderer } from "../shared/HtmlCssSectionRenderer";

export const HtmlCssSectionEditor: React.FC<{
  value: string;
  onChange: (value: string) => void;
  definition: WorkItemTypeSectionDefinition;
  disabled?: boolean;
  authorUserId?: string;
  organizationId?: string;
  projectId?: string;
  /** Id of the existing work item being edited; the pencil opens it as last approved. */
  workItemId?: string;
  materializedProposalId?: string;
}> = ({
  value,
  onChange,
  definition,
  disabled = false,
  authorUserId,
  organizationId,
  projectId,
  workItemId,
  materializedProposalId,
}) => {
  const [pendingTarget, setPendingTarget] =
    useState<WorkItemHtmlCssAnnotationTarget | null>(null);
  const [annotationNote, setAnnotationNote] = useState("");
  const [annotationCategory, setAnnotationCategory] =
    useState<WorkItemStructuredMockupAnnotationCategory>("context");
  const content = useMemo(() => decodeHtmlCssSectionContent(value), [value]);
  const update = (field: "html" | "css", next: string) =>
    onChange(
      JSON.stringify({
        ...content,
        [field]: next,
      }),
    );
  const handleCreateAnnotation = useCallback(() => {
    if (!content || !pendingTarget || !materializedProposalId) return;
    const userId = authorUserId ?? getCurrentUser()?.id;
    if (!userId) return;
    const presentationSizeKey =
      content.sizeKey ?? definition.defaultSizeKey ?? "default";
    onChange(
      JSON.stringify({
        ...content,
        annotations: [
          ...(content.annotations ?? []),
          {
            id: crypto.randomUUID(),
            note: annotationNote.trim(),
            author: { type: "human", userId },
            category: annotationCategory,
            lifecycle: "open",
            authoredProposalId: materializedProposalId,
            authoredSizeKey: presentationSizeKey,
            target: pendingTarget,
          },
        ],
      }),
    );
    setPendingTarget(null);
    setAnnotationNote("");
    setAnnotationCategory("context");
  }, [
    annotationCategory,
    annotationNote,
    authorUserId,
    content,
    definition.defaultSizeKey,
    materializedProposalId,
    onChange,
    pendingTarget,
  ]);

  if (!content) {
    return (
      <Typography color="error">
        The HTML/CSS source is malformed and cannot be edited.
      </Typography>
    );
  }

  return (
    <Stack spacing={2} sx={{ px: 1.75, pb: 2 }}>
      {definition.sizeProfiles?.length ? (
        <TextField
          select
          label="Presentation size"
          value={content.sizeKey ?? definition.defaultSizeKey ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              JSON.stringify({ ...content, sizeKey: event.target.value }),
            )
          }
          slotProps={{
            htmlInput: { "data-testid": "html-css-size-profile-selector" },
          }}
        >
          {definition.sizeProfiles.map((profile) => (
            <MenuItem key={profile.key} value={profile.key}>
              {profile.label}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      <HtmlCssSectionRenderer
        content={content}
        definition={definition}
        context="inline"
        title="Draft HTML/CSS mockup preview"
        organizationId={organizationId}
        projectId={projectId}
        mockupSource={workItemId ? { kind: "workItem", workItemId } : undefined}
        materializedProposalId={materializedProposalId}
      />
      <Accordion disableGutters elevation={0}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls="html-css-source-editor"
        >
          <Typography fontWeight={500}>Edit HTML/CSS source</Typography>
        </AccordionSummary>
        <AccordionDetails id="html-css-source-editor">
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 2,
            }}
          >
            <TextField
              label="HTML"
              multiline
              minRows={10}
              value={content.html}
              disabled={disabled}
              onChange={(event) => update("html", event.target.value)}
              inputProps={{ "aria-label": "HTML source" }}
            />
            <TextField
              label="CSS"
              multiline
              minRows={10}
              value={content.css}
              disabled={disabled}
              onChange={(event) => update("css", event.target.value)}
              inputProps={{ "aria-label": "CSS source" }}
            />
          </Box>
        </AccordionDetails>
      </Accordion>
      <Dialog
        open={pendingTarget !== null}
        onClose={() => setPendingTarget(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Add review note</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              label="Note"
              multiline
              minRows={3}
              value={annotationNote}
              inputProps={{ maxLength: 4000 }}
              onChange={(event) => setAnnotationNote(event.target.value)}
            />
            <TextField
              select
              label="Category"
              value={annotationCategory}
              onChange={(event) =>
                setAnnotationCategory(
                  event.target
                    .value as WorkItemStructuredMockupAnnotationCategory,
                )
              }
            >
              {["context", "suggestion", "question", "issue"].map(
                (category) => (
                  <MenuItem key={category} value={category}>
                    {category[0].toUpperCase() + category.slice(1)}
                  </MenuItem>
                ),
              )}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!annotationNote.trim()}
            onClick={handleCreateAnnotation}
          >
            Add note
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};
