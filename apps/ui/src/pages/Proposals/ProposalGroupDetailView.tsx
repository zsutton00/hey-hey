import { ProposalGroupReview } from "@hey-hey/ui-common/components";
import { TrackingProvider } from "@hey-hey/ui-common/context";
import { useProject } from "@hey-hey/ui-common/data";
import { compose } from "@hey-hey/ui-common/i18n";
import { WebPathService } from "@hey-hey/ui-common/services";
import React from "react";
import {
  DetailPageBody,
  DetailPageContainer,
  PageBreadcrumbs,
} from "../../components/Layout";

export interface ProposalGroupDetailViewProps {
  organizationId: string;
  projectId: string;
  groupId: string;
}

export const ProposalGroupDetailView: React.FC<
  ProposalGroupDetailViewProps
> = ({ organizationId, projectId, groupId }) => {
  const { data: project } = useProject(organizationId, projectId, {
    enabled: !!organizationId && !!projectId,
    preferStale: true,
  });

  return (
    <TrackingProvider
      context={{
        page: {
          name: "proposal-group",
          path: WebPathService.proposalGroup({ projectId, groupId }),
        },
      }}
    >
      <PageBreadcrumbs
        sx={{ mb: 2 }}
        items={[
          { label: "Projects", to: "/projects" },
          {
            label: project?.name ?? compose("{{term.Project}}"),
            to: `/projects/${projectId}`,
            type: project?.name ? "project" : undefined,
          },
          {
            label: "Proposals",
            to: `/projects/${projectId}/proposals`,
            type: "proposal",
          },
          { label: "Group", isCurrent: true },
        ]}
      />
      <DetailPageContainer>
        <DetailPageBody
          sidebar={null}
          content={
            <ProposalGroupReview
              organizationId={organizationId}
              projectId={projectId}
              groupId={groupId}
            />
          }
        />
      </DetailPageContainer>
    </TrackingProvider>
  );
};
