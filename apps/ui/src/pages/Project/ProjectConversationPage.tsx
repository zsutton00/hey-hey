import React, { useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useProject } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { createCanonicalPageDescriptor } from "@hey-hey/ui-common/context";
import { compose } from "@hey-hey/ui-common/i18n";
import { PageBreadcrumbs } from "../../components/Layout";
import { ConversationView } from "../Conversation";

export const ProjectConversationPage: React.FC = () => {
  const { projectId, conversationId } = useParams<{
    projectId: string;
    conversationId: string;
  }>();
  const { currentOrgId } = useUserIdentity() || {};
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { data: project } = useProject(currentOrgId || "", projectId || "", {
    enabled: !!currentOrgId && !!projectId,
    preferStale: true,
  });

  const conversationView = searchParams.get("conversationView");
  const backPath = `/projects/${projectId}?tab=project&view=conversations${
    conversationView ? `&conversationView=${conversationView}` : ""
  }`;

  const handleBack = useCallback(() => {
    navigate(backPath);
  }, [backPath, navigate]);

  return (
    <ConversationView
      organizationId={currentOrgId}
      projectId={projectId}
      conversationId={conversationId}
      canonicalPageComposition={
        conversationId
          ? {
              kind: "canonical",
              descriptor: createCanonicalPageDescriptor(
                "conversation",
                conversationId,
                null,
              ),
            }
          : { kind: "observational" }
      }
      onBack={handleBack}
      breadcrumbs={
        <PageBreadcrumbs
          sx={{ mb: 2 }}
          items={[
            { label: compose("{{term.Projects}}"), to: "/projects" },
            {
              label: project?.name ?? compose("{{term.Project}}"),
              to: `/projects/${projectId}`,
              type: project?.name ? "project" : undefined,
            },
            { label: "Conversation", isCurrent: true },
          ]}
        />
      }
    />
  );
};
