import { EntityType } from '@prisma/client';
import { EntityType as GeneratedEntityType } from 'src/generated/model/entityType';
import { WorkflowAboutType } from 'src/types';

/**
 * Convert a WorkflowAboutType value to an EntityType when the mapping exists.
 * Returns undefined for about types that do not correspond to a refinable entity.
 */
export function workflowAboutTypeToEntityType(
  workflowAboutType?: WorkflowAboutType | null,
): EntityType | undefined {
  if (!workflowAboutType) return undefined;

  // If the value is already a valid EntityType enum member, return it directly
  if (
    (Object.values(EntityType) as string[]).includes(
      workflowAboutType as EntityType,
    )
  ) {
    return workflowAboutType as EntityType;
  }

  const normalized = workflowAboutType.toLowerCase();

  switch (normalized) {
    case 'initiative':
      return EntityType.INITIATIVE;
    case 'task':
      return EntityType.TASK;
    case 'design-doc':
    case 'design_doc':
      return EntityType.DESIGN_DOC;
    case 'artifact':
      return EntityType.ARTIFACT;
    case 'agent-session':
    case 'agent_session':
      return GeneratedEntityType.AgentSession as unknown as EntityType;
    case 'conversation':
      return EntityType.CONVERSATION;
    case 'project':
      return EntityType.PROJECT;
    case 'message':
      return EntityType.MESSAGE;
    case 'proposal':
      return EntityType.PROPOSAL;
    default:
      return undefined;
  }
}
