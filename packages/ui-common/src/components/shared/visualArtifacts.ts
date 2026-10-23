import {
  type ContextRelatedEntityDto,
  EntityType,
  RelationshipValue,
} from "../../api";
import { DIAGRAM_TASK_TYPE } from "../../constants/taskTypes";

export const MOCKUP_TYPE_KEY = "mockup";

const WORKFLOW_FLOW_RELATIONSHIPS = new Set<string>([
  "STANDARD",
  "CONDITIONAL",
  "LOOP",
  "standard",
  "conditional",
  "loop",
]);

/** Diagram step-to-step flow rows, which are graph structure, not links. */
export const isWorkflowFlowRelationship = (relationship: string): boolean =>
  WORKFLOW_FLOW_RELATIONSHIPS.has(relationship);

/** Work-item types the rail renders as visual cards instead of Related rows. */
const VISUAL_ARTIFACT_TYPE_KEYS = new Set<string>([
  MOCKUP_TYPE_KEY,
  DIAGRAM_TASK_TYPE,
]);

export const isVisualArtifactTypeKey = (
  typeKey: string | null | undefined
): boolean => !!typeKey && VISUAL_ARTIFACT_TYPE_KEYS.has(typeKey);

export interface VisualArtifact {
  entityId: string;
  typeKey: string;
  displayName: string;
}

export interface StructuralChild {
  id: string;
  type: string;
  name: string;
}

/**
 * Direct structural Mockup/Diagram children first, then edge-linked ones from
 * related entities. Structural parent/sibling and workflow-flow rows are not
 * links, so they never produce a card. Each artifact appears once.
 */
export const selectVisualArtifacts = (
  structuralChildren: readonly StructuralChild[],
  relatedEntities: readonly ContextRelatedEntityDto[]
): VisualArtifact[] => {
  const seen = new Set<string>();
  const artifacts: VisualArtifact[] = [];
  const add = (artifact: VisualArtifact) => {
    if (seen.has(artifact.entityId)) return;
    seen.add(artifact.entityId);
    artifacts.push(artifact);
  };

  for (const child of structuralChildren) {
    if (!isVisualArtifactTypeKey(child.type)) continue;
    add({ entityId: child.id, typeKey: child.type, displayName: child.name });
  }

  for (const entity of relatedEntities) {
    if (entity.entityType !== EntityType.Task) continue;
    if (!isVisualArtifactTypeKey(entity.taskType)) continue;
    if (
      entity.relationship === RelationshipValue.Parent ||
      entity.relationship === RelationshipValue.SiblingViaParent ||
      isWorkflowFlowRelationship(entity.relationship)
    ) {
      continue;
    }
    add({
      entityId: entity.entityId,
      typeKey: entity.taskType as string,
      displayName: entity.displayName,
    });
  }

  return artifacts;
};
