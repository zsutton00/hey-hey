import React from "react";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import type { EntityPreviewProps } from "./types";
import { normalizeEntity } from "./utils";
import { EntityViewerLoader } from "../../EntityViewer";
import { EntityType } from "../../../api";

const entityTypeMap = new Map(
  Object.values(EntityType).map((value) => [value.toLowerCase(), value])
);

export const EntityPreview: React.FC<EntityPreviewProps> = ({
  entity,
  organizationId,
  projectId,
  onClose,
  secondaryAction,
  additionalActions = [],
  showCloseButton = true,
  headerContent,
}) => {
  const normalized = normalizeEntity(entity);
  const resolvedEntityType = entityTypeMap.get(normalized.type.toLowerCase());

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {headerContent && (
        <Paper
          sx={{
            p: 2,
            borderRadius: 0,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          {headerContent}
        </Paper>
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
        {resolvedEntityType ? (
          <EntityViewerLoader
            source="lookup"
            entityType={resolvedEntityType}
            entityId={normalized.id}
            organizationId={organizationId}
            projectId={projectId}
          />
        ) : (
          <Typography color="text.secondary">
            Unsupported entity type.
          </Typography>
        )}
      </Box>

      <Paper
        sx={{
          p: 2,
          borderRadius: 0,
          borderTop: 1,
          borderColor: "divider",
        }}
      >
        <Stack direction="row" spacing={2} justifyContent="flex-start">
          {showCloseButton && (
            <Button
              data-testid="entity-preview-close-button"
              startIcon={<ArrowBackIcon />}
              onClick={onClose}
              variant="outlined"
            >
              Return
            </Button>
          )}

          {secondaryAction && (
            <Button
              data-testid={
                secondaryAction.testId || "entity-preview-secondary-action"
              }
              variant={secondaryAction.variant || "contained"}
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
            >
              {secondaryAction.label}
            </Button>
          )}

          {additionalActions.map((action, idx) => (
            <Button
              key={idx}
              data-testid={action.testId}
              variant={action.variant || "outlined"}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </Button>
          ))}
        </Stack>
      </Paper>
    </Box>
  );
};
