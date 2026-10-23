import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProposalGroupController } from '../proposal-group.controller';
import { ProposalGroupService } from '../../services/proposal/proposal-group.service';
import { ProposalGroupDecisionService } from '../../services/proposal/proposal-group-decision.service';
import type { OrganizationId, ProjectId } from '../../types';
import { DOMAIN_EXPORTS } from '../../domain/domain.providers';

const findCanonical = jest.fn();
const approveAll = jest.fn();

@Module({
  providers: [
    { provide: ProposalGroupService, useValue: { findCanonical } },
    { provide: ProposalGroupDecisionService, useValue: { approveAll } },
  ],
  exports: DOMAIN_EXPORTS.filter(
    (provider) =>
      provider === ProposalGroupService ||
      provider === ProposalGroupDecisionService,
  ),
})
class ProposalDomainBoundaryModule {}

describe('ProposalGroupController', () => {
  it('passes organization, project, and group scope to the canonical read service', async () => {
    const findCanonical = jest.fn().mockResolvedValue({ groupId: 'group-1' });
    const module = await Test.createTestingModule({
      controllers: [ProposalGroupController],
      providers: [
        { provide: ProposalGroupService, useValue: { findCanonical } },
        { provide: ProposalGroupDecisionService, useValue: {} },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const controller = module.get(ProposalGroupController);

    await expect(
      controller.findOne(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'group-1',
      ),
    ).resolves.toEqual({ groupId: 'group-1' });
    expect(findCanonical).toHaveBeenCalledWith('org-1', 'project-1', 'group-1');
  });

  it('passes the authenticated actor and route scope to approve-all', async () => {
    const approveAll = jest.fn().mockResolvedValue({
      groupId: 'group-1',
      revision: 3,
      results: [],
    });
    const module = await Test.createTestingModule({
      controllers: [ProposalGroupController],
      providers: [
        { provide: ProposalGroupService, useValue: {} },
        { provide: ProposalGroupDecisionService, useValue: { approveAll } },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const controller = module.get(ProposalGroupController);

    await expect(
      controller.approveAll(
        { userId: 'user-1' } as never,
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'group-1',
      ),
    ).resolves.toEqual({ groupId: 'group-1', revision: 3, results: [] });
    expect(approveAll).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      groupId: 'group-1',
      userId: 'user-1',
    });
  });

  it('resolves the required decision service across the domain export boundary', async () => {
    approveAll.mockResolvedValueOnce({
      groupId: 'group-1',
      revision: 3,
      results: [],
    });
    const module = await Test.createTestingModule({
      imports: [ProposalDomainBoundaryModule],
      controllers: [ProposalGroupController],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    await expect(
      module
        .get(ProposalGroupController)
        .approveAll(
          { userId: 'user-1' } as never,
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'group-1',
        ),
    ).resolves.toEqual({ groupId: 'group-1', revision: 3, results: [] });
    expect(approveAll).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      groupId: 'group-1',
      userId: 'user-1',
    });
  });
});
