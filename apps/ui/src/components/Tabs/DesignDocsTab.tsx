import type { FilterConfig } from "@hey-hey/ui-common/components";
import { DesignDocList, EntityFilters } from "@hey-hey/ui-common/components";
import { useModalService } from "@hey-hey/ui-common/context";
import { useDesignDocs } from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";
import { DesignDocParentEntityType } from "@hey-hey/ui-common/api";
import AddIcon from "@mui/icons-material/Add";
import { Alert, Box, Button, Stack } from "@mui/material";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { CardHeader } from "../CardHeader";
import { TabContainer } from "./TabContainer";

interface DesignDocsTabProps {
  organizationId: string;
  projectId: string;
  taskId?: string;
  initiativeId?: string;
  planId?: string;
  designDocId?: string;
  designDocIds?: string[];
  emptyMessage?: string;
  enableFilters?: boolean;
}

/**
 * Shared tab component for displaying design documents.
 * Can be filtered by task, initiative, design document context, or show all project docs.
 */
export const DesignDocsTab: React.FC<DesignDocsTabProps> = ({
  organizationId,
  projectId,
  taskId,
  initiativeId,
  planId,
  designDocId,
  designDocIds,
  emptyMessage,
  enableFilters = false,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const modalService = useModalService();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("created-desc");
  const hasScopedDesignDocIds = Boolean(designDocIds?.length);

  const {
    designDocs = [],
    error: primaryError,
    isLoading: isPrimaryLoading,
  } = useDesignDocs(organizationId, {
    projectId,
    taskId: hasScopedDesignDocIds ? undefined : taskId,
    initiativeId: hasScopedDesignDocIds ? undefined : initiativeId,
    planId: hasScopedDesignDocIds ? undefined : planId,
    designDocId: hasScopedDesignDocIds ? undefined : designDocId,
    enabled: !!organizationId && !!projectId,
  });

  const {
    designDocs: directlyLinkedPlanDocs = [],
    error: planLinkError,
    isLoading: isPlanLinkLoading,
  } = useDesignDocs(organizationId, {
    projectId,
    planId,
    enabled:
      !!organizationId && !!projectId && !!planId && hasScopedDesignDocIds,
  });

  const isLoading = isPrimaryLoading || isPlanLinkLoading;
  const visibleDesignDocs = useMemo(() => {
    if (!hasScopedDesignDocIds || !designDocIds?.length) {
      return designDocs;
    }

    const allowedIds = new Set(designDocIds);
    const merged = new Map<string, (typeof designDocs)[number]>();

    for (const doc of designDocs) {
      if (allowedIds.has(doc.id)) {
        merged.set(doc.id, doc);
      }
    }

    for (const doc of directlyLinkedPlanDocs) {
      merged.set(doc.id, doc);
    }

    return Array.from(merged.values());
  }, [
    designDocIds,
    designDocs,
    directlyLinkedPlanDocs,
    hasScopedDesignDocIds,
  ]);

  const error = primaryError ?? planLinkError;

  const handleCreateDocument = useCallback((): void => {
    if (!modalService) {
      return;
    }

    const parentEntityId = taskId ?? designDocId;
    const parentEntityType = taskId
      ? DesignDocParentEntityType.Task
      : designDocId
        ? DesignDocParentEntityType.DesignDoc
        : undefined;

    modalService.showCreateDocument({
      mode: "blank_doc",
      projectId,
      parentEntityId,
      parentEntityType,
      onSuccess: (newDoc) => {
        const path = WebPathService.designDoc({
          projectId,
          designDocId: newDoc.id,
        });
        navigate(path);
      },
    });
  }, [designDocId, modalService, navigate, projectId, taskId]);

  const defaultEmptyMessage = taskId
    ? t("designDocs.emptyTask", "No design documents linked to this task")
    : planId
      ? t("designDocs.emptyPlan", "No design documents linked to this plan")
      : designDocId
        ? t(
            "designDocs.emptyDesignDoc",
            "No design documents linked to this document",
          )
        : t(
            "designDocs.emptyProject",
            "No design documents in this project yet.",
          );

  // Define filter configurations
  const filters: FilterConfig[] = [
    {
      type: "search",
      key: "search",
      label: t(
        "designDocs.filters.searchPlaceholder",
        "Search design documents...",
      ),
      placeholder: t(
        "designDocs.filters.searchPlaceholder",
        "Search design documents...",
      ),
    },
  ];

  // Define sort options
  const sortOptions = [
    {
      value: "created-desc",
      label: t("common.sortCreatedDesc", "Newest first"),
    },
    {
      value: "created-asc",
      label: t("common.sortCreatedAsc", "Oldest first"),
    },
    {
      value: "name-asc",
      label: t("common.sortNameAsc", "Name (A-Z)"),
    },
    {
      value: "name-desc",
      label: t("common.sortNameDesc", "Name (Z-A)"),
    },
  ];

  // Map filter values
  const filterValues = {
    search: searchTerm,
  };

  // Handle filter changes
  const handleFilterChange = (key: string, value: unknown): void => {
    if (key === "search") {
      setSearchTerm(value as string);
    }
  };

  return (
    <TabContainer>
      <Stack spacing={2}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <CardHeader title={t("designDocs.title", "Design Documents")} />
          {modalService && (taskId || planId || designDocId) && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleCreateDocument}
            >
              {t("documents.createDocument", "Create Document")}
            </Button>
          )}
        </Box>

        {enableFilters && (
          <EntityFilters
            filters={filters}
            values={filterValues}
            onChange={handleFilterChange}
            sortOptions={sortOptions}
            sortBy={sortBy}
            onSortChange={setSortBy}
            layout="row"
            spacing={2}
          />
        )}

        {error && (
          <Alert severity="error" data-testid="design-docs-tab-error">
            {error.message}
          </Alert>
        )}

        <DesignDocList
          designDocs={visibleDesignDocs}
          projectId={projectId}
          loading={isLoading}
          search={searchTerm}
          sortBy={sortBy}
          emptyMessage={emptyMessage || defaultEmptyMessage}
        />
      </Stack>
    </TabContainer>
  );
};
