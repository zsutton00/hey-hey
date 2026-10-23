import { ForbiddenException } from '@nestjs/common';
import { ProjectResourceAccessService } from '../project-resource-access.service';

describe('canonical project resource ownership', () => {
  const access = { assertProject: jest.fn(), assertOrganization: jest.fn() };
  const findFirst = jest.fn();
  const db = Object.fromEntries(
    [
      'task',
      'designDoc',
      'conversation',
      'service',
      'proposal',
      'proposalGroup',
      'agentSession',
      'report',
      'artifact',
      'integration',
      'flowExecution',
      'notification',
      'lLMPromptResponse',
      'message',
      'validationSession',
      'implementationHint',
      'initiative',
      'tag',
    ].map((name) => [name, { findFirst, findMany: jest.fn() }]),
  );
  const resources = new ProjectResourceAccessService(
    { db } as never,
    access as never,
  );

  beforeEach(() => jest.resetAllMocks());

  it.each([
    'task',
    'designDoc',
    'conversation',
    'service',
    'proposal',
    'proposalGroup',
    'agentSession',
    'report',
    'artifact',
    'integration',
    'execution',
    'notification',
    'llmRecord',
  ] as const)(
    'denies foreign %s content and admits its member using persisted ownership',
    async (kind) => {
      findFirst.mockResolvedValue({ projectId: 'bob-project' });
      access.assertProject.mockRejectedValueOnce(new ForbiddenException());
      await expect(
        resources.assertResource('alice', 'same-org', kind, 'child'),
      ).rejects.toThrow(ForbiddenException);
      await resources.assertResource('bob', 'same-org', kind, 'child');
      expect(access.assertProject).toHaveBeenLastCalledWith(
        'bob',
        'same-org',
        'bob-project',
      );
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ select: { projectId: true } }),
      );
    },
  );

  it.each([
    [
      'message',
      { projectId: 'bob-project', conversation: { projectId: 'bob-project' } },
    ],
    ['validationSession', { task: { projectId: 'bob-project' } }],
    ['implementationHint', { service: { projectId: 'bob-project' } }],
    ['initiative', { originatingProjectId: 'bob-project' }],
  ] as const)(
    'resolves indirect ownership for %s before accepting a supplied project',
    async (kind, row) => {
      findFirst.mockResolvedValue(row);
      await expect(
        resources.assertResource(
          'alice',
          'same-org',
          kind,
          'child',
          'alice-project',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(access.assertProject).not.toHaveBeenCalled();
      await resources.assertResource(
        'bob',
        'same-org',
        kind,
        'child',
        'bob-project',
      );
      expect(access.assertProject).toHaveBeenCalledWith(
        'bob',
        'same-org',
        'bob-project',
      );
    },
  );

  it('authorizes a tag through its canonical entity rather than its supplied tag ID', async () => {
    findFirst
      .mockResolvedValueOnce({ entityType: 'TASK', entityId: 'bob-task' })
      .mockResolvedValueOnce({ projectId: 'bob-project' });
    access.assertProject.mockRejectedValue(new ForbiddenException());
    await expect(
      resources.assertResource('alice', 'same-org', 'tag', 'tag'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('filters tag identity candidates before content is queried or paginated', async () => {
    db.tag!.findMany = jest.fn().mockResolvedValue([
      { id: 'private-tag', entityType: 'TASK', entityId: 'bob-task' },
      { id: 'visible-tag', entityType: 'TASK', entityId: 'alice-task' },
    ]);
    findFirst.mockImplementation(async ({ where }) => ({
      projectId: where.id === 'bob-task' ? 'bob-project' : 'alice-project',
    }));
    access.assertProject.mockImplementation(async (_user, _org, project) => {
      if (project === 'bob-project') throw new ForbiddenException();
    });
    await expect(
      resources.accessibleTagIds('alice', 'same-org'),
    ).resolves.toEqual(['visible-tag']);
    expect(db.tag!.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'same-org' },
      select: { id: true, entityType: true, entityId: true },
    });
  });
});
