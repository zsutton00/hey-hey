import type { EntityPreviewRequest } from "@hey-hey/ui-common/context";
import { useWorkItem } from "@hey-hey/ui-common/data";
import { Box, CircularProgress } from "@mui/material";
import React from "react";
import { ConversationView } from "../pages/Conversation/ConversationView";
import { DocumentPage } from "../pages/DesignDoc/DocumentPage";
import { GoalPage } from "../pages/Goals/GoalPage";
import { InitiativePage } from "../pages/Initiative/InitiativePage";
import { PlanPage } from "../pages/Plan/PlanPage";
import { ProposalDetailView } from "../pages/Proposals/ProposalDetailView";
import { TaskPage } from "../pages/Task/TaskPage";
import { WorkflowDetailPage } from "../pages/Task/WorkflowDetailPage";
import { WORK_ITEM_TYPE_KEYS } from "../types/workItemTypes";
import { AgentSessionPreview } from "./Notifications/AgentSessionPreview";

export interface CanonicalEntityPreviewProps {
  entity: EntityPreviewRequest;
  organizationId: string;
  projectId: string;
  onRequestClose?: () => void;
}

const DIAGRAM_TYPE_KEYS = new Set<string>([
  WORK_ITEM_TYPE_KEYS.Diagram,
  WORK_ITEM_TYPE_KEYS.Workflow,
]);

/** Diagrams have their own canonical page; other tasks use TaskPage. */
const TaskEntityPreview: React.FC<{
  organizationId: string;
  projectId: string;
  taskId: string;
}> = ({ organizationId, projectId, taskId }) => {
  const { workItem, isFetched } = useWorkItem(organizationId, "task", taskId, {
    projectId,
    enabled: !!organizationId && !!taskId,
  });

  if (!isFetched) {
    return (
      <Box
        sx={{ display: "flex", justifyContent: "center", p: 4 }}
        data-testid="task-entity-preview-loading"
      >
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (workItem && DIAGRAM_TYPE_KEYS.has(workItem.type)) {
    return <WorkflowDetailPage preview={{ projectId, taskId }} />;
  }

  return (
    <TaskPage
      organizationId={organizationId}
      projectId={projectId}
      taskId={taskId}
      preview
    />
  );
};

export const CanonicalEntityPreview: React.FC<CanonicalEntityPreviewProps> = ({
  entity,
  organizationId,
  projectId,
  onRequestClose,
}) => {
  switch (entity.entityType) {
    case "initiative":
      return (
        <InitiativePage
          organizationId={organizationId}
          projectId={projectId}
          initiativeId={entity.entityId}
          preview
        />
      );
    case "task":
      return (
        <TaskEntityPreview
          organizationId={organizationId}
          projectId={projectId}
          taskId={entity.entityId}
        />
      );
    case "goal":
      return (
        <GoalPage
          organizationId={organizationId}
          projectId={projectId}
          taskId={entity.entityId}
          preview
        />
      );
    case "conversation":
      return (
        <ConversationView
          organizationId={organizationId}
          projectId={projectId}
          conversationId={entity.entityId}
          canonicalPageComposition={{ kind: "observational" }}
          onBack={onRequestClose}
          trackingContextOverride={{
            page: {
              name: "conversation-preview",
              path: `/projects/${projectId}/conversations/${entity.entityId}/preview`,
              section: "preview",
            },
            attentionEntity: undefined,
          }}
        />
      );
    case "design_doc":
      return (
        <DocumentPage
          organizationId={organizationId}
          projectId={projectId}
          documentId={entity.entityId}
          preview
        />
      );
    case "agent_session":
      return (
        <AgentSessionPreview
          organizationId={organizationId}
          projectId={projectId}
          sessionId={entity.entityId}
        />
      );
    case "plan":
      return (
        <PlanPage
          organizationId={organizationId}
          projectId={projectId}
          planId={entity.entityId}
          preview
        />
      );
    case "proposal":
      return (
        <ProposalDetailView
          organizationId={organizationId}
          projectId={projectId}
          proposalId={entity.entityId}
          preview
        />
      );
    default:
      return assertNever(entity.entityType);
  }
};

const assertNever = (value: never): never => {
  throw new Error(`Unsupported Open Item Preview: ${JSON.stringify(value)}`);
};
