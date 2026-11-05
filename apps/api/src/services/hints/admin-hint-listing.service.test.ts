import { ForbiddenException } from '@nestjs/common';
import { AdminHintListingService } from './admin-hint-listing.service';
import type { Hint } from '../../generated/graphs';
import type { OrganizationId, ProjectId } from '../../types';

const requestor = {
  userId: 'user-1',
  organizationId: 'org-1' as OrganizationId,
  projectId: 'project-1' as ProjectId,
  token: 'token',
};

const feature = '11111111-1111-4111-8111-111111111111';
const mockup = '22222222-2222-4222-8222-222222222222';
const hiddenTask = '33333333-3333-4333-8333-333333333333';
const missingTask = '44444444-4444-4444-8444-444444444444';
const session = '55555555-5555-4555-8555-555555555555';

const connect = (hintId: string, targetNodeId: string, strength: number) => ({
  id: `${hintId}-${targetNodeId}`,
  targetNodeId,
  targetEntityType: 'TASK' as const,
  strength,
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
});

const makeHint = (
  id: string,
  text: string,
  targets: [string, number][],
): Hint => ({
  id,
  projectId: requestor.projectId,
  text,
  origin: { entityType: 'AGENT_SESSION', entityId: session },
  connections: targets.map(([target, strength]) =>
    connect(id, target, strength),
  ),
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
});

function setup(hints: Hint[]) {
  const graphsClient = {
    listProjectHints: jest.fn().mockResolvedValue({ hints }),
  };
  const resourceAccess = {
    assertResource: jest.fn().mockResolvedValue(undefined),
  };
  // Only items inside the caller's project and not archived come back, as in the real query.
  const task = {
    findMany: jest.fn().mockResolvedValue([
      { id: feature, name: 'Project Page', type: 'FEATURE' },
      { id: mockup, name: 'Admin Hints mockup', type: 'mockup' },
    ]),
  };
  const prisma = {
    db: {
      task,
      designDoc: { findMany: jest.fn().mockResolvedValue([]) },
      service: { findMany: jest.fn().mockResolvedValue([]) },
      entityRegistry: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };
  const service = new AdminHintListingService(
    graphsClient as never,
    resourceAccess as never,
    prisma as never,
  );
  return { service, graphsClient, resourceAccess, task };
}

const hints = () => [
  makeHint('a', 'Prefer server filtering', [
    [feature, 1],
    [mockup, 3],
    [missingTask, 2],
  ]),
  makeHint('b', 'Mention the secret', [[hiddenTask, 5]]),
  makeHint('c', 'Repeated target', [[feature, 0.5]]),
];

describe('AdminHintListingService', () => {
  it('names connected items with one batched lookup and leaves unavailable ones untitled', async () => {
    const { service, task } = setup(hints());

    const result = await service.list(requestor, {});

    expect(task.findMany).toHaveBeenCalledTimes(1);
    expect(result.totalCount).toBe(3);
    expect(result.matchingCount).toBe(3);
    expect(result.hints[0]!.connections).toEqual([
      expect.objectContaining({ title: 'Project Page', itemType: 'FEATURE' }),
      expect.objectContaining({
        title: 'Admin Hints mockup',
        itemType: 'mockup',
      }),
      expect.not.objectContaining({ title: expect.anything() }),
    ]);
    expect(result.hints[1]!.connections[0]).not.toHaveProperty('title');
  });

  it('requires project access before reading anything', async () => {
    const { service, graphsClient, resourceAccess } = setup(hints());
    resourceAccess.assertResource.mockRejectedValueOnce(
      new ForbiddenException(),
    );

    await expect(service.list(requestor, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(graphsClient.listProjectHints).not.toHaveBeenCalled();
  });

  it('combines text, type and strength filters and keeps every connection', async () => {
    const { service } = setup(hints());

    const result = await service.list(requestor, {
      search: 'server',
      itemTypes: ['mockup'],
      minStrength: 2,
    });

    expect(result.matchingCount).toBe(1);
    expect(result.totalCount).toBe(3);
    expect(result.hints[0]!.connections).toHaveLength(3);
  });

  it('matches connected item titles but never an unavailable one', async () => {
    const { service } = setup(hints());

    expect(
      (await service.list(requestor, { search: 'project page' })).hints.map(
        (h: { id: string }) => h.id,
      ),
    ).toEqual(['a', 'c']);
    // The hidden item's title is unknown to the response, so nothing can match it.
    expect(
      (await service.list(requestor, { search: 'hidden' })).matchingCount,
    ).toBe(0);
  });

  it('never lets an unavailable connection satisfy a type filter', async () => {
    const { service } = setup(hints());

    const result = await service.list(requestor, { itemTypes: ['TASK'] });

    expect(result.matchingCount).toBe(0);
  });
});
