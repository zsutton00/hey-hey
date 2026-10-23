import type { WorkflowAboutType } from "@hey-hey/ui-common";
import type { ConversationStatus } from "@hey-hey/ui-common/api";
import React, { useCallback } from "react";
import { ConversationListTab } from "../../components/Tabs/ConversationListTab";

export interface PlanConversationTabProps {
  organizationId: string;
  projectId: string;
  planId: string;
  stageId?: string;
  stepId?: string;
  workflowName?: string;
  workflowAboutId?: string;
  workflowAboutType?: WorkflowAboutType;
  statuses?: ConversationStatus[];
}

export const PlanConversationTab: React.FC<PlanConversationTabProps> = ({
  organizationId,
  projectId,
  planId,
  stageId,
  stepId,
  workflowName,
  workflowAboutId,
  workflowAboutType,
  statuses,
}) => {
  const conversationPathForId = useCallback(
    (conversationId: string) => {
      if (stageId && stepId) {
        return `/projects/${projectId}/plans/${planId}/stages/${stageId}/steps/${stepId}/conversations/${conversationId}`;
      }
      return `/projects/${projectId}/plans/${planId}/conversations/${conversationId}`;
    },
    [planId, projectId, stageId, stepId],
  );

  return (
    <ConversationListTab
      organizationId={organizationId}
      projectId={projectId}
      conversationPathForId={conversationPathForId}
      workflowName={workflowName}
      workflowAboutId={workflowAboutId}
      workflowAboutType={workflowAboutType}
      statuses={statuses}
    />
  );
};
