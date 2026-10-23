import React from "react";
import { useParams } from "react-router-dom";
import {
  ConversationPanelLayout,
  ScratchpadConversationPanel,
  ScratchpadPage,
  useConversationPanel,
  useScratchpad,
} from "@hey-hey/ui-common/components";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { TrackingProvider } from "@hey-hey/ui-common/context";
import { useProject } from "@hey-hey/ui-common/data";
import { compose } from "@hey-hey/ui-common/i18n";
import {
  DetailPageContainer,
  PageBreadcrumbs,
} from "../../components/Layout";

export const ScratchpadDetailPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";
  const { items } = useScratchpad();
  const { isExpanded } = useConversationPanel();

  const { data: project } = useProject(organizationId, projectId ?? "", {
    enabled: !!organizationId && !!projectId,
    preferStale: true,
  });

  return (
    <TrackingProvider
      context={{
        page: {
          name: "scratchpad",
          path: `/projects/${projectId}/scratchpad`,
          section: "scratchpad",
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
          { label: "Scratchpad", isCurrent: true },
        ]}
      />
      <DetailPageContainer>
        {items.length === 0 ? (
          <ScratchpadPage />
        ) : (
          <ConversationPanelLayout
            isExpanded={isExpanded}
            enableSticky={false}
            leftContent={<ScratchpadPage />}
            rightContent={<ScratchpadConversationPanel items={items} />}
          />
        )}
      </DetailPageContainer>
    </TrackingProvider>
  );
};
