import { EntityType } from 'src/generated';
import type { Influence } from 'src/generated';
import { AnyTransactionClient } from 'src/prisma/prisma.service';

/**
 * Workflow-about-type → influence-entity-type contract.
 *
 * Why: `Conversation.workflowAboutType` is a free-form string set by the
 * upstream workflow that birthed the conversation. Only the values listed
 * here represent canonical entities that can appear as influence targets;
 * anything else (e.g. `'user'`, `'onboarding'`, `'task-generation'`) is a
 * transient/scoped marker and must not be stamped as an origin influence.
 */
const WORKFLOW_ABOUT_TYPE_TO_ENTITY_TYPE: Record<string, EntityType> = {
  task: EntityType.Task,
  'design-doc': EntityType.DesignDoc,
  initiative: EntityType.Initiative,
  project: EntityType.Project,
  'agent-session': EntityType.AgentSession,
  'validation-session': EntityType.ValidationSession,
  artifact: EntityType.Artifact,
  message: EntityType.Message,
};

/**
 * Build a server-stamped origin influence for a proposal authored against the
 * conversation identified by `conversationId`.
 *
 * Returns `null` (and never throws) when:
 * - `conversationId` is missing
 * - the conversation has no `workflowAboutId`
 * - `workflowAboutType` is missing or does not map to a canonical entity
 *
 * Callers are expected to enforce at-most-one origin influence per proposal.
 */
export async function buildOriginInfluence(
  db: AnyTransactionClient,
  conversationId: string | null | undefined,
): Promise<Influence | null> {
  if (!conversationId) {
    return null;
  }

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { workflowAboutId: true, workflowAboutType: true },
  });

  if (!conversation?.workflowAboutId || !conversation.workflowAboutType) {
    return null;
  }

  const entityType =
    WORKFLOW_ABOUT_TYPE_TO_ENTITY_TYPE[conversation.workflowAboutType];

  if (!entityType) {
    return null;
  }

  return {
    entityId: conversation.workflowAboutId,
    entityType,
    reasoning: 'Originating context for this conversation.',
    reasonType: 'origin',
  };
}
