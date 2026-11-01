import {
  useModalState,
  ModalWorkOwner,
} from "@hey-hey/ui-common/components/Modals";
import { useRepositoryImportEntry } from "./useRepositoryImportEntry";
import { RepositoryImportEntryDialog } from "./RepositoryImportEntryDialog";
import { ServicesList } from "@hey-hey/ui-common/components";
import { useProject, useServices } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { compose, KEYS } from "@hey-hey/ui-common/i18n";
import AddIcon from "@mui/icons-material/Add";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
  Tab,
  Tabs,
} from "@mui/material";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { type ServiceDto } from "@hey-hey/ui-common/api";
import { CreateServiceModal } from "../../components/CreateServiceModal";
import { PageBreadcrumbs } from "../../components/Layout";
import { usePreviewPresentation } from "../../contexts/PreviewPresentationContext";
import { RepositoryImportConversations } from "./RepositoryImportConversations";

const SERVICES_PAGE_TABS = ["services", "archived", "importing"] as const;
type ServicesPageTab = (typeof SERVICES_PAGE_TABS)[number];

export interface ServicesPageProps {
  organizationId?: string;
  projectId?: string;
  preview?: boolean;
}

export const ServicesPage: React.FC<ServicesPageProps> = ({
  organizationId,
  projectId: projectIdProp,
  preview = false,
}) => {
  const { t } = useTranslation();
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const { currentOrgId } = useUserIdentity() || {};
  const projectId = projectIdProp ?? routeProjectId;
  const resolvedOrganizationId = organizationId ?? currentOrgId;
  const navigate = useNavigate();
  const isPreviewPresentation = usePreviewPresentation();

  const { services, isLoading, error } = useServices(resolvedOrganizationId, {
    projectId,
    enabled: !!resolvedOrganizationId && !!projectId,
  });

  const { data: project } = useProject(
    resolvedOrganizationId || "",
    projectId || "",
    {
      enabled: !!resolvedOrganizationId && !!projectId,
      preferStale: true,
    },
  );

  const [selectedTab, setSelectedTab] = useQueryState(
    "tab",
    parseAsStringLiteral(SERVICES_PAGE_TABS).withDefault("services"),
  );

  // Archived Services stay reachable for historical reading; active pickers keep
  // the default list, which excludes them.
  const {
    services: archivedServices,
    isLoading: isLoadingArchived,
    error: archivedError,
  } = useServices(resolvedOrganizationId, {
    projectId,
    status: "ARCHIVED",
    enabled:
      !!resolvedOrganizationId && !!projectId && selectedTab === "archived",
  });

  const entry = useRepositoryImportEntry(resolvedOrganizationId, projectId);
  const [showCreateModal, setShowCreateModal, showCreateModalOwnerKey] =
    useModalState(false);
  const handleServiceClick = (service: ServiceDto) => {
    navigate(`/projects/${projectId}/services/${service.id}`);
  };

  if (isLoading && !services?.length) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "40vh",
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography variant="body1" color="text.secondary">
          {t("common.loading")}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }} data-testid="services">
      {/* Breadcrumbs */}
      {!preview && (
        <PageBreadcrumbs
          sx={{ mb: 3 }}
          items={[
            { label: "Projects", to: "/projects" },
            {
              label: project?.name ?? compose("{{term.Project}}"),
              to: `/projects/${projectId}`,
              type: project?.name ? "project" : undefined,
            },
            { label: "Services", isCurrent: true },
          ]}
        />
      )}

      {/* Page Header */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 3 }}
      >
        {!isPreviewPresentation && (
          <Typography variant="h4">Services</Typography>
        )}
        <Box sx={{ display: "flex", gap: 1 }}>
          {!isPreviewPresentation && (
            <>
              <Button
                variant="outlined"
                onClick={entry.action.execute}
                disabled={entry.action.status !== "ready"}
              >
                {entry.action.status === "pending"
                  ? "Opening Import..."
                  : "Import existing work"}
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setShowCreateModal(true)}
              >
                Create Service
              </Button>
            </>
          )}
        </Box>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error instanceof Error ? error.message : "Failed to load services"}
        </Alert>
      )}

      {selectedTab === "archived" && archivedError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {archivedError instanceof Error
            ? archivedError.message
            : "Failed to load services"}
        </Alert>
      )}

      {entry.action.error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={<Button onClick={entry.action.retry}>Retry</Button>}
        >
          {entry.action.error}
        </Alert>
      )}

      <Tabs
        value={selectedTab}
        onChange={(_event, value: ServicesPageTab) =>
          void setSelectedTab(value)
        }
        sx={{ mb: 2 }}
      >
        <Tab value="services" label="Services" />
        <Tab
          value="archived"
          label={t(KEYS.services.lifecycle.archivedTab)}
          data-testid="services-archived-tab"
        />
        <Tab value="importing" label="Imports" />
      </Tabs>

      {selectedTab === "services" ? (
        <ServicesList
          services={services || []}
          organizationId={resolvedOrganizationId || ""}
          projectId={projectId}
          isLoading={isLoading}
          emptyMessage="No services found"
          onServiceClick={handleServiceClick}
        />
      ) : selectedTab === "archived" ? (
        <ServicesList
          services={archivedServices || []}
          organizationId={resolvedOrganizationId || ""}
          projectId={projectId}
          isLoading={isLoadingArchived}
          emptyMessage={t(KEYS.services.lifecycle.archivedEmpty)}
          onServiceClick={handleServiceClick}
        />
      ) : (
        <RepositoryImportConversations
          organizationId={resolvedOrganizationId || ""}
          projectId={projectId || ""}
          onOpen={entry.openImport}
        />
      )}

      <RepositoryImportEntryDialog entry={entry} />

      {/* Create Service Modal */}
      <ModalWorkOwner.Provider value={showCreateModalOwnerKey}>
        <CreateServiceModal
          open={showCreateModal}
          organizationId={resolvedOrganizationId || ""}
          onClose={() => setShowCreateModal(false)}
          projectId={projectId!}
        />
      </ModalWorkOwner.Provider>
    </Box>
  );
};
