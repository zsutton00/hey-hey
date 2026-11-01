import {
  useModalState,
  ModalWorkOwner,
} from "@hey-hey/ui-common/components/Modals";
import React, { useState } from "react";
import {
  Box,
  Typography,
  Stack,
  Chip,
  LinearProgress,
  Alert,
  Button,
  CircularProgress,
  Card,
  CardContent,
  Grid,
} from "@mui/material";
import GitHubIcon from "@mui/icons-material/GitHub";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import ScheduleIcon from "@mui/icons-material/Schedule";
import DisconnectedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { TabContainer } from "./TabContainer";
import { CardHeader } from "../CardHeader";
import type {
  IntegrationResponseDto,
  IntegrationConnectionStatus,
  IntegrationType,
} from "@hey-hey/ui-common/api";
import { useIntegrations } from "@hey-hey/ui-common/data";
import { CreateIntegrationDialog } from "../../pages/Integrations/components/CreateIntegrationDialog";
import { EditIntegrationDialog } from "../../pages/Integrations/components/EditIntegrationDialog";

interface IntegrationsData {
  integrations: IntegrationResponseDto[];
  totalCount: number;
  connectedCount: number;
  errorCount: number;
  syncInProgress: boolean;
}

export interface IntegrationsTabProps {
  organizationId: string;
  projectId: string;
}

