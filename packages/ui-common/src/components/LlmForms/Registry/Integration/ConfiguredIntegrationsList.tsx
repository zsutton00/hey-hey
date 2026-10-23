import React from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Chip,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { AVAILABLE_INTEGRATIONS } from "./integrationRegistry";
import type { ConfiguredIntegrationsListProps } from "./types";

export const ConfiguredIntegrationsList: React.FC<
  ConfiguredIntegrationsListProps
> = ({ integrations, onEdit, onDelete, disabled = false }) => {
  console.log(
    "ConfiguredIntegrationsList received integrations:",
    integrations
  );

  if (integrations.length === 0) {
    console.log("ConfiguredIntegrationsList: No integrations to display");
    return null;
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        Existing Integrations
      </Typography>
      <List>
        {integrations.map((integration) => {
          const integrationDef = AVAILABLE_INTEGRATIONS.find(
            (i) => i.type === integration.type
          );

          return (
            <ListItem key={integration.id} divider>
              <Box sx={{ display: "flex", alignItems: "center", mr: 2 }}>
                {integrationDef?.icon}
              </Box>
              <ListItemText
                primary={integration.name}
                secondary={
                  <Box component="span">
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      component="span"
                      display="block"
                    >
                      Configured on{" "}
                      {new Date(integration.createdAt).toLocaleDateString()}
                    </Typography>
                    <Chip
                      label={integration.isConfigured ? "Active" : "Inactive"}
                      color={integration.isConfigured ? "success" : "warning"}
                      size="small"
                      sx={{ mt: 1 }}
                    />
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                <IconButton
                  edge="end"
                  onClick={() => onEdit(integration)}
                  disabled={disabled}
                  sx={{ mr: 1 }}
                >
                  <EditIcon />
                </IconButton>
                <IconButton
                  edge="end"
                  onClick={() => onDelete(integration.id)}
                  disabled={disabled}
                  color="error"
                >
                  <DeleteIcon />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
};
