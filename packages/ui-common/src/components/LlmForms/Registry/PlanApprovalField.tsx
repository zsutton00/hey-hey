import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PlanApprovalPayload } from "../../../api";
import {
  createPlanApprovalValue,
  getActiveWorkstreams,
  normalizePlanApprovalValue,
} from "./planApprovalUtils";
import type { FieldComponentProps } from "./types";
import {
  type PlanApprovalFieldConfig,
  type PlanApprovalValue,
  type PlanApprovalWorkstreamEdit,
} from "./types";

export interface PlanApprovalFieldProps
  extends Omit<FieldComponentProps<PlanApprovalValue>, "config"> {
  config: PlanApprovalFieldConfig;
}

type EditingField =
  | "approach"
  | "outcome"
  | "verification"
  | { type: "workstream"; id: string; field: "name" | "focus" }
  | null;

export const PlanApprovalField: React.FC<PlanApprovalFieldProps> = ({
  config,
  value,
  onChange,
  disabled = false,
  isSubmitted = false,
}) => {
  const payload = config.payload as PlanApprovalPayload | undefined;
  const fallbackValue = useMemo(
    () => (payload ? createPlanApprovalValue(payload) : null),
    [payload]
  );

  const [editingField, setEditingField] = useState<EditingField>(null);
  const [editValue, setEditValue] = useState("");
  const hasSeededInitialValueRef = useRef(false);

  const fieldValue = value ?? fallbackValue ?? null;
  const normalizedValue = useMemo(() => {
    if (!fieldValue || !fallbackValue) return null;
    return normalizePlanApprovalValue(fieldValue, fallbackValue);
  }, [fieldValue, fallbackValue]);

  useEffect(() => {
    if (hasSeededInitialValueRef.current) {
      return;
    }
    if (!fallbackValue || value !== undefined || !onChange) {
      return;
    }

    // Ensure the form always has a concrete PLAN_APPROVAL object so
    // secondary actions submit the payload shape expected by the API node.
    onChange(fallbackValue);
    hasSeededInitialValueRef.current = true;
  }, [fallbackValue, onChange, value]);

  if (!payload || !normalizedValue) {
    return (
      <Box sx={{ p: 2, color: "error.main" }}>
        <Typography>Missing plan approval payload</Typography>
      </Box>
    );
  }

  const isLocked = disabled || isSubmitted;

  const activeWorkstreams = getActiveWorkstreams(normalizedValue);

  const handleDescriptionChange = (
    field: "approach" | "outcome" | "verification",
    newValue: string
  ) => {
    onChange?.({
      ...normalizedValue,
      description: {
        ...normalizedValue.description,
        [field]: newValue,
      },
    });
  };

  const handleWorkstreamChange = (
    workstreamId: string,
    field: "name" | "focus",
    newValue: string
  ) => {
    onChange?.({
      ...normalizedValue,
      workstreams: normalizedValue.workstreams.map((ws) =>
        ws.id === workstreamId ? { ...ws, [field]: newValue } : ws
      ),
    });
  };

  const handleDeleteWorkstream = (workstreamId: string) => {
    onChange?.({
      ...normalizedValue,
      workstreams: normalizedValue.workstreams.map((ws) =>
        ws.id === workstreamId ? { ...ws, isDeleted: true } : ws
      ),
    });
  };

  const handleAddWorkstream = () => {
    const newWorkstream: PlanApprovalWorkstreamEdit = {
      id: `ws-new-${Date.now()}`,
      name: "New Workstream",
      focus: "Describe what this workstream accomplishes",
      isNew: true,
      isDeleted: false,
    };
    onChange?.({
      ...normalizedValue,
      workstreams: [...normalizedValue.workstreams, newWorkstream],
    });
    // Start editing the new workstream name
    setEditingField({
      type: "workstream",
      id: newWorkstream.id,
      field: "name",
    });
    setEditValue(newWorkstream.name);
  };

  const handleUserMessageChange = (message: string) => {
    onChange?.({
      ...normalizedValue,
      userMessage: message,
    });
  };

  const startEditing = (field: EditingField, currentValue: string) => {
    if (isLocked) return;
    setEditingField(field);
    setEditValue(currentValue);
  };

  const commitEdit = () => {
    if (!editingField) return;

    if (
      editingField === "approach" ||
      editingField === "outcome" ||
      editingField === "verification"
    ) {
      handleDescriptionChange(editingField, editValue);
    } else if (editingField && typeof editingField === "object") {
      handleWorkstreamChange(editingField.id, editingField.field, editValue);
    }

    setEditingField(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const sectionHeaderSx = {
    color: "actionable.main",
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    mb: 1,
  };

  const lockedSx = isLocked
    ? { opacity: 0.7, pointerEvents: "none" as const }
    : {};

  const renderEditableText = (
    field: "approach" | "outcome" | "verification",
    label: string,
    value: string,
    options?: {
      fontWeight?: number;
      bgcolor?: string | ((theme: Theme) => string);
      textColor?: string;
      headerColor?: string;
    }
  ) => {
    const isEditing = editingField === field;
    const { fontWeight, bgcolor, textColor, headerColor } = options ?? {};

    // Resolve bgcolor - it can be a string or a function that takes theme
    const resolveBgColor = (theme: Theme) =>
      typeof bgcolor === "function" ? bgcolor(theme) : bgcolor;

    if (isEditing) {
      return (
        <Box
          sx={(theme) => ({
            borderRadius: 1,
            p: 2,
            height: "100%",
            bgcolor: resolveBgColor(theme),
          })}
        >
          <Typography
            variant="overline"
            sx={{
              ...sectionHeaderSx,
              fontSize: "0.65rem",
              mb: 0.5,
              color: headerColor ?? textColor ?? sectionHeaderSx.color,
            }}
          >
            {label}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            size="small"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            sx={{
              "& .MuiInputBase-root": {
                bgcolor: "background.paper",
              },
            }}
          />
        </Box>
      );
    }

    return (
      <Box
        onClick={() => startEditing(field, value)}
        sx={(theme) => ({
          position: "relative",
          borderRadius: 1,
          p: 2,
          height: "100%",
          bgcolor: resolveBgColor(theme),
          cursor: isLocked ? "default" : "pointer",
          "&:hover": isLocked
            ? {}
            : {
                opacity: 0.9,
              },
          ...(isLocked ? { opacity: 0.7, pointerEvents: "none" as const } : {}),
        })}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Typography
            variant="overline"
            sx={{
              ...sectionHeaderSx,
              fontSize: "0.65rem",
              mb: 0.5,
              color: headerColor ?? textColor ?? sectionHeaderSx.color,
            }}
          >
            {label}
          </Typography>
          {!isLocked && (
            <IconButton
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                startEditing(field, value);
              }}
              aria-label={`Edit ${label}`}
              sx={{ ml: 1 }}
            >
              <EditIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Stack>
        <Typography variant="body1" sx={{ fontWeight, color: textColor }}>
          {value}
        </Typography>
      </Box>
    );
  };

  const renderWorkstreamCard = (workstream: PlanApprovalWorkstreamEdit) => {
    const isEditingName =
      typeof editingField === "object" &&
      editingField?.type === "workstream" &&
      editingField?.id === workstream.id &&
      editingField?.field === "name";
    const isEditingFocus =
      typeof editingField === "object" &&
      editingField?.type === "workstream" &&
      editingField?.id === workstream.id &&
      editingField?.field === "focus";

    return (
      <Grid key={workstream.id} size={{ xs: 12, sm: 6, md: 4 }}>
        <Card
          variant="outlined"
          sx={{
            height: "100%",
            transition: "box-shadow 0.2s",
            "&:hover": isLocked
              ? {}
              : {
                  boxShadow: 2,
                },
            ...lockedSx,
          }}
        >
          <CardContent sx={{ position: "relative" }}>
            {!isLocked && (
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ position: "absolute", top: 8, right: 8 }}
              >
                <IconButton
                  size="small"
                  onClick={() =>
                    startEditing(
                      { type: "workstream", id: workstream.id, field: "name" },
                      workstream.name
                    )
                  }
                  aria-label="Edit workstream name"
                >
                  <EditIcon sx={{ fontSize: 16 }} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => handleDeleteWorkstream(workstream.id)}
                  aria-label="Delete workstream"
                >
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Stack>
            )}

            {isEditingName ? (
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={handleKeyDown}
                sx={{ mb: 1, pr: 8 }}
              />
            ) : (
              <Typography
                variant="subtitle1"
                fontWeight={600}
                sx={{
                  pr: 8,
                  cursor: isLocked ? "default" : "pointer",
                  "&:hover": isLocked ? {} : { color: "primary.main" },
                }}
                onClick={() =>
                  startEditing(
                    { type: "workstream", id: workstream.id, field: "name" },
                    workstream.name
                  )
                }
              >
                {workstream.name}
              </Typography>
            )}

            {isEditingFocus ? (
              <TextField
                autoFocus
                fullWidth
                multiline
                size="small"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={handleKeyDown}
                sx={{ mt: 1 }}
              />
            ) : (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  mt: 1,
                  cursor: isLocked ? "default" : "pointer",
                  "&:hover": isLocked ? {} : { color: "text.primary" },
                }}
                onClick={() =>
                  startEditing(
                    { type: "workstream", id: workstream.id, field: "focus" },
                    workstream.focus
                  )
                }
              >
                {workstream.focus}
              </Typography>
            )}

            {workstream.isNew && (
              <Typography
                variant="caption"
                color="primary"
                sx={{ display: "block", mt: 1 }}
              >
                (Added)
              </Typography>
            )}
          </CardContent>
        </Card>
      </Grid>
    );
  };

  return (
    <Stack spacing={3} data-testid={`plan-approval-${config.field}`}>
      <Typography variant="body2" color="text.secondary">
        {config.description}
        {config.required && (
          <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
            *
          </Typography>
        )}
      </Typography>

      {/* Plan Summary Section */}
      <Box>
        <Typography variant="overline" sx={sectionHeaderSx}>
          Plan Summary
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            {renderEditableText(
              "approach",
              "How We Are Building This",
              normalizedValue.description.approach,
              {
                bgcolor: (theme) =>
                  theme.palette.mode === "dark" ? "grey.800" : "grey.100",
              }
            )}
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            {renderEditableText(
              "outcome",
              "What You Will Get",
              normalizedValue.description.outcome,
              {
                fontWeight: 600,
                bgcolor: "heyhey.main",
                textColor: "heyhey.contrastText",
                headerColor: "#333",
              }
            )}
          </Grid>
          <Grid size={{ xs: 12 }}>
            {renderEditableText(
              "verification",
              "How We Will Know It Works",
              normalizedValue.description.verification
            )}
          </Grid>
        </Grid>
      </Box>

      {/* Workstreams Section */}
      <Box>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 2 }}
        >
          <Typography variant="overline" sx={{ ...sectionHeaderSx, mb: 0 }}>
            Workstreams
          </Typography>
          {!isLocked && (
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={handleAddWorkstream}
            >
              Add Workstream
            </Button>
          )}
        </Stack>
        <Grid container spacing={2}>
          {activeWorkstreams.map(renderWorkstreamCard)}
        </Grid>
        {activeWorkstreams.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No workstreams defined yet.
          </Typography>
        )}
      </Box>

      {/* Feedback Section */}
      <Box sx={lockedSx}>
        <Typography variant="overline" sx={sectionHeaderSx}>
          Your Feedback
        </Typography>
        <TextField
          fullWidth
          multiline
          minRows={3}
          placeholder="Add any notes or revision requests for the plan..."
          value={normalizedValue.userMessage}
          onChange={(e) => handleUserMessageChange(e.target.value)}
          disabled={isLocked}
        />
      </Box>
    </Stack>
  );
};
