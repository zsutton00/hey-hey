import { WebPathService } from "@hey-hey/ui-common/services";
import {
  CapsuleAction,
  ServiceDirectoryBindingControl,
} from "@hey-hey/ui-common/components";
import { TrackingProvider } from "@hey-hey/ui-common/context";
import {
  useProject,
  useService,
  useServiceLifecycle,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { compose, KEYS, TERMS } from "@hey-hey/ui-common/i18n";
import { dataClient } from "@hey-hey/ui-common/clients";
import {
  type CreateService201Response,
  type UpdateServiceDto,
} from "@hey-hey/ui-common/api";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditIcon from "@mui/icons-material/Edit";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { AnimatePresence, motion } from "motion/react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  DetailPageBody,
  DetailPageContainer,
  DetailPageHeader,
  DetailPageSidebar,
  DetailPageTabs,
  MetadataPanel,
  PageBreadcrumbs,
  type DetailPageTab,
  type MetadataItem,
} from "../../components/Layout";
import {
  AdminTab,
  buildAdminMetadataItems,
  ServiceFilesTab,
} from "../../components/Tabs";
import { ConversationListTab } from "../../components/Tabs/ConversationListTab";
import { AgentSessionsTab } from "../../components/Tabs/AgentSessionsTab";
import { DesignDocsTab } from "../../components/Tabs/DesignDocsTab";
import { ImplementationHintsTab } from "../../components/Tabs/ImplementationHintsTab";
import { TaskTab } from "../../components/Tabs/TaskTab";
import { NewTaskModal, type NewTaskFormData } from "../../components/Tasks";
import { tabTransitionVariants } from "../../utils/routeTransitions";
import { ServiceLifecycleControl } from "./ServiceLifecycleConfirmDialog";
import { ServiceSessionLaunchButton } from "./ServiceSessionLaunchButton";

