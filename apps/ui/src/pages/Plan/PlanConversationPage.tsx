import React, { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWorkItem, useProject } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { createNavigationLineageEntry } from "@hey-hey/ui-common";
import { createCanonicalPageDescriptor } from "@hey-hey/ui-common/context";
import { compose } from "@hey-hey/ui-common/i18n";
import { PageBreadcrumbs } from "../../components/Layout";
import { ConversationView } from "../Conversation";

export const PlanConversationPage: React.FC = () => {
  const { projectId, planId, stageId, stepId, conversationId } = useParams<{
    projectId: string;
    planId: string;
    stageId?: string;
    stepId?: string;
    conversationId: string;
  }>();
  const { currentOrgId } = useUserIdentity() || {};
  const navigate = useNavigate();

  const { workItem: plan } = useWorkItem(
    currentOrgId || "",
    "task",
    planId || "",
    {
      projectId,
      enabled: !!currentOrgId && !!projectId && !!planId,
    }
  );
  const { data: project } = useProject(currentOrgId || "", projectId || "", {
    enabled: !!currentOrgId && !!projectId,
    preferStale: true,
  });

  const planPath = useMemo(() => {
    if (!projectId || !planId) return "";
    if (stageId && stepId) {
      return `/projects/${projectId}/plans/${planId}/stages/${stageId}/steps/${stepId}`;
    }
    return `/projects/${projectId}/plans/${planId}`;
  }, [planId, projectId, stageId, stepId]);

  const conversationPath = useMemo(() => {
    if (!projectId || !planId || !conversationId) return "";
    if (stageId && stepId) {
      return `/projects/${projectId}/plans/${planId}/stages/${stageId}/steps/${stepId}/conversations/${conversationId}`;
    }
    return `/projects/${projectId}/plans/${planId}/conversations/${conversationId}`;
  }, [conversationId, planId, projectId, stageId, stepId]);

  const handleBack = useCallback(() => {
    if (!planPath) {
      navigate(-1);
      return;
    }
    navigate(planPath);
  }, [navigate, planPath]);

  const canonicalPageComposition = conversationId
    ? {
        kind: "canonical" as const,
        descriptor: createCanonicalPageDescriptor(
          "conversation",
          conversationId,
          planId
            ? [
                createNavigationLineageEntry("task", planId),
              ]
            : null
        ),
      }
    : { kind: "observational" as const };

  return (
    <ConversationView
      organizationId={currentOrgId}
      projectId={projectId}
      conversationId={conversationId}
      canonicalPageComposition={canonicalPageComposition}
      onBack={handleBack}
      trackingContextOverride={{
        page: {
          name: "conversation",
          path: conversationPath,
          section: "conversation",
        },
      }}
      breadcrumbs={
        <PageBreadcrumbs
          sx={{ mb: 2 }}
          items={[
            { label: "Projects", to: "/projects", type: "project" },
            {
              label: project?.name ?? compose("{{term.Project}}"),
              to: `/projects/${projectId}`,
              type: "project",
            },
            {
              label: plan?.name ?? "Plan",
              to: planPath,
              type: "task",
              entityId: planId,
            },
            { label: "Conversation", isCurrent: true },
          ]}
        />
      }
    />
  );
};
