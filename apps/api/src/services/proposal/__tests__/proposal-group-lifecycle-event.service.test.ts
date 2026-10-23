import { ProposalGroupLifecycleEventService } from '../proposal-group-lifecycle-event.service';
import type { DomainEventPublisher } from 'src/core/events/domain-event-publisher';

describe('ProposalGroupLifecycleEventService', () => {
  it('persists compact metadata transactionally and serializes member ids as a JSON array', async () => {
    const publishInTransaction = jest.fn().mockResolvedValue('event-1');
    const service = new ProposalGroupLifecycleEventService({
      publishInTransaction,
    } as unknown as DomainEventPublisher);
    const tx = {} as never;

    await service.publishInTransaction(tx, {
      organizationId: 'organization-1' as never,
      projectId: 'project-1' as never,
      groupId: 'group-1',
      revision: 4,
      changedMemberIds: ['member-1', 'member-1', 'member-2'],
    });

    const event = publishInTransaction.mock.calls[0]![1];
    expect(event).toMatchObject({
      type: 'proposal_group.lifecycle',
      aggregateId: 'group-1',
      payload: {
        groupId: 'group-1',
        revision: 4,
      },
    });
    expect(JSON.parse(JSON.stringify(event)).payload.changedMemberIds).toEqual([
      'member-1',
      'member-2',
    ]);
    expect(publishInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'proposal_group.lifecycle',
        aggregateId: 'group-1',
      }),
    );
  });
});
