import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ProjectApprovalPolicyService } from '../project-approval-policy.service';
import { ProposalGroupAuthoringService } from '../proposal-group-authoring.service';
import { ProposalService } from '../proposal.service';
import type { StampedCreateProposalDto } from '../proposal.types';

const ORGANIZATION_ID =
  '30000000-0000-4000-8000-000000000001' as OrganizationId;
const PROJECT_ID = '30000000-0000-4000-8000-000000000002' as ProjectId;
const USER_ID = '30000000-0000-4000-8000-000000000003' as UserId;
const GROUP_ID = '30000000-0000-4000-8000-000000000004';
const MEMBER_ID = '30000000-0000-4000-8000-000000000005';
const PROPOSAL_ID = '30000000-0000-4000-8000-000000000007';

const typeProposal = {
  action: 'UPDATE',
  targetEntityType: 'WORK_ITEM_TYPE',
  targetEntityId: 'MARKETING',
} as unknown as StampedCreateProposalDto;

const taskProposal = {
  action: 'UPDATE',
  targetEntityType: 'TASK',
  targetEntityId: '30000000-0000-4000-8000-000000000006',
} as unknown as StampedCreateProposalDto;

const denied = () =>
  jest
    .fn()
    .mockRejectedValue(new ForbiddenException('Insufficient permissions'));

