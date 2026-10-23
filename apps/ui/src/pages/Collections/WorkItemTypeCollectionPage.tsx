import React from "react";
import { Alert, Box, CircularProgress } from "@mui/material";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { WorkItemTypeLifecycleStatus } from "@hey-hey/ui-common/api";
import { EntityCollectionPage } from "@hey-hey/ui-common/components";
import { useProject, useWorkItemTypeByKey } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import {
  DetailPageContainer,
  DetailPageHeader,
  PageBreadcrumbs,
} from "../../components/Layout";
import { usePreviewPresentation } from "../../contexts/PreviewPresentationContext";
import { getWorkItemTypePluralDisplayName } from "../../types/workItemTypes";
import NotFound from "../NotFound";

export interface WorkItemTypeCollectionPageProps {
  organizationId?: string;
  projectId?: string;
  typeKey?: string;
  preview?: boolean;
}

/**
 * Full collection for any registry-defined work-item type. Every type
 * behaviour comes from the resolved definition, so no type is special-cased
 * and nothing type-specific renders while the definition is unavailable.
 */
export const WorkItemTypeCollectionPage: React.FC<
  WorkItemTypeCollectionPageProps
> = ({
  organizationId,
  projectId: projectIdProp,
  typeKey: typeKeyProp,
  preview = false,
}) => {
  const { t } = useTranslation();
  const { projectId: routeProjectId, typeKey: routeTypeKey } = useParams<{
    projectId: string;
    typeKey: string;
  }>();
  const { currentOrgId } = useUserIdentity() || {};
  const projectId = projectIdProp ?? routeProjectId;
  const typeKey = typeKeyProp ?? routeTypeKey;
  const resolvedOrganizationId = organizationId ?? currentOrgId;
  const isPreviewPresentation = usePreviewPresentation();

  const { data: project } = useProject(
    resolvedOrganizationId ?? "",
    projectId ?? "",
    { enabled: !!resolvedOrganizationId && !!projectId },
  );
  const {
    workItemTypeSummary,
    workItemTypeDefinition: definition,
    isReady,
    error,
  } = useWorkItemTypeByKey(resolvedOrganizationId, projectId, typeKey);

  // The registry answers an unknown key with a 404, which is not-found rather
  // than a failed load.
  const isUnknownType =
    axios.isAxiosError(error) && error.response?.status === 404;

  if (error && !isUnknownType) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {error.message}
      </Alert>
    );
  }

  if (!isUnknownType && !isReady) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        py={4}
        data-testid="work-item-type-collection-loading"
      >
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (
    isUnknownType ||
    !definition ||
    workItemTypeSummary?.status !== WorkItemTypeLifecycleStatus.Active
  ) {
    return <NotFound />;
  }

  const title = getWorkItemTypePluralDisplayName(definition) ?? definition.name;

  return (
    <>
      {!preview && (
        <PageBreadcrumbs
          sx={{ mb: 2 }}
          items={[
            { label: "Projects", to: "/projects" },
            {
              label: project?.name ?? "Project",
              to: `/projects/${projectId}`,
              type: "project",
            },
            {
              label: title,
              to: `/projects/${projectId}/collections/${definition.key}`,
              isCurrent: true,
            },
          ]}
        />
      )}

      <DetailPageContainer>
        {!isPreviewPresentation && <DetailPageHeader title={title} />}
        <EntityCollectionPage
          organizationId={resolvedOrganizationId ?? ""}
          projectId={projectId ?? ""}
          typeDefinition={definition}
          emptyMessage={t("collections.empty", {
            defaultValue: "No {{type}} yet.",
            type: title.toLowerCase(),
          })}
          searchPlaceholder={t("collections.search", {
            defaultValue: "Search {{type}}",
            type: title.toLowerCase(),
          })}
        />
      </DetailPageContainer>
    </>
  );
};