export const IntegrationsTab: React.FC<IntegrationsTabProps> = ({
  organizationId,
  projectId,
}) => {
  // Dialog state management
  const [
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    isCreateDialogOpenOwnerKey,
  ] = useModalState(false);
  const [isEditDialogOpen, setIsEditDialogOpen, isEditDialogOpenOwnerKey] =
    useModalState(false);
  const [selectedIntegration, setSelectedIntegration] =
    useState<IntegrationResponseDto | null>(null);
  const [selectedType, setSelectedType] = useState<IntegrationType>("GITHUB");

  // Use real integrations hook
  const {
    data: integrations,
    isLoading,
    error,
    refetch,
  } = useIntegrations(organizationId, projectId);

  // Transform integrations data
  const integrationsData = React.useMemo((): IntegrationsData => {
    if (!integrations?.length) {
      return {
        integrations: [],
        totalCount: 0,
        connectedCount: 0,
        errorCount: 0,
        syncInProgress: isLoading,
      };
    }

    const connectedCount = integrations.filter(
      (integration) => integration.connectionStatus === "CONNECTED",
    ).length;
    const errorCount = integrations.filter(
      (integration) => integration.connectionStatus === "ERROR",
    ).length;

    return {
      integrations,
      totalCount: integrations.length,
      connectedCount,
      errorCount,
      syncInProgress: isLoading,
    };
  }, [integrations, isLoading]);

  const getStatusColor = (status: IntegrationConnectionStatus) => {
    switch (status) {
      case "CONNECTED":
        return "success";
      case "ERROR":
        return "error";
      case "PENDING":
      case "CONFIGURING":
        return "warning";
      case "DISCONNECTED":
      default:
        return "default";
    }
  };

  const getStatusIcon = (status: IntegrationConnectionStatus) => {
    switch (status) {
      case "CONNECTED":
        return <CheckCircleIcon sx={{ color: "success.main" }} />;
      case "ERROR":
        return <ErrorIcon sx={{ color: "error.main" }} />;
      case "PENDING":
      case "CONFIGURING":
        return <ScheduleIcon sx={{ color: "warning.main" }} />;
      case "DISCONNECTED":
      default:
        return <DisconnectedIcon sx={{ color: "text.disabled" }} />;
    }
  };

  const handleAddIntegration = (type: IntegrationType) => {
    setSelectedType(type);
    setIsCreateDialogOpen(true);
  };

  const handleViewIntegration = (integration: IntegrationResponseDto) => {
    setSelectedIntegration(integration);
    setIsEditDialogOpen(true);
  };

  // Define available integration types
  const AVAILABLE_INTEGRATIONS = [
    {
      type: "GITHUB" as IntegrationType,
      name: "GitHub",
      icon: <GitHubIcon sx={{ fontSize: 32 }} />,
      description:
        "Connect your GitHub repositories to track commits, pull requests, issues, and code reviews.",
    },
    // Future integrations can be added here
  ];

  const renderConnectionHealth = () => {
    if (!integrationsData) return null;

    const healthPercentage =
      integrationsData.totalCount > 0
        ? (integrationsData.connectedCount / integrationsData.totalCount) * 100
        : 0;

    const getHealthColor = () => {
      if (healthPercentage >= 80) return "success";
      if (healthPercentage >= 60) return "warning";
      return "error";
    };

    return (
      <Box mb={2}>
        <Stack direction="row" spacing={2} alignItems="center" mb={2}>
          <Box flex={1}>
            <Typography variant="body2" gutterBottom>
              Connection Health
            </Typography>
            <LinearProgress
              variant="determinate"
              value={healthPercentage}
              color={getHealthColor()}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {Math.round(healthPercentage)}%
          </Typography>
        </Stack>

        {integrationsData.errorCount > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {integrationsData.errorCount} integration
            {integrationsData.errorCount > 1 ? "s" : ""} need attention
          </Alert>
        )}

        <Stack
          direction="row"
          spacing={2}
          justifyContent="space-between"
          alignItems="center"
        >
          <Stack direction="row" spacing={2}>
            <Box textAlign="center">
              <Typography variant="h6" color="primary">
                {integrationsData.totalCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Total
              </Typography>
            </Box>
            <Box textAlign="center">
              <Typography variant="h6" color="success.main">
                {integrationsData.connectedCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Active
              </Typography>
            </Box>
            <Box textAlign="center">
              <Typography variant="h6" color="error.main">
                {integrationsData.errorCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Issues
              </Typography>
            </Box>
          </Stack>
          <Button
            variant="contained"
            color="actionable"
            onClick={() => handleAddIntegration("GITHUB")}
            size="small"
          >
            Add Integration
          </Button>
        </Stack>
      </Box>
    );
  };

  const renderIntegrationsList = () => {
    // Show loading state
    if (isLoading) {
      return (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          minHeight={120}
          textAlign="center"
        >
          <CircularProgress size={48} sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary">
            Loading integrations...
          </Typography>
        </Box>
      );
    }

    // Show error state
    if (error) {
      return (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="body2">
            Failed to load integrations.
            <Button
              variant="text"
              size="small"
              onClick={() => refetch()}
              sx={{ ml: 1 }}
            >
              Try again
            </Button>
          </Typography>
        </Alert>
      );
    }

    // Render each available integration type
    return (
      <Grid container spacing={2}>
        {AVAILABLE_INTEGRATIONS.map((availableIntegration) => {
          // Check if this integration type is already connected
          const connectedIntegration = integrationsData?.integrations?.find(
            (integration) => integration.type === availableIntegration.type,
          );

          return (
            <Grid key={availableIntegration.type} size={{ xs: 12, md: 6 }}>
              <Card>
                <CardContent>
                  <Stack spacing={2}>
                    <Box display="flex" alignItems="center" gap={1}>
                      {availableIntegration.icon}
                      <Typography variant="h6">
                        {availableIntegration.name}
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {availableIntegration.description}
                    </Typography>

                    {connectedIntegration ? (
                      // Show connected status
                      <Box>
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          mb={1}
                        >
                          {getStatusIcon(connectedIntegration.connectionStatus)}
                          <Chip
                            label={connectedIntegration.connectionStatus}
                            color={getStatusColor(
                              connectedIntegration.connectionStatus,
                            )}
                            size="small"
                            variant="outlined"
                          />
                        </Stack>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mb: 2 }}
                        >
                          {connectedIntegration.name}
                        </Typography>
                        <Button
                          variant="outlined"
                          color="primary"
                          onClick={() =>
                            handleViewIntegration(connectedIntegration)
                          }
                          fullWidth
                        >
                          View / Manage
                        </Button>
                      </Box>
                    ) : (
                      // Show add button
                      <Button
                        variant="contained"
                        color="actionable"
                        onClick={() =>
                          handleAddIntegration(availableIntegration.type)
                        }
                        fullWidth
                      >
                        Add {availableIntegration.name} Integration
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    );
  };

  return (
    <TabContainer>
      <Stack spacing={3}>
        {/* Header */}
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <CardHeader title="Integrations" />
        </Box>

        {/* Connection Health (shows when integrations exist) */}
        {integrationsData?.integrations?.length > 0 && renderConnectionHealth()}

        {/* Integrations List */}
        {renderIntegrationsList()}
      </Stack>

      {/* Dialogs */}
      <ModalWorkOwner.Provider value={isCreateDialogOpenOwnerKey}>
        <CreateIntegrationDialog
          open={isCreateDialogOpen}
          onClose={() => setIsCreateDialogOpen(false)}
          onSuccess={() => {
            refetch();
            setIsCreateDialogOpen(false);
          }}
          projectId={projectId}
          selectedType={selectedType}
        />
      </ModalWorkOwner.Provider>
      {selectedIntegration && (
        <ModalWorkOwner.Provider value={isEditDialogOpenOwnerKey}>
          <EditIntegrationDialog
            open={isEditDialogOpen}
            onClose={() => setIsEditDialogOpen(false)}
            onSuccess={() => {
              refetch();
              setIsEditDialogOpen(false);
            }}
            integration={selectedIntegration}
          />
        </ModalWorkOwner.Provider>
      )}
    </TabContainer>
  );
};
