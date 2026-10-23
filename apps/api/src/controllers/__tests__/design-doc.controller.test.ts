import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectResourceAccessService } from 'src/auth/services/project-resource-access.service';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { DesignDocController } from '../design-doc.controller';
import { DesignDocService } from '../../services/design-doc/design-doc.service';
import { ProposalService } from '../../services/proposal/proposal.service';
import { DesignDocLinkId, OrganizationId, ProjectId } from '../../types';
import {
  CreateDesignDocDto,
  DesignDocLibraryNodeDto,
  DesignDocResponseDto,
  ProposalStatus,
  UpdateDesignDocDto,
} from '../../generated';
import { CreateDesignDocLinkDto } from '../../generated/model/createDesignDocLinkDto';
import { DesignDocLinkResponseDto } from '../../generated/model/designDocLinkResponseDto';
import { DesignDocId } from '../../types/design-doc.types';
import type { TypedProposalResponse } from '../../services/proposal/proposal.types';
import * as TestUtils from '../../utils/testUtils';

const buildFakeRequest = (headers: Record<string, string> = {}): Request =>
  ({
    headers,
    ip: '127.0.0.1',
  }) as unknown as Request;

describe('DesignDocController', () => {
  let controller: DesignDocController;
  let designDocService: jest.Mocked<DesignDocService>;
  let proposalService: { create: jest.Mock };

  const organizationId = TestUtils.testIds.organization as OrganizationId;
  const projectId = TestUtils.testIds.project as ProjectId;
  const authUser = TestUtils.createMockAuthenticatedUser();

  const buildProposalResponse = (
    overrides: Partial<TypedProposalResponse> = {},
  ): TypedProposalResponse =>
    ({
      id: 'proposal-1' as TypedProposalResponse['id'],
      organizationId,
      projectId,
      type: 'SINGLE',
      action: 'UPDATE',
      status: 'APPROVED' as ProposalStatus,
      targetEntityId: 'doc-1',
      targetEntityType: 'DESIGN_DOC',
      updates: { name: 'Updated name' },
      requestorId: authUser.userId,
      requestorContext: { source: 'user' },
      approvals: [],
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
      ...overrides,
    }) as TypedProposalResponse;

  const designDocId = 'doc-1' as DesignDocId;
  const linkId = 'link-1' as DesignDocLinkId;

  const designDocResponse: DesignDocResponseDto = {
    id: designDocId,
    name: 'Test Design Doc',
    template: 'ADR',
    status: 'ADR_CONTEXT',
    organizationId,
    projectId,
    tags: ['tag-1'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sections: [
      {
        id: 'section-1',
        key: 'context',
        order: 0,
        materializedMarkdown: 'Problem details',
      },
      {
        id: 'section-2',
        key: 'decision',
        order: 1,
        materializedMarkdown: 'Chosen approach',
      },
      {
        id: 'section-3',
        key: 'consequences',
        order: 2,
        materializedMarkdown: 'Impacts',
      },
      {
        id: 'section-4',
        key: 'statusNotes',
        order: 3,
        materializedMarkdown: 'Accepted',
      },
    ],
  };

  const designDocLinkResponse: DesignDocLinkResponseDto = {
    id: linkId,
    designDocId,
    organizationId,
    entityType: 'task',
    entityId: 'task_123',
    linkType: 'context',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    proposalService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DesignDocController],
      providers: [
        {
          provide: ProjectAccessService,
          useValue: {
            assertOrganization: jest.fn(),
            accessibleProjectIds: jest
              .fn()
              .mockResolvedValue(['allowed-project']),
          },
        },
        {
          provide: ProjectResourceAccessService,
          useValue: { assertResource: jest.fn() },
        },
        {
          provide: DesignDocService,
          useValue: {
            findAllForAdapter: jest.fn(),
            createForAdapter: jest.fn(),
            findOneForAdapter: jest.fn(),
            updateForAdapter: jest.fn(),
            removeForAdapter: jest.fn(),
            restoreForAdapter: jest.fn(),
            getLinksForAdapter: jest.fn(),
            createLinksForAdapter: jest.fn(),
            removeLinkForAdapter: jest.fn(),
            getLibraryForAdapter: jest.fn(),
          },
        },
        {
          provide: ProposalService,
          useValue: proposalService,
        },
      ],
    }).compile();

    controller = module.get<DesignDocController>(DesignDocController);
    designDocService = module.get(DesignDocService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('findAll', () => {
    it('passes filters to the service', async () => {
      designDocService.findAllForAdapter.mockResolvedValue([designDocResponse]);

      const result = await controller.findAll(
        'caller',
        organizationId,
        'ADR_CONTEXT',
        projectId,
        'tag-a,tag-b',
        '2',
        '25',
        'CLASSIC',
        undefined,
      );

      expect(designDocService.findAllForAdapter).toHaveBeenCalledWith(
        organizationId,
        expect.objectContaining({
          status: 'ADR_CONTEXT',
          projectId,
          tags: ['tag-a', 'tag-b'],
          page: 2,
          limit: 25,
          template: 'CLASSIC',
        }),
      );
      expect(result).toEqual([designDocResponse]);
    });

    it('handles missing optional filters', async () => {
      designDocService.findAllForAdapter.mockResolvedValue([]);

      await controller.findAll(
        'caller',
        organizationId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(designDocService.findAllForAdapter).toHaveBeenCalledWith(
        organizationId,
        expect.objectContaining({
          status: undefined,
          projectId: undefined,
          tags: undefined,
          page: undefined,
          limit: undefined,
          template: undefined,
        }),
      );
    });

    it('passes link filters and section keys to the service', async () => {
      designDocService.findAllForAdapter.mockResolvedValue([]);

      await controller.findAll(
        'caller',
        organizationId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'context,decision',
        'task-123',
        undefined,
        undefined,
      );

      expect(designDocService.findAllForAdapter).toHaveBeenCalledWith(
        organizationId,
        expect.objectContaining({
          taskId: 'task-123',
          includeSectionKeys: ['context', 'decision'],
        }),
      );
    });
  });

  describe('getLibrary', () => {
    it('throws when projectId is missing', async () => {
      await expect(
        controller.getLibrary(organizationId, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('delegates to the service with projectId', async () => {
      const library: DesignDocLibraryNodeDto[] = [
        {
          type: 'plan',
          id: 'plan-1',
          name: 'Plan Alpha',
          children: [],
        },
      ];

      designDocService.getLibraryForAdapter.mockResolvedValue(library);

      const result = await controller.getLibrary(organizationId, projectId);

      expect(designDocService.getLibraryForAdapter).toHaveBeenCalledWith(
        organizationId,
        projectId,
      );
      expect(result).toEqual(library);
    });
  });

  describe('getLinks', () => {
    it('returns links provided by the service', async () => {
      designDocService.getLinksForAdapter.mockResolvedValue([
        designDocLinkResponse,
      ]);

      const result = await controller.getLinks(designDocId, organizationId);

      expect(result).toEqual([designDocLinkResponse]);
      expect(designDocService.getLinksForAdapter).toHaveBeenCalledWith(
        designDocId,
        organizationId,
        false,
      );
    });
  });

  describe('createLinks', () => {
    it('delegates single link payload to the service', async () => {
      const payload: CreateDesignDocLinkDto = {
        entityType: 'task',
        entityId: 'task_123',
        linkType: 'context',
      };

      designDocService.createLinksForAdapter.mockResolvedValue([
        designDocLinkResponse,
      ]);

      const result = await controller.createLinks(
        designDocId,
        payload,
        organizationId,
      );

      expect(designDocService.createLinksForAdapter).toHaveBeenCalledWith(
        designDocId,
        payload,
        organizationId,
      );
      expect(result).toEqual([designDocLinkResponse]);
    });

    it('passes arrays through to the service unchanged', async () => {
      const payload: CreateDesignDocLinkDto[] = [
        {
          entityType: 'task',
          entityId: 'task_123',
          linkType: 'context',
        },
        { entityType: 'design-doc', entityId: 'design_doc_456' },
      ];

      designDocService.createLinksForAdapter.mockResolvedValue([
        designDocLinkResponse,
      ]);

      await controller.createLinks(designDocId, payload, organizationId);

      expect(designDocService.createLinksForAdapter).toHaveBeenCalledWith(
        designDocId,
        payload,
        organizationId,
      );
    });
  });

  describe('deleteLink', () => {
    it('returns the removed link from the service', async () => {
      designDocService.removeLinkForAdapter.mockResolvedValue(
        designDocLinkResponse,
      );

      const result = await controller.deleteLink(
        designDocId,
        linkId,
        organizationId,
      );

      expect(designDocService.removeLinkForAdapter).toHaveBeenCalledWith(
        designDocId,
        linkId,
        organizationId,
      );
      expect(result).toEqual(designDocLinkResponse);
    });
  });

  describe('create', () => {
    it('delegates to the service with normalized payload', async () => {
      designDocService.createForAdapter.mockResolvedValue(designDocResponse);
      const payload: CreateDesignDocDto = {
        name: 'New Doc',
        template: 'ADR',
        sections: [
          { key: 'context', order: 0, content: 'Problem statement' },
          { key: 'decision', order: 1, content: 'Decision text' },
        ],
      };

      const result = await controller.create(payload, organizationId);

      expect(designDocService.createForAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Doc',
          sections: expect.arrayContaining([
            expect.objectContaining({
              key: 'context',
              content: 'Problem statement',
            }),
          ]),
          tags: [],
        }),
        organizationId,
      );
      expect(result).toEqual(designDocResponse);
    });
  });

  describe('findOne', () => {
    it('returns the design document when found', async () => {
      designDocService.findOneForAdapter.mockResolvedValue(designDocResponse);

      const result = await controller.findOne(
        designDocResponse.id,
        organizationId,
      );

      expect(result).toBe(designDocResponse);
      expect(designDocService.findOneForAdapter).toHaveBeenCalledWith(
        designDocResponse.id,
        organizationId,
      );
    });

    it('throws NotFoundException when the document is missing', async () => {
      designDocService.findOneForAdapter.mockResolvedValue(null);

      await expect(
        controller.findOne('missing', organizationId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects a PATCH body that carries only `reason` and no real fields to change', async () => {
      await expect(
        controller.update(
          designDocResponse.id,
          { reason: 'just explaining myself' } as UpdateDesignDocDto,
          organizationId,
          authUser,
          buildFakeRequest(),
        ),
      ).rejects.toThrow(BadRequestException);

      expect(proposalService.create).not.toHaveBeenCalled();
      expect(designDocService.findOneForAdapter).not.toHaveBeenCalled();
    });

    it('returns APPLIED with the updated design doc when the proposal auto-applies', async () => {
      designDocService.findOneForAdapter.mockResolvedValue(designDocResponse);
      proposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );

      const result = await controller.update(
        designDocResponse.id,
        { name: 'Updated name', tags: ['refined'] },
        organizationId,
        authUser,
        buildFakeRequest(),
      );

      expect(result).toEqual({
        status: 'APPLIED',
        designDoc: designDocResponse,
      });
      const dto = proposalService.create.mock.calls[0][3] as {
        action: string;
        eli5: string;
        targetEntityType: string;
        targetEntityId: string;
        updates: Record<string, unknown>;
      };
      expect(dto.action).toBe('UPDATE');
      expect(dto.eli5).toBe("Changes this design doc's name, tags.");
      expect(dto.targetEntityType).toBe('DESIGN_DOC');
      expect(dto.targetEntityId).toBe(designDocResponse.id);
      // Proposal is scoped to the doc's own project (no projectId path param).
      expect(proposalService.create.mock.calls[0][1]).toBe(projectId);
    });

    it('returns PENDING with the unchanged design doc and the proposal payload when held for review', async () => {
      designDocService.findOneForAdapter.mockResolvedValue(designDocResponse);
      const pending = buildProposalResponse({
        status: 'PROPOSED' as ProposalStatus,
      });
      proposalService.create.mockResolvedValue(pending);

      const result = await controller.update(
        designDocResponse.id,
        { name: 'Updated name' },
        organizationId,
        authUser,
        buildFakeRequest(),
      );

      expect(result.status).toBe('PENDING');
      expect(result.designDoc).toEqual(designDocResponse);
      expect(result.proposal).toBe(pending);
    });

    it('attaches a USER influence carrying the trimmed reason; reason never leaks into updates', async () => {
      designDocService.findOneForAdapter.mockResolvedValue(designDocResponse);
      proposalService.create.mockResolvedValue(buildProposalResponse());

      await controller.update(
        designDocResponse.id,
        {
          name: 'Updated name',
          reason: '  scope shifted  ',
        } as UpdateDesignDocDto,
        organizationId,
        authUser,
        buildFakeRequest(),
      );

      const dto = proposalService.create.mock.calls[0][3] as {
        updates: Record<string, unknown>;
        influences: Array<Record<string, unknown>>;
        requestorContext: { source?: string };
      };
      expect(dto.influences).toEqual([
        {
          entityId: authUser.userId,
          entityType: 'USER',
          reasonType: 'user_reason',
          reasoning: 'scope shifted',
        },
      ]);
      expect(dto.updates.reason).toBeUndefined();
      expect(dto.updates.name).toBe('Updated name');
      // requestorContext is server-stamped from the authenticated user.
      expect(dto.requestorContext.source).toBe('user');
    });

    it('attaches a USER influence with empty reasoning when no reason text is supplied', async () => {
      designDocService.findOneForAdapter.mockResolvedValue(designDocResponse);
      proposalService.create.mockResolvedValue(buildProposalResponse());

      await controller.update(
        designDocResponse.id,
        { status: 'READY' },
        organizationId,
        authUser,
        buildFakeRequest(),
      );

      const dto = proposalService.create.mock.calls[0][3] as {
        influences: Array<Record<string, unknown>>;
      };
      expect(dto.influences).toEqual([
        {
          entityId: authUser.userId,
          entityType: 'USER',
          reasonType: 'user_reason',
          reasoning: '',
        },
      ]);
    });

    it('forwards parentEntityId/parentEntityType into the proposal updates for reparent requests', async () => {
      designDocService.findOneForAdapter.mockResolvedValue(designDocResponse);
      proposalService.create.mockResolvedValue(buildProposalResponse());

      await controller.update(
        designDocResponse.id,
        { parentEntityId: 'parent-task-id', parentEntityType: 'TASK' },
        organizationId,
        authUser,
        buildFakeRequest(),
      );

      const dto = proposalService.create.mock.calls[0][3] as {
        updates: Record<string, unknown>;
      };
      expect(dto.updates).toMatchObject({
        parentEntityId: 'parent-task-id',
        parentEntityType: 'TASK',
      });
    });

    it('throws NotFoundException when the design doc does not exist', async () => {
      designDocService.findOneForAdapter.mockResolvedValue(null);

      await expect(
        controller.update(
          designDocResponse.id,
          { name: 'Updated name' },
          organizationId,
          authUser,
          buildFakeRequest(),
        ),
      ).rejects.toThrow(NotFoundException);

      expect(proposalService.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('archives the design document', async () => {
      designDocService.removeForAdapter.mockResolvedValue(designDocResponse);

      const result = await controller.remove(
        designDocResponse.id,
        organizationId,
      );

      expect(designDocService.removeForAdapter).toHaveBeenCalledWith(
        designDocResponse.id,
        organizationId,
      );
      expect(result).toEqual(designDocResponse);
    });
  });

  describe('restore', () => {
    it('restores the design document', async () => {
      designDocService.restoreForAdapter.mockResolvedValue(designDocResponse);

      const result = await controller.restore(
        designDocResponse.id,
        organizationId,
      );

      expect(designDocService.restoreForAdapter).toHaveBeenCalledWith(
        designDocResponse.id,
        organizationId,
      );
      expect(result).toEqual(designDocResponse);
    });
  });
});
