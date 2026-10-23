import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from 'src/core/events/tokens';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import type { ProposalGroupLifecycleEventPayload } from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';

class JsonSerializableSet<T> extends Set<T> {
  toJSON(): T[] {
    return [...this];
  }
}

@Injectable()
export class ProposalGroupLifecycleEventService {
  private readonly logger = new Logger(ProposalGroupLifecycleEventService.name);

  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
  ) {}

  async publishInTransaction(
    tx: AnyTransactionClient,
    params: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      groupId: string;
      revision: number;
      changedMemberIds?: string[];
    },
  ): Promise<void> {
    await this.eventPublisher.publishInTransaction(tx, this.buildEvent(params));
    this.logPublished(params);
  }

  private buildEvent(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    groupId: string;
    revision: number;
    changedMemberIds?: string[];
  }) {
    const payload = {
      payloadType: 'proposal_group.lifecycle',
      organizationId: params.organizationId,
      projectId: params.projectId,
      groupId: params.groupId,
      revision: params.revision,
      changedMemberIds: new JsonSerializableSet(params.changedMemberIds ?? []),
    } satisfies ProposalGroupLifecycleEventPayload;
    return {
      type: EVENT_TYPES.PROPOSAL_GROUP.LIFECYCLE,
      aggregateId: params.groupId,
      payload,
    } as const;
  }

  private logPublished(params: {
    groupId: string;
    revision: number;
    changedMemberIds?: string[];
  }): void {
    this.logger.debug(
      'Published durable proposal-group lifecycle invalidation',
      {
        groupId: params.groupId,
        revision: params.revision,
        changedMemberIds: params.changedMemberIds ?? [],
      },
    );
  }
}