export const ServicePage: React.FC = () => {
  const { projectId, serviceId } = useParams<{
    projectId: string;
    serviceId: string;
  }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { currentOrgId } = useUserIdentity() || {};
  const lifecycle = useServiceLifecycle(currentOrgId, projectId);

  // Tab state management – default to "hints" when hintId is in the URL
  const defaultTab = new URLSearchParams(window.location.search).has("hintId")
    ? ("hints" as const)
    : ("overview" as const);
  const [activeTab, setActiveTab] = useQueryState(
    "tab",
    parseAsStringLiteral([
      "overview",
      "tasks",
      "files",
      "hints",
      "documents",
      "sessions",
      "conversations",
      "admin",
    ] as const).withDefault(defaultTab),
  );

  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("tab") === "initiatives"
    ) {
      void setActiveTab("overview");
    }
  }, [setActiveTab]);

  // Modal state
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isContextualRailVisible, setIsContextualRailVisible] = useState(true);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  // Fetch service data
  const {
    data: serviceData,
    isLoading: isLoadingService,
    error: loadError,
    refetch: refetchService,
  } = useService(currentOrgId, serviceId, {
    enabled: !!serviceId && !!currentOrgId,
  });

  const { data: project } = useProject(currentOrgId || "", projectId || "", {
    enabled: !!currentOrgId && !!projectId,
    preferStale: true,
  });

  const handleBack = () => {
    navigate(`/projects/${projectId}/services`);
  };

  const handleOpenNewTaskModal = useCallback(() => {
    setIsNewTaskModalOpen(true);
  }, []);

  const handleCloseNewTaskModal = useCallback(() => {
    setIsNewTaskModalOpen(false);
  }, []);

  const handleSubmitNewTask = useCallback(
    async (formData: NewTaskFormData) => {
      try {
        // TODO: Implement task creation when backend is ready
        console.log("Create task for service:", serviceId, formData);
        setIsNewTaskModalOpen(false);
      } catch (error) {
        console.error("Failed to create service task:", error);
      }
    },
    [serviceId],
  );

  const handleEditDescription = useCallback(() => {
    setDescriptionError(null);
    setDescriptionDraft(serviceData?.description ?? "");
    setIsEditingDescription(true);
    setActiveTab("overview");
  }, [serviceData?.description, setActiveTab]);

  const handleCancelDescriptionEdit = useCallback(() => {
    setDescriptionError(null);
    setDescriptionDraft(serviceData?.description ?? "");
    setIsEditingDescription(false);
  }, [serviceData?.description]);

  const handleToggleContextualRail = useCallback(() => {
    setIsContextualRailVisible((previous) => !previous);
  }, []);

  const handleSaveDescription = useCallback(async () => {
    if (!currentOrgId || !serviceData?.id) {
      return;
    }

    setIsSavingDescription(true);
    setDescriptionError(null);

    try {
      const updatePayload: UpdateServiceDto = {
        description: descriptionDraft.trim(),
      };

      await dataClient.request<CreateService201Response>({
        method: "PATCH",
        url: `/organizations/${currentOrgId}/services/${serviceData.id}`,
        data: updatePayload,
      });

      await refetchService();
      setIsEditingDescription(false);
    } catch (error) {
      console.error("Failed to update service description:", error);
      setDescriptionError(
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message || "Failed to update service description",
      );
    } finally {
      setIsSavingDescription(false);
    }
  }, [currentOrgId, descriptionDraft, refetchService, serviceData?.id]);

  const conversationPathForId = useCallback(
    (conversationId: string) =>
      WebPathService.conversation({ projectId: projectId!, conversationId }),
    [projectId],
  );
  const hasDescriptionChanges = useMemo(
    () => descriptionDraft.trim() !== (serviceData?.description ?? "").trim(),
    [descriptionDraft, serviceData?.description],
  );

  useEffect(() => {
    if (!isEditingDescription) {
      setDescriptionDraft(serviceData?.description ?? "");
    }
  }, [isEditingDescription, serviceData?.description]);

  // Loading state
  if (isLoadingService) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "400px",
          p: 4,
          gap: 2,
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="h6" color="text.secondary">
          Loading service...
        </Typography>
      </Box>
    );
  }

  // Error state
  if (loadError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load service: {(loadError as Error).message}
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={handleBack}>
          Back to Services
        </Button>
      </Box>
    );
  }

  if (!serviceData) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Service not found
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={handleBack}>
          Back to Services
        </Button>
      </Box>
    );
  }

  // Prepare tabs data
  const tabs: DetailPageTab[] = [
    { value: "overview", label: "Overview" },
    { value: "tasks", label: TERMS.Tasks },
    { value: "files", label: "Files" },
    {
      value: "hints",
      label: `Implementation Hints${
        serviceData.childCounts?.implementationHints
          ? ` (${serviceData.childCounts.implementationHints})`
          : ""
      }`,
    },
    { value: "documents", label: "Documents" },
    { value: "sessions", label: "Agent Sessions" },
    { value: "conversations", label: "Conversations" },
    { value: "admin", label: "Admin" },
  ];

  // Prepare metadata
  const metadataItems: MetadataItem[] = [
    {
      label: "Status",
      value: <Chip label={serviceData.status} size="small" />,
    },
    {
      label: "Type",
      value: serviceData.serviceType || "N/A",
    },
    {
      label: "Created",
      value: new Date(serviceData.createdAt).toLocaleDateString(),
    },
    {
      label: "Updated",
      value: new Date(serviceData.updatedAt).toLocaleDateString(),
    },
  ];

  const adminMetadataItems = buildAdminMetadataItems({
    createdAt: serviceData.createdAt,
    updatedAt: serviceData.updatedAt,
    archivedAt: serviceData.archivedAt,
  });

  const localDirectorySection = (
    <ServiceDirectoryBindingControl
      serviceId={serviceData.id}
      serviceName={serviceData.name}
    />
  );

  return (
    <TrackingProvider
      context={{
        page: {
          name: "service",
          path: `/projects/${projectId}/services/${serviceData.id}`,
        },
        attentionEntity: {
          id: serviceData.id,
          type: "project",
        },
      }}
    >
      {activeTab === "overview" && !isEditingDescription && (
        <CapsuleAction
          id="edit-service-description"
          label="Edit"
          icon={EditIcon}
          actionGroup="page"
          tier="page"
          order={100}
          behavior="click"
          onClick={handleEditDescription}
          disabled={isLoadingService}
          iconStyle={{ backgroundColor: "#2563EB", color: "#fff" }}
        />
      )}
      <PageBreadcrumbs
        sx={{ mb: 2 }}
        items={[
          { label: "Projects", to: "/projects" },
          {
            label: project?.name ?? compose("{{term.Project}}"),
            to: `/projects/${projectId}`,
            type: project?.name ? "project" : undefined,
          },
          { label: "Services", to: `/projects/${projectId}/services` },
          {
            label: serviceData.name || "Service",
            isCurrent: true,
            type: "service",
          },
        ]}
      />

      <DetailPageContainer>
        <DetailPageHeader
          title={serviceData.name || "Untitled Service"}
          priorityChip={
            serviceData.status === "ARCHIVED" ? (
              <Chip
                label={t(KEYS.services.lifecycle.archivedBadge)}
                size="small"
                color="warning"
                data-testid="service-archived-badge"
              />
            ) : (
              <Chip label={serviceData.status} size="small" />
            )
          }
          metadata={`Updated ${new Date(
            serviceData.updatedAt,
          ).toLocaleDateString()}`}
          actions={
            <ServiceLifecycleControl
              service={serviceData}
              lifecycle={lifecycle}
              onDeleted={handleBack}
            />
          }
        />

        <DetailPageTabs value={activeTab} onChange={setActiveTab} tabs={tabs} />

        <AnimatePresence mode="wait">
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <motion.div
              key="overview"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <DetailPageBody
                contextualRail={
                  serviceData
                    ? {
                        id: `service-contextual-rail-${serviceData.id}`,
                        label: "Metadata",
                        expanded: isContextualRailVisible,
                        onToggle: handleToggleContextualRail,
                      }
                    : undefined
                }
                sidebar={
                  <DetailPageSidebar
                    navigation={null}
                    metadata={<MetadataPanel items={metadataItems} />}
                  />
                }
                content={
                  <Box>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Description
                    </Typography>
                    {isEditingDescription ? (
                      <>
                        <TextField
                          value={descriptionDraft}
                          onChange={(event) =>
                            setDescriptionDraft(event.target.value)
                          }
                          multiline
                          minRows={4}
                          maxRows={12}
                          fullWidth
                          placeholder="Describe what this service is responsible for..."
                        />
                        {descriptionError && (
                          <Alert severity="error" sx={{ mt: 2 }}>
                            {descriptionError}
                          </Alert>
                        )}
                        <Stack
                          direction="row"
                          spacing={1.5}
                          sx={{ mt: 2, mb: 3 }}
                        >
                          <Button
                            variant="contained"
                            onClick={handleSaveDescription}
                            disabled={
                              isSavingDescription || !hasDescriptionChanges
                            }
                          >
                            {isSavingDescription ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            variant="outlined"
                            onClick={handleCancelDescriptionEdit}
                            disabled={isSavingDescription}
                          >
                            Cancel
                          </Button>
                        </Stack>
                      </>
                    ) : (
                      <Typography
                        variant="body1"
                        color="text.secondary"
                        sx={{ mb: 3 }}
                      >
                        {serviceData.description || "No description provided"}
                      </Typography>
                    )}

                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Local directory
                    </Typography>
                    <Box sx={{ mb: 3 }}>{localDirectorySection}</Box>

                    {serviceData.repositoryUrl && (
                      <>
                        <Typography variant="h6" sx={{ mb: 2 }}>
                          Repository
                        </Typography>
                        <Typography
                          component="a"
                          href={serviceData.repositoryUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ color: "primary.main", textDecoration: "none" }}
                        >
                          {serviceData.repositoryUrl}
                        </Typography>
                      </>
                    )}
                  </Box>
                }
              />
            </motion.div>
          )}

          {/* Tasks Tab */}
          {activeTab === "tasks" && (
            <motion.div
              key="tasks"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <TaskTab
                projectId={projectId!}
                initiativeId="" // TODO: Link when service-task association ready
                initiativeName={serviceData.name}
                organizationId={currentOrgId!}
                tasks={[]}
                loading={false}
                hasGenerationAssistant={false}
                expandable={true}
                enableFilters={false}
                onNewTask={handleOpenNewTaskModal}
              />
            </motion.div>
          )}

          {activeTab === "files" && (
            <motion.div
              key="files"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ServiceFilesTab
                organizationId={currentOrgId!}
                projectId={projectId!}
                serviceId={serviceData.id}
                active={activeTab === "files"}
              />
            </motion.div>
          )}

          {activeTab === "admin" && (
            <motion.div
              key="admin"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <AdminTab metadataItems={adminMetadataItems} />
            </motion.div>
          )}

          {/* Implementation Hints Tab */}
          {activeTab === "hints" && (
            <motion.div
              key="hints"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ImplementationHintsTab
                organizationId={currentOrgId!}
                projectId={projectId!}
                serviceId={serviceData.id}
                enableFilters={true}
                enabled={activeTab === "hints"}
              />
            </motion.div>
          )}

          {/* Documents Tab */}
          {activeTab === "documents" && (
            <motion.div
              key="documents"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {/* TODO: Add initiativeId when service-to-initiative link is available in backend */}
              <DesignDocsTab
                organizationId={currentOrgId!}
                projectId={projectId!}
                enableFilters={true}
                emptyMessage="No design documents linked to this service yet."
              />
            </motion.div>
          )}

          {/* Agent Sessions Tab */}
          {activeTab === "sessions" && (
            <motion.div
              key="sessions"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {currentOrgId && projectId && (
                <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
                  <ServiceSessionLaunchButton
                    organizationId={currentOrgId}
                    projectId={projectId}
                    serviceId={serviceData.id}
                    serviceName={serviceData.name}
                  />
                </Stack>
              )}
              {/* TODO: Add initiativeId when service-to-initiative link is available in backend */}
              <AgentSessionsTab
                organizationId={currentOrgId!}
                projectId={projectId!}
                serviceId={serviceData.id}
                enableFilters={true}
                emptyMessage="No coding sessions for this service yet."
              />
            </motion.div>
          )}

          {/* Conversations Tab */}
          {activeTab === "conversations" && projectId && (
            <motion.div
              key="conversations"
              variants={tabTransitionVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ConversationListTab
                organizationId={currentOrgId ?? ""}
                projectId={projectId}
                entityName={serviceData.name}
                workflowAboutId={serviceData.id}
                workflowAboutType="service"
                conversationPathForId={conversationPathForId}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </DetailPageContainer>
      <NewTaskModal
        open={isNewTaskModalOpen}
        onClose={handleCloseNewTaskModal}
        onSubmit={handleSubmitNewTask}
        initiativeId=""
      />
    </TrackingProvider>
  );
};

ServicePage.displayName = "ServicePage";
