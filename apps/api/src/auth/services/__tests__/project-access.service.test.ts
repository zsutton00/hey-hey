import { ForbiddenException } from '@nestjs/common';
import { ProjectAccessService } from '../project-access.service';

describe('ProjectAccessService', () => {
  const project = { findFirst: jest.fn(), findMany: jest.fn() };
  const organizationMember = { findFirst: jest.fn() };
  const access = new ProjectAccessService({
    db: { project, organizationMember },
  } as never);
  beforeEach(() => jest.resetAllMocks());

  it('requires both current memberships and matching ownership in the persistence predicate', async () => {
    project.findFirst.mockResolvedValue({ id: 'alice-project' });
    await access.assertProject('alice', 'same-org', 'alice-project');
    expect(project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'alice-project',
        organizationId: 'same-org',
        deletedAt: null,
        members: { some: { userId: 'alice' } },
        organization: {
          isActive: true,
          members: { some: { userId: 'alice', isActive: true } },
        },
      },
      select: { id: true },
    });
  });

  it('rejects nonmembership, removed membership, deleted projects and foreign ownership uniformly', async () => {
    project.findFirst.mockResolvedValue(null);
    await expect(
      access.assertProject('bob', 'same-org', 'alice-project'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects inactive organization membership before project discovery', async () => {
    organizationMember.findFirst.mockResolvedValue(null);
    await expect(
      access.accessibleProjectIds('alice', 'same-org'),
    ).rejects.toThrow(ForbiddenException);
    expect(project.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['updateProject', 'OWNER', true],
    ['updateProject', 'ARCHITECT', true],
    ['updateProject', 'MEMBER', false],
    ['updateProject', 'VIEWER', false],
    ['deleteProject', 'OWNER', true],
    ['deleteProject', 'ARCHITECT', false],
    ['addProjectMember', 'ARCHITECT', true],
    ['addProjectMember', 'MEMBER', false],
    ['removeProjectMember', 'OWNER', true],
    ['removeProjectMember', 'ARCHITECT', false],
    ['manageWorkItemTypes', 'ARCHITECT', true],
    ['manageWorkItemTypes', 'MEMBER', false],
  ] as const)(
    'project capability %s for %s is allowed=%s from the persisted role',
    async (capability, role, allowed) => {
      project.findFirst.mockResolvedValue({ members: [{ role }] });
      const result = access.assertProjectRole('p1', 'alice', capability);
      if (allowed) {
        await expect(result).resolves.toBe(role);
      } else {
        await expect(result).rejects.toThrow(
          new ForbiddenException('Insufficient permissions'),
        );
      }
    },
  );

  it('reads the project role under the current-access predicate', async () => {
    project.findFirst.mockResolvedValue({ members: [{ role: 'OWNER' }] });
    await access.assertProjectRole('p1', 'alice', 'deleteProject');
    expect(project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'p1',
        deletedAt: null,
        members: { some: { userId: 'alice' } },
        organization: {
          isActive: true,
          members: { some: { userId: 'alice', isActive: true } },
        },
      },
      select: {
        members: {
          where: { userId: 'alice' },
          select: { role: true },
          take: 1,
        },
      },
    });
  });

  it('denies project capabilities without project access', async () => {
    project.findFirst.mockResolvedValue(null);
    await expect(
      access.assertProjectRole('p1', 'bob', 'updateProject'),
    ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));
  });

  it.each([
    ['createProject', 'OWNER', true],
    ['createProject', 'ADMIN', true],
    ['createProject', 'MEMBER', false],
    ['createProject', 'VIEWER', false],
    ['inviteToOrganization', 'ADMIN', true],
    ['inviteToOrganization', 'MEMBER', false],
    ['removeOrganizationMember', 'OWNER', true],
    ['removeOrganizationMember', 'MEMBER', false],
  ] as const)(
    'organization capability %s for %s is allowed=%s from the persisted role',
    async (capability, role, allowed) => {
      organizationMember.findFirst.mockResolvedValue({ role });
      const result = access.assertOrganizationRole('org', 'alice', capability);
      if (allowed) {
        await expect(result).resolves.toBe(role);
      } else {
        await expect(result).rejects.toThrow(
          new ForbiddenException('Insufficient permissions'),
        );
      }
    },
  );

  it('denies organization capabilities without active organization membership', async () => {
    organizationMember.findFirst.mockResolvedValue(null);
    await expect(
      access.assertOrganizationRole('org', 'bob', 'createProject'),
    ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));
    expect(organizationMember.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'bob',
        organizationId: 'org',
        isActive: true,
        organization: { isActive: true },
      },
      select: { role: true },
    });
  });

  it('requires an allowed project role for role-restricted actions', async () => {
    project.findFirst.mockResolvedValue({ id: 'alice-project' });
    await access.assertProjectRoles('alice', 'same-org', 'alice-project', [
      'OWNER',
      'ARCHITECT',
    ]);
    expect(project.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'alice-project',
        organizationId: 'same-org',
        deletedAt: null,
        members: {
          some: { userId: 'alice', role: { in: ['OWNER', 'ARCHITECT'] } },
        },
      }),
      select: { id: true },
    });

    project.findFirst.mockResolvedValue(null);
    await expect(
      access.assertProjectRoles('bob', 'same-org', 'alice-project', ['OWNER']),
    ).rejects.toThrow(ForbiddenException);
  });
});
