import { useModalState } from "../../Modals/useModalState";
import { ModalWorkOwner } from "../../Modals/ModalWorkOwner";
import {
  Alert,
  Box,
  FormControl,
  FormHelperText,
  FormLabel,
  Paper,
  Typography,
} from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { IntegrationResponseDto, IntegrationType } from "../../../api";
import { useIntegrationService } from "../../../hooks/useIntegrationService";
import { CreateIntegrationDialog } from "../../Integrations/components/CreateIntegrationDialog";
import { EditIntegrationDialog } from "../../Integrations/components/EditIntegrationDialog";
import {
  AVAILABLE_INTEGRATIONS,
  AvailableIntegrationCard,
  ConfiguredIntegrationsList,
  IntegrationSearch,
  type Integration,
} from "./Integration";
import { useApiIntegrationsAsForm } from "./Integration/hooks";
import type { FieldComponentProps } from "./types";

export const IntegrationsField: React.FC<FieldComponentProps> = ({
  config,
  onChange,
  error,
  disabled,
  isSubmitted,
}) => {
  const isDisabled = !!disabled;
  const { projectId } = useParams<{ projectId: string }>();
  const {
    integrations: apiIntegrations, // Provide default empty array
    loading: apiLoading = false,
    getAllIntegrations,
  } = useIntegrationService();

  // Debug logging
  console.log("useIntegrationService result:", {
    apiIntegrations,
    apiLoading,
    projectId,
  });

  // State for dialog management
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateDialog, setShowCreateDialog, showCreateDialogOwnerKey] =
    useModalState(false);
  const [showEditDialog, setShowEditDialog, showEditDialogOwnerKey] =
    useModalState(false);
  const [selectedIntegrationType, setSelectedIntegrationType] = useState<
    string | null
  >(null);
  const [editingApiIntegration, setEditingApiIntegration] =
    useState<IntegrationResponseDto | null>(null);

  // Load API integrations when component mounts (only if we have a projectId)
  useEffect(() => {
    if (projectId && getAllIntegrations) {
      getAllIntegrations(projectId).catch((error) => {
        console.error(
          "Failed to load integrations in IntegrationsField:",
          error,
        );
      });
    }
  }, [projectId, getAllIntegrations]);

  // Convert API integrations to form format for display
  const allIntegrations: Integration[] =
    useApiIntegrationsAsForm(apiIntegrations);

  // Filter available integrations based on search term
  const filteredAvailableIntegrations = useMemo(() => {
    return AVAILABLE_INTEGRATIONS.filter(
      (integration) =>
        integration.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        integration.description
          .toLowerCase()
          .includes(searchTerm.toLowerCase()),
    );
  }, [searchTerm]);

  // Get integrations that are not yet configured
  const availableToAdd = useMemo(() => {
    const configuredTypes = new Set(allIntegrations.map((i) => i.type));
    return filteredAvailableIntegrations.filter(
      (integration) => !configuredTypes.has(integration.type),
    );
  }, [filteredAvailableIntegrations, allIntegrations]);

  useEffect(() => {
    onChange?.(JSON.stringify(allIntegrations));
  }, [allIntegrations]);

  const handleAddIntegration = (type: string) => {
    if (isDisabled) {
      return;
    }
    // Use new API dialog for supported integrations
    if ((type === "github" || type === "jira") && projectId) {
      setSelectedIntegrationType(type);
      setShowCreateDialog(true);
    }
  };

  const handleEditIntegration = (integration: Integration) => {
    if (isDisabled) {
      return;
    }
    // Check if this is an API integration
    const apiIntegration = apiIntegrations.find(
      (api) => api.id === integration.id,
    );
    if (apiIntegration && projectId) {
      setEditingApiIntegration(apiIntegration);
      setShowEditDialog(true);
    }
  };

  const handleDeleteIntegration = (integrationId: string) => {
    if (isDisabled) {
      return;
    }
    // Check if this is an API integration
    const isApiIntegration = apiIntegrations.some(
      (api) => api.id === integrationId,
    );

    if (isApiIntegration) {
      // For API integrations, we would need a delete function from the service
      // For now, just refresh the list
      if (projectId) {
        getAllIntegrations(projectId);
      }
    }
  };

  const handleCloseCreateDialog = () => {
    setShowCreateDialog(false);
    setSelectedIntegrationType(null);
  };

  const handleCloseEditDialog = () => {
    setShowEditDialog(false);
    setEditingApiIntegration(null);
  };

  const handleCreateSuccess = () => {
    setShowCreateDialog(false);
    setSelectedIntegrationType(null);
    // Refresh API integrations
    if (projectId) {
      getAllIntegrations(projectId);
    }
  };

  const handleEditSuccess = () => {
    setShowEditDialog(false);
    setEditingApiIntegration(null);
    // Refresh API integrations
    if (projectId) {
      getAllIntegrations(projectId);
    }
  };

  return (
    <Paper
      elevation={1}
      sx={{
        p: 2,
        maxWidth: "80%",
        borderRadius: 2,
        position: "relative",
      }}
    >
      <FormControl
        data-testid={`integrations-field-${config.field}`}
        fullWidth
        margin="normal"
        error={!!error}
        disabled={isDisabled}
        sx={{
          "& .MuiFormControl-root": {
            backgroundColor: "transparent",
          },
          "&:focus-within": {
            backgroundColor: "transparent",
          },
          "&:hover": {
            backgroundColor: "transparent",
          },
          backgroundColor: "transparent",
        }}
      >
        <FormLabel component="legend">
          {isSubmitted && !disabled ? "" : config.description}
        </FormLabel>

        <Box sx={{ mt: 2 }}>
          {/* Loading state (only show if we have projectId) */}
          {projectId && apiLoading && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Loading integrations...
            </Alert>
          )}

          {/* Search */}
          <Box data-testid="integrations-field-search" sx={{ mb: 2 }}>
            <IntegrationSearch
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              disabled={isDisabled}
            />
          </Box>

          {/* Existing Integrations */}
          <div data-testid="integrations-field-configured-list">
            <ConfiguredIntegrationsList
              integrations={allIntegrations}
              onEdit={handleEditIntegration}
              onDelete={handleDeleteIntegration}
              disabled={isDisabled}
            />
          </div>

          {/* Add New Integration */}
          {availableToAdd.length > 0 && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Add New Integration
              </Typography>

              {/* Available Integrations */}
              <Box
                data-testid="integrations-field-available-grid"
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr", // 1 column on extra small screens
                    sm: "repeat(2, 1fr)", // 2 columns on small screens
                    md: "repeat(3, 1fr)", // 3 columns on medium screens
                    lg: "repeat(4, 1fr)", // 4 columns on large screens
                  },
                  gap: 2,
                  mt: 2,
                }}
              >
                {availableToAdd.map((integration) => (
                  <AvailableIntegrationCard
                    key={integration.type}
                    integration={integration}
                    onAdd={handleAddIntegration}
                    disabled={isDisabled}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* No integrations available */}
          {availableToAdd.length === 0 &&
            allIntegrations.length === 0 &&
            (!projectId || !apiLoading) && (
              <Alert severity="info">
                No integrations available at this time.
              </Alert>
            )}

          {/* All integrations configured */}
          {availableToAdd.length === 0 && allIntegrations.length > 0 && (
            <Alert severity="success">
              All available integrations have been configured.
            </Alert>
          )}
        </Box>

        {error && <FormHelperText>{error}</FormHelperText>}

        {/* API-driven Integration Create Dialog */}
        {projectId && selectedIntegrationType && (
          <ModalWorkOwner.Provider value={showCreateDialogOwnerKey}>
            <CreateIntegrationDialog
              open={showCreateDialog}
              onClose={handleCloseCreateDialog}
              onSuccess={handleCreateSuccess}
              projectId={projectId}
              selectedType={
                selectedIntegrationType.toUpperCase() as IntegrationType
              }
            />
          </ModalWorkOwner.Provider>
        )}

        {/* API-driven GitHub Edit Dialog */}
        {projectId && editingApiIntegration && (
          <ModalWorkOwner.Provider value={showEditDialogOwnerKey}>
            <EditIntegrationDialog
              open={showEditDialog}
              onClose={handleCloseEditDialog}
              onSuccess={handleEditSuccess}
              integration={editingApiIntegration}
            />
          </ModalWorkOwner.Provider>
        )}
      </FormControl>
    </Paper>
  );
};