describe('work-item type proposal authoring role gate', () => {
  describe('ProposalService', () => {
    function setup(assertProjectRole: jest.Mock) {
      const db = {
        project: { findFirst: jest.fn().mockResolvedValue(null) },
        proposal: { findFirst: jest.fn() },
        $transaction: jest.fn(),
      };
      const service = new ProposalService(
        { db } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        new ProjectApprovalPolicyService(),
        {} as never,
        { assertProjectRole } as never,
        { captureAuthoring: jest.fn() } as never,
        {} as never,
      );
      return { service, db };
    }

    it.each(['create', 'createWithReservedId'] as const)(
      '%s denies a caller without the work-item-types capability before touching persistence',
      async (method) => {
        const assertProjectRole = denied();
        const { service, db } = setup(assertProjectRole);

        await expect(
          service[method](ORGANIZATION_ID, PROJECT_ID, USER_ID, typeProposal),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(assertProjectRole).toHaveBeenCalledWith(
          PROJECT_ID,
          USER_ID,
          'manageWorkItemTypes',
        );
        expect(db.project.findFirst).not.toHaveBeenCalled();
      },
    );

    it('createBatch denies the whole batch when any member targets a work-item type', async () => {
      const assertProjectRole = denied();
      const { service, db } = setup(assertProjectRole);

      await expect(
        service.createBatch(ORGANIZATION_ID, PROJECT_ID, USER_ID, [
          taskProposal,
          typeProposal,
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('does not apply the role gate to non-type proposals', async () => {
      const assertProjectRole = denied();
      const { service } = setup(assertProjectRole);

      await expect(
        service.create(ORGANIZATION_ID, PROJECT_ID, USER_ID, taskProposal),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(assertProjectRole).not.toHaveBeenCalled();
    });

    describe('update', () => {
      // A null ELI5 stops update with BadRequestException once the role gate
      // has passed and before any validation or write, so a caller that clears
      // the gate is observable without standing up the validation engine.
      const draftOf = (targetEntityType: string) => ({
        id: PROJECT_ID,
        status: 'PENDING',
        targetEntityType,
        eli5: null,
        updates: {},
        influences: [],
        messageId: null,
        conversationId: null,
        groupMembership: null,
      });

      function setupUpdate(
        assertProjectRole: jest.Mock,
        existing: ReturnType<typeof draftOf>,
      ) {
        const tx = {
          proposal: { findFirst: jest.fn().mockResolvedValue(existing) },
          $executeRaw: jest.fn(),
        };
        const db = {
          proposal: { findFirst: jest.fn() },
          $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
        };
        const service = new ProposalService(
          { db } as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          new ProjectApprovalPolicyService(),
          {} as never,
          { assertProjectRole } as never,
          { captureAuthoring: jest.fn() } as never,
          {} as never,
        );
        return { service, tx };
      }

      const edit = (service: ProposalService, dto: Record<string, unknown>) =>
        service.update(
          PROPOSAL_ID,
          ORGANIZATION_ID,
          PROJECT_ID,
          dto as never,
          USER_ID,
        );

      it('denies turning a non-type draft into a work-item type change', async () => {
        const assertProjectRole = denied();
        const { service, tx } = setupUpdate(assertProjectRole, draftOf('TASK'));

        await expect(
          edit(service, {
            targetEntityType: 'WORK_ITEM_TYPE',
            updates: { key: 'MARKETING' },
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(assertProjectRole).toHaveBeenCalledWith(
          PROJECT_ID,
          USER_ID,
          'manageWorkItemTypes',
        );
        expect(tx.proposal.findFirst).toHaveBeenCalled();
      });

      it('denies editing an existing work-item type draft', async () => {
        const assertProjectRole = denied();
        const { service } = setupUpdate(
          assertProjectRole,
          draftOf('WORK_ITEM_TYPE'),
        );

        await expect(
          edit(service, { updates: { key: 'MARKETING' } }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(assertProjectRole).toHaveBeenCalledWith(
          PROJECT_ID,
          USER_ID,
          'manageWorkItemTypes',
        );
      });

      it('lets a caller with the capability edit a work-item type draft', async () => {
        const assertProjectRole = jest.fn().mockResolvedValue(undefined);
        const { service } = setupUpdate(
          assertProjectRole,
          draftOf('WORK_ITEM_TYPE'),
        );

        await expect(
          edit(service, { updates: { key: 'MARKETING' } }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(assertProjectRole).toHaveBeenCalledTimes(1);
      });

      it('does not apply the role gate to edits of non-type drafts', async () => {
        const assertProjectRole = denied();
        const { service } = setupUpdate(assertProjectRole, draftOf('TASK'));

        await expect(
          edit(service, { updates: { name: 'Renamed' } }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(assertProjectRole).not.toHaveBeenCalled();
      });
    });
  });

  describe('ProposalGroupAuthoringService', () => {
    function setup(assertProjectRole: jest.Mock) {
      const db = { $transaction: jest.fn() };
      const service = new ProposalGroupAuthoringService(
        { db } as never,
        {} as never,
        {} as never,
        { assertProjectRole } as never,
        { captureAuthoring: jest.fn() } as never,
      );
      return { service, db };
    }

    it('addMember denies a caller without the work-item-types capability', async () => {
      const assertProjectRole = denied();
      const { service, db } = setup(assertProjectRole);

      await expect(
        service.addMember(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, {
          expectedRevision: 1,
          proposal: typeProposal,
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(assertProjectRole).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID,
        'manageWorkItemTypes',
      );
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('addMembers denies the batch when any member targets a work-item type', async () => {
      const { service, db } = setup(denied());

      await expect(
        service.addMembers(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, 1, [
          taskProposal,
          typeProposal,
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('updateMember denies a caller without the work-item-types capability', async () => {
      const { service, db } = setup(denied());

      await expect(
        service.updateMember(
          ORGANIZATION_ID,
          PROJECT_ID,
          GROUP_ID,
          MEMBER_ID,
          USER_ID,
          { expectedRevision: 1, proposal: typeProposal } as never,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('does not apply the role gate to non-type members', async () => {
      const assertProjectRole = denied();
      const { service, db } = setup(assertProjectRole);
      db.$transaction.mockRejectedValue(new NotFoundException('stop'));

      await expect(
        service.addMember(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, {
          expectedRevision: 1,
          proposal: taskProposal,
        } as never),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(assertProjectRole).not.toHaveBeenCalled();
    });
  });
});
