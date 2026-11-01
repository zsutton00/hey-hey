import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { FutureRevisionMutation } from 'src/generated';
import type { Proposal } from '@prisma/client';
import {
  readDependencyPresentation,
  readProposalDependencyPresentation,
} from '../future-dependency-presentation';

const dependency = (targetEntityId: string) => ({
  edgeType: 'DEPENDS_ON' as const,
  targetEntityType: 'TASK' as const,
  targetEntityId,
});
const proposal = (id: string, ids: string[], projectId = 'project') => ({
  id,
  action: 'VERSIONED_UPDATE' as const,
  organizationId: 'org',
  projectId,
  updates: {
    operation: 'REVISE',
    dependencies: ids.map(dependency),
  } as unknown as FutureRevisionMutation as unknown as Proposal['updates'],
});

describe('future dependency presentation', () => {
  it('batches pending identities per authorized project without status or changing authored dependencies', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        { id: 'task', name: 'Task title', type: 'STANDARD' },
        { id: 'bug', name: 'Bug title', type: 'BUG' },
        { id: 'plan', name: 'Plan title', type: 'PLAN' },
      ])
      .mockResolvedValueOnce([]);
    const tx = { task: { findMany } } as unknown as AnyTransactionClient;
    const proposals = [
      proposal('one', ['task', 'bug', 'missing']),
      proposal('two', ['plan', 'task']),
      proposal('other-scope', ['task'], 'other'),
    ];
    const before = structuredClone(proposals);
    const result = await readProposalDependencyPresentation(tx, proposals);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: {
        organizationId: 'org',
        projectId: 'project',
        id: { in: ['task', 'bug', 'missing', 'plan'] },
        archivedAt: null,
        status: { not: 'ARCHIVED' },
      },
      select: { id: true, name: true, type: true },
    });
    expect(result.get('one')).toEqual([
      {
        availability: 'AVAILABLE',
        targetEntityId: 'task',
        title: 'Task title',
        workItemType: 'STANDARD',
      },
      {
        availability: 'AVAILABLE',
        targetEntityId: 'bug',
        title: 'Bug title',
        workItemType: 'BUG',
      },
      { availability: 'UNAVAILABLE', targetEntityId: 'missing' },
    ]);
    expect(result.get('two')?.[0]).toMatchObject({
      workItemType: 'PLAN',
      title: 'Plan title',
    });
    expect(result.get('other-scope')).toEqual([
      { availability: 'UNAVAILABLE', targetEntityId: 'task' },
    ]);
    expect(proposals).toEqual(before);
  });

  it('supplies current status only for approved future reads', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'bug', name: 'Repair review', type: 'BUG', status: 'VERIFYING' },
      ]);
    const result = await readDependencyPresentation(
      { task: { findMany } } as unknown as AnyTransactionClient,
      'org',
      'project',
      [dependency('bug')],
      true,
    );
    expect(result).toEqual([
      {
        availability: 'AVAILABLE',
        targetEntityId: 'bug',
        title: 'Repair review',
        workItemType: 'BUG',
        status: 'VERIFYING',
      },
    ]);
    expect(findMany.mock.calls[0][0].select.status).toBe(true);
  });

  it('does not read work for ordinary updates, cancellations or empty dependencies', async () => {
    const findMany = jest.fn();
    const tx = { task: { findMany } } as unknown as AnyTransactionClient;
    await readProposalDependencyPresentation(tx, [
      proposal('empty', []),
      { ...proposal('ordinary', ['task']), action: 'UPDATE' },
      { ...proposal('cancel', []), updates: { operation: 'CANCEL' } },
    ]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
