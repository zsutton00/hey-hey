import type { Logger } from '@nestjs/common';
import type { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import type {
  MentionCreatedEvent,
  MentionRemovedEvent,
} from 'src/core/events/types/domain-events';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import {
  MentionCreatedEventPayload,
  MentionRemovedEventPayload,
} from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { ResolvedMention } from 'src/services/mentions/mention-processing.service';
import type {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
} from 'src/types';
import {
  buildMentionCreatedEventPayload,
  buildMentionRemovedEventPayload,
} from 'src/utils/message-event.util';
import { v4 as uuidv4 } from 'uuid';

export interface BodyMentionDiff {
  added: ResolvedMention[];
  removed: ResolvedMention[];
  dedupedAgainstDeclared: number;
}

/**
 * Diff an entity's body mentions across an approval. Targets that already
 * receive an explicitly declared edge from the same source are dropped from
 * `added`: the declared-edge path is authoritative when both fire.
 */
export function diffBodyMentions(
  prior: readonly ResolvedMention[],
  next: readonly ResolvedMention[],
  declaredTargetIds: ReadonlySet<string>,
): BodyMentionDiff {
  const priorIds = new Set(prior.map((m) => m.entityId));
  const nextIds = new Set(next.map((m) => m.entityId));
  const added = next.filter((m) => !priorIds.has(m.entityId));
  const addedFiltered = added.filter((m) => !declaredTargetIds.has(m.entityId));
  return {
    added: addedFiltered,
    removed: prior.filter((m) => !nextIds.has(m.entityId)),
    dedupedAgainstDeclared: added.length - addedFiltered.length,
  };
}

export interface PublishBodyMentionEventsParams {
  organizationId: OrganizationId;
  projectId: ProjectId;
  sourceEntityId: string;
  sourceEntityType: MentionCreatedEventPayload.SourceEntityTypeEnum;
  conversationId?: ConversationId;
  userId?: UserId;
  added: readonly ResolvedMention[];
  removed: readonly ResolvedMention[];
}

/**
 * Publish one mention.created / mention.removed event per changed target in
 * the caller's transaction. The graph service materializes explicit_mention
 * edges only from these events, so every approval path must go through here.
 */
export async function publishBodyMentionEvents(
  eventPublisher: DomainEventPublisher,
  tx: AnyTransactionClient,
  params: PublishBodyMentionEventsParams,
  logger: Logger,
): Promise<void> {
  const {
    organizationId,
    projectId,
    sourceEntityId,
    sourceEntityType,
    conversationId,
    userId,
  } = params;

  logger.debug('Publishing body-mention events', {
    sourceEntityId,
    sourceEntityType,
    addedCount: params.added.length,
    removedCount: params.removed.length,
  });

  for (const mention of params.added) {
    const mentionId = uuidv4();
    const payload = buildMentionCreatedEventPayload({
      organizationId,
      projectId,
      sourceEntityId,
      sourceEntityType,
      conversationId,
      entityId: mention.entityId,
      entityType:
        mention.entityType as MentionCreatedEventPayload.EntityTypeEnum,
      userId,
    });
    const event: Omit<MentionCreatedEvent, 'id'> = {
      type: EVENT_TYPES.MENTION.CREATED,
      aggregateId: mentionId,
      payload,
    };
    await eventPublisher.publishInTransaction(tx, event);
    logger.debug('Published mention.created event', {
      mentionId,
      sourceEntityId,
      targetEntityId: mention.entityId,
    });
  }

  for (const mention of params.removed) {
    const mentionId = uuidv4();
    const payload = buildMentionRemovedEventPayload({
      organizationId,
      projectId,
      sourceEntityId,
      sourceEntityType,
      conversationId,
      entityId: mention.entityId,
      entityType:
        mention.entityType as MentionRemovedEventPayload.EntityTypeEnum,
      userId,
    });
    const event: Omit<MentionRemovedEvent, 'id'> = {
      type: EVENT_TYPES.MENTION.REMOVED,
      aggregateId: mentionId,
      payload,
    };
    await eventPublisher.publishInTransaction(tx, event);
    logger.debug('Published mention.removed event', {
      mentionId,
      sourceEntityId,
      targetEntityId: mention.entityId,
    });
  }
}
