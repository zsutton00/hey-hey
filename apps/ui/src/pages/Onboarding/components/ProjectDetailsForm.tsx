import React, { useState, useCallback, useRef } from "react";
import { Box, TextField, Typography, Chip, IconButton } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import ErrorIcon from "@mui/icons-material/Error";
import EditIcon from "@mui/icons-material/Edit";
import type { ProjectResponseDto } from "@hey-hey/ui-common/api";
import { useProjectAutosave } from "@hey-hey/ui-common/data";
import { projectCapabilitiesForRole } from "@hey-hey/ui-common/hooks";

interface ProjectDetailsFormProps {
  project: ProjectResponseDto;
  organizationId: string;
}

export const ProjectDetailsForm: React.FC<ProjectDetailsFormProps> = ({
  project,
  organizationId,
}) => {
  const { manageSettings } = projectCapabilitiesForRole(
    project.currentUserRole,
  );
  const [name, setName] = useState<string>(project.name || "");
  const [description, setDescription] = useState<string>(
    project.description || "",
  );
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const editContainerRef = useRef<HTMLDivElement>(null);

  const { autosaveStatus, triggerManualSave } = useProjectAutosave({
    organizationId,
    projectId: project.id,
    content: { name, description },
    enabled: manageSettings,
    onError: (error) => {
      console.error("[ProjectDetailsForm] Autosave error:", error);
    },
  });

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    [],
  );

  const handleDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setDescription(event.target.value);
    },
    [],
  );

  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleContainerBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const nextFocus = event.relatedTarget as Node | null;
      if (nextFocus && event.currentTarget.contains(nextFocus)) {
        return;
      }
      triggerManualSave();
      setIsEditing(false);
    },
    [triggerManualSave],
  );

  const renderSaveStatus = (): React.ReactNode => {
    if (autosaveStatus === "saving") {
      return (
        <Chip
          label="Saving..."
          size="small"
          color="primary"
          variant="outlined"
        />
      );
    }

    if (autosaveStatus === "saved") {
      return (
        <Chip
          icon={<CheckIcon />}
          label="Saved"
          size="small"
          color="success"
          variant="outlined"
        />
      );
    }

    if (autosaveStatus === "error") {
      return (
        <Chip
          icon={<ErrorIcon />}
          label="Error saving"
          size="small"
          color="error"
          variant="outlined"
        />
      );
    }

    return null;
  };

  const renderSectionHeader = (actionSlot: React.ReactNode): React.ReactNode => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
      <Typography
        variant="overline"
        sx={{
          flex: 1,
          color: (theme) => theme.palette.heyhey.main,
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        Project details
      </Typography>
      {renderSaveStatus()}
      {actionSlot}
    </Box>
  );

  if (isEditing) {
    return (
      <Box
        ref={editContainerRef}
        onBlur={handleContainerBlur}
        sx={{ mb: 3, display: "flex", flexDirection: "column", gap: 2 }}
      >
        {renderSectionHeader(null)}
        <TextField
          fullWidth
          autoFocus
          label="Project Title"
          value={name}
          onChange={handleNameChange}
          placeholder="Enter your project title"
          variant="outlined"
          data-testid="project-title-input"
        />
        <TextField
          fullWidth
          label="Project Description"
          value={description}
          onChange={handleDescriptionChange}
          placeholder="Describe your project (optional)"
          multiline
          rows={3}
          variant="outlined"
          data-testid="project-description-input"
        />
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 3 }}>
      {renderSectionHeader(
        manageSettings ? (
          <IconButton
            size="small"
            aria-label="Edit project details"
            onClick={handleEdit}
            data-testid="project-details-edit-button"
          >
            <EditIcon fontSize="small" />
          </IconButton>
        ) : null,
      )}
      <Typography
        variant="h5"
        sx={{
          pb: 1,
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          color: (theme) =>
            name ? theme.palette.text.primary : theme.palette.text.secondary,
          fontStyle: name ? "normal" : "italic",
        }}
        data-testid="project-title-display"
      >
        {name || "Untitled project"}
      </Typography>
      <Typography
        variant="body1"
        sx={{
          mt: 1,
          pb: 1,
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          color: (theme) =>
            description
              ? theme.palette.text.primary
              : theme.palette.text.secondary,
          fontStyle: description ? "normal" : "italic",
          whiteSpace: "pre-wrap",
        }}
        data-testid="project-description-display"
      >
        {description || "Add a description"}
      </Typography>
    </Box>
  );
};
