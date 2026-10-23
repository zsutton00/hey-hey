import { BadRequestException, ConflictException } from '@nestjs/common';
import type { WorkItemType } from '@prisma/client';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import type { OrganizationId, ProjectId } from '../../types';
import { WorkItemTypeLifecycleService } from './work-item-type-lifecycle.service';

const ORGANIZATION_ID = 'org-1' as OrganizationId;
const PROJECT_ID = 'project-1' as ProjectId;
const TYPE_KEY = 'MARKETING';
const ROW_ID = 'row-1';

const definition: WorkItemTypeDefinitionDto = {
  key: TYPE_KEY,
  name: 'Marketing',
  role: 'work-item',
  sections: [{ key: 'description', label: 'Description' }],
  allowedStatuses: ['BACKLOG'],
};

function row(lifecycleStatus: 'active' | 'archived'): WorkItemType {
  return {
    id: ROW_ID,
    typeKey: TYPE_KEY,
    projectId: PROJECT_ID,
    lifecycleStatus,
  } as unknown as WorkItemType;
}

function makeTransaction() {
  return {
    workItemType: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
}

describe('WorkItemTypeLifecycleService', () => {
  const registry = {
    materializeDefinition: jest.fn().mockReturnValue(definition),
    publishConfigChanged: jest.fn().mockResolvedValue(undefined),
  } as any;
  let service: WorkItemTypeLifecycleService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkItemTypeLifecycleService(registry);
  });

  it('archives a canonical-seeded project row in place and preserves all other columns', async () => {
    const tx = makeTransaction();
    tx.workItemType.findFirst.mockResolvedValue(row('active'));

    const postCommit = await service.archiveInTransaction(
      tx,
      TYPE_KEY,
      PROJECT_ID,
      ORGANIZATION_ID,
    );

    expect(tx.workItemType.updateMany).toHaveBeenCalledWith({
      where: {
        id: ROW_ID,
        projectId: PROJECT_ID,
        lifecycleStatus: 'active',
      },
      data: { lifecycleStatus: 'archived' },
    });
    expect(postCommit.runPostCommit).toBeDefined();
    expect(registry.publishConfigChanged).not.toHaveBeenCalled();
    await postCommit.runPostCommit();
    expect(registry.publishConfigChanged).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      TYPE_KEY,
      PROJECT_ID,
    );
  });

  it('restores the retained row only when the archived definition is exact', async () => {
    const tx = makeTransaction();
    tx.workItemType.findFirst.mockResolvedValue(row('archived'));

    await service.restoreInTransaction(
      tx,
      TYPE_KEY,
      definition,
      PROJECT_ID,
      ORGANIZATION_ID,
    );

    expect(tx.workItemType.updateMany).toHaveBeenCalledWith({
      where: {
        id: ROW_ID,
        projectId: PROJECT_ID,
        lifecycleStatus: 'archived',
      },
      data: { lifecycleStatus: 'active' },
    });
  });

  it.each([
    ['missing', null, definition, BadRequestException],
    ['already active', row('active'), definition, ConflictException],
    [
      'stale definition',
      row('archived'),
      { ...definition, name: 'Changed' },
      ConflictException,
    ],
  ])(
    'rejects %s restoration targets without writing a row',
    async (_name, retainedRow, submitted, ErrorType) => {
      const tx = makeTransaction();
      tx.workItemType.findFirst.mockResolvedValue(retainedRow);

      await expect(
        service.restoreInTransaction(
          tx,
          TYPE_KEY,
          submitted as WorkItemTypeDefinitionDto,
          PROJECT_ID,
          ORGANIZATION_ID,
        ),
      ).rejects.toBeInstanceOf(ErrorType);
      expect(tx.workItemType.updateMany).not.toHaveBeenCalled();
    },
  );

  it('fails an archive when a concurrent state change defeats the active guard', async () => {
    const tx = makeTransaction();
    tx.workItemType.findFirst.mockResolvedValue(row('active'));
    tx.workItemType.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.archiveInTransaction(tx, TYPE_KEY, PROJECT_ID, ORGANIZATION_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
