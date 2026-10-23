import { AgentEdgeEndpointEntityType, AgentEdgeType } from "@hey-hey/ui-common/api";
import {
  MOCKUP_TYPE_KEY,
  isWorkflowFlowRelationship,
  selectVisualArtifacts,
} from "@hey-hey/ui-common/components";
import { useWorkItems } from "@hey-hey/ui-common/data";

import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";

// Connected-item selection requires explicit labels. Match the visual selector's
// exclusion of workflow flow edges without fetching an entire entity context.
const VISUAL_EDGE_TYPES = Object.values(AgentEdgeType).filter(
  (type) => !isWorkflowFlowRelationship(type),
);

export const useFeatureSectionVisualArtifacts = (
  organizationId: string,
  projectId: string,
  featureId: string,
  enabled: boolean,
) => {
  const structuralOptions = { parentTaskId: featureId, includeEdges: false, enabled };
  const connectedOptions = {
    relatedEntityId: featureId,
    relatedEntityType: AgentEdgeEndpointEntityType.Task,
    edgeTypes: VISUAL_EDGE_TYPES,
    includeEdges: false,
    enabled,
  };
  const mockups = useWorkItems(organizationId, "task", projectId, undefined, {
    ...structuralOptions,
    taskType: MOCKUP_TYPE_KEY,
  });
  const diagrams = useWorkItems(organizationId, "task", projectId, undefined, {
    ...structuralOptions,
    taskType: WORK_ITEM_TYPE_KEYS.Diagram,
  });
  const linkedMockups = useWorkItems(organizationId, "task", projectId, undefined, {
    ...connectedOptions,
    taskType: MOCKUP_TYPE_KEY,
  });
  const linkedDiagrams = useWorkItems(organizationId, "task", projectId, undefined, {
    ...connectedOptions,
    taskType: WORK_ITEM_TYPE_KEYS.Diagram,
  });

  if (!enabled) return [];
  const structural = [...(mockups.workItems ?? []), ...(diagrams.workItems ?? [])]
    .filter((item) => item.parentTaskId === featureId);
  // The connected endpoint selects direct graph neighbors before pagination;
  // it never traverses through children. Append them after the structural set
  // so the shared selector keeps structural names and removes duplicates.
  return selectVisualArtifacts([
    ...structural,
    ...(linkedMockups.workItems ?? []),
    ...(linkedDiagrams.workItems ?? []),
  ], []);
};
