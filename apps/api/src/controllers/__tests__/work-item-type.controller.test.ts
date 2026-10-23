import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { ProjectService } from '../../services/project.service';
import {
  WorkItemTypeGuidanceBatchRequestDto,
  WorkItemTypeGuidanceQueryDto,
} from '../work-item-type.controller';
import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
} from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { WorkItemTypeLifecycleStatus } from '../../generated/model/workItemTypeLifecycleStatus';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import { WorkItemTypeGuidancePurpose } from '../../generated/model/workItemTypeGuidancePurpose';
import type { WorkItemTypeSummaryDto } from '../../generated/model/workItemTypeSummaryDto';
import { WorkItemTypeEffectiveSource } from '../../generated/model/workItemTypeEffectiveSource';
import { WorkStatus } from '../../generated/model/workStatus';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ProposalService } from '../../services/proposal/proposal.service';
import {
  NIL_UUID,
  buildWorkItemTypeCreateProposal,
  buildWorkItemTypeArchiveProposal,
  buildWorkItemTypeCascadeDeleteProposal,
  buildWorkItemTypeEditProposal,
  buildWorkItemTypeResetProposal,
  buildWorkItemTypeRestoreProposal,
} from '../../services/proposal/work-item-type-proposal.builder';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { WorkItemTypeImpactService } from '../../services/tasks/work-item-type-impact.service';
import type { OrganizationId, ProjectId } from '../../types';
import { WorkItemTypeController } from '../work-item-type.controller';

const ORG_ID = '50e01076-bce8-4a65-b205-c5da8480e8fb' as OrganizationId;
const PROJECT_ID = '0fbfaeca-a381-4ff0-82ba-0bd772095e77' as ProjectId;

const user: AuthenticatedUser = {
  userId: '3b8a5b0e-33d7-4aa1-8b6f-dc362aa62597',
} as AuthenticatedUser;

function makeRequest(headers: Record<string, string> = {}): Request {
  return {
    headers: { 'user-agent': 'JestAgent/1.0', ...headers },
    ip: '127.0.0.1',
  } as unknown as Request;
}

const definition: WorkItemTypeDefinitionDto = {
  key: 'MARKETING',
  name: 'Marketing',
  role: 'work-item',
  sections: [
    {
      key: 'audience',
      label: 'Audience',
      kind: 'json',
      schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
    },
  ],
  allowedStatuses: [],
  capabilities: { showsInExplorerSidebar: true },
};

function summary(key: string): WorkItemTypeSummaryDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    definition: { ...definition, key, name: `${key} name` },
    status: WorkItemTypeLifecycleStatus.Active,
    projectId: PROJECT_ID,
    effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
  };
}

class SectionContentImpactQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? [value] : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  removedSectionKeys!: string[];
}

class TrackingLinkRevocationImpactQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? [value] : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  revokedTrackingSourceTypeKeys!: string[];
}

const queryPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

async function parseSectionQuery(query: Record<string, unknown>) {
  return queryPipe.transform(query, {
    type: 'query',
    metatype: SectionContentImpactQueryDto,
  }) as Promise<SectionContentImpactQueryDto>;
}

async function parseTrackingQuery(query: Record<string, unknown>) {
  return queryPipe.transform(query, {
    type: 'query',
    metatype: TrackingLinkRevocationImpactQueryDto,
  }) as Promise<TrackingLinkRevocationImpactQueryDto>;
}

describe('WorkItemTypeController', () => {
  let controller: WorkItemTypeController;
  const registry = {
    getGuidance: jest.fn(),
    getGuidanceBatch: jest.fn(),
    getDefinitions: jest.fn(),
    getDefinition: jest.fn(),
  };
  const projectService = { findOne: jest.fn() };
  const proposalService = {
    create: jest.fn(),
  };
  const impactService = {
    countCascadeImpact: jest.fn(),
    countSectionContentImpact: jest.fn(),
    countTrackingLinkRevocationImpact: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkItemTypeController],
      providers: [
        { provide: ProjectService, useValue: projectService },
        { provide: WorkItemTypeRegistryService, useValue: registry },
        { provide: ProposalService, useValue: proposalService },
        { provide: WorkItemTypeImpactService, useValue: impactService },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WorkItemTypeController);
    jest.clearAllMocks();
  });

  describe('semantic guidance', () => {
    it('authorizes the project before forwarding both type keys', async () => {
      projectService.findOne.mockResolvedValue({ id: PROJECT_ID });
      const guide = {
        typeKey: 'MARKETING',
        name: 'Marketing',
        overview: 'Meaning',
        examples: [],
      };
      registry.getGuidance.mockReturnValue(guide);
      await expect(
        controller.getGuidance(ORG_ID, PROJECT_ID, 'MARKETING', {
          focalTypeKey: 'FEATURE',
        }),
      ).resolves.toEqual(guide);
      expect(projectService.findOne).toHaveBeenCalledWith(PROJECT_ID, ORG_ID);
      expect(registry.getGuidance).toHaveBeenCalledWith(
        PROJECT_ID,
        'MARKETING',
        'FEATURE',
        undefined,
      );
    });

    it('forwards an explicit maintenance purpose', async () => {
      projectService.findOne.mockResolvedValue({ id: PROJECT_ID });
      const guide = { typeKey: 'MARKETING', name: 'Marketing' };
      registry.getGuidance.mockReturnValue(guide);
      await expect(
        controller.getGuidance(ORG_ID, PROJECT_ID, 'MARKETING', {
          purpose: WorkItemTypeGuidancePurpose.Maintenance,
        }),
      ).resolves.toEqual(guide);
      expect(registry.getGuidance).toHaveBeenCalledWith(
        PROJECT_ID,
        'MARKETING',
        undefined,
        WorkItemTypeGuidancePurpose.Maintenance,
      );
    });

    it('denies a project outside the authorized organization without reading guidance', async () => {
      projectService.findOne.mockResolvedValue(null);
      await expect(
        controller.getGuidance(ORG_ID, PROJECT_ID, 'MARKETING', {}),
      ).rejects.toThrow(NotFoundException);
      expect(registry.getGuidance).not.toHaveBeenCalled();
    });

    it('propagates unavailable guidance errors', async () => {
      projectService.findOne.mockResolvedValue({ id: PROJECT_ID });
      registry.getGuidance.mockImplementation(() => {
        throw new NotFoundException('Guidance unavailable');
      });
      await expect(
        controller.getGuidance(ORG_ID, PROJECT_ID, 'MARKETING', {}),
      ).rejects.toThrow('Guidance unavailable');
    });

    it.each([
      { focalTypeKey: '' },
      { focalTypeKey: ['FEATURE'] },
      { focalTypeKey: 1 },
      { purpose: 'unknown' },
      { extra: true },
    ])('rejects malformed query %j', async (query) => {
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      await expect(
        pipe.transform(query, {
          type: 'query',
          metatype: WorkItemTypeGuidanceQueryDto,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('batch guidance', () => {
    const request = {
      typeKeys: ['BUG', 'STANDARD'],
      focalTypeKey: 'FEATURE',
      purpose: WorkItemTypeGuidancePurpose.Semantic,
    };

    it('authorizes the project before forwarding the shared request', async () => {
      projectService.findOne.mockResolvedValue({ id: PROJECT_ID });
      const result = {
        results: [
          { typeKey: 'BUG', name: 'Bug', overview: 'Defects', examples: [] },
          {
            typeKey: 'STANDARD',
            name: 'Task',
            overview: 'Implementation work',
            examples: [],
          },
        ],
      };
      registry.getGuidanceBatch.mockReturnValue(result);

      await expect(
        controller.getGuidanceBatch(ORG_ID, PROJECT_ID, request),
      ).resolves.toEqual(result);
      expect(projectService.findOne).toHaveBeenCalledWith(PROJECT_ID, ORG_ID);
      expect(registry.getGuidanceBatch).toHaveBeenCalledWith(
        PROJECT_ID,
        request,
      );
    });

    it('denies an inaccessible project before reading the registry', async () => {
      projectService.findOne.mockResolvedValue(null);

      await expect(
        controller.getGuidanceBatch(ORG_ID, PROJECT_ID, request),
      ).rejects.toThrow(NotFoundException);
      expect(registry.getGuidanceBatch).not.toHaveBeenCalled();
    });

    it('validates the contract bounds and distinct keys at the REST boundary', async () => {
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      const transform = (body: unknown) =>
        pipe.transform(body, {
          type: 'body',
          metatype: WorkItemTypeGuidanceBatchRequestDto,
        });

      await expect(
        transform({
          typeKeys: Array.from({ length: 10 }, (_, i) => `TYPE_${i}`),
        }),
      ).resolves.toMatchObject({ typeKeys: expect.any(Array) });
      for (const body of [
        { typeKeys: [] },
        { typeKeys: Array.from({ length: 11 }, (_, i) => `TYPE_${i}`) },
        { typeKeys: ['BUG', 'BUG'] },
        { typeKeys: ['BUG'], extra: true },
      ]) {
        await expect(transform(body)).rejects.toThrow(BadRequestException);
      }
    });
  });

  describe('findMany', () => {
    it('forwards the project scope and optional status to the registry', () => {
      const rows = [summary('STANDARD'), summary('MARKETING')];
      registry.getDefinitions.mockReturnValue(rows);

      const result = controller.findMany(PROJECT_ID, {
        status: WorkItemTypeLifecycleStatus.Active,
      });

      expect(registry.getDefinitions).toHaveBeenCalledWith(
        PROJECT_ID,
        WorkItemTypeLifecycleStatus.Active,
      );
      expect(result).toBe(rows);
    });

    it('passes undefined status when the query omits it', () => {
      registry.getDefinitions.mockReturnValue([]);
      controller.findMany(PROJECT_ID, {});
      expect(registry.getDefinitions).toHaveBeenCalledWith(
        PROJECT_ID,
        undefined,
      );
    });
  });

  describe('findOne', () => {
    it('returns the summary when the type exists', () => {
      const row = summary('MARKETING');
      registry.getDefinition.mockReturnValue(row);

      expect(controller.findOne(PROJECT_ID, 'MARKETING')).toBe(row);
      expect(registry.getDefinition).toHaveBeenCalledWith(
        PROJECT_ID,
        'MARKETING',
      );
    });

    it('throws the existing 404 response after a deleted type leaves the registry snapshot', () => {
      registry.getDefinition.mockReturnValue(undefined);
      expect(() =>
        controller.findOne(PROJECT_ID, 'DELETED_CUSTOM_TYPE'),
      ).toThrow(NotFoundException);
      expect(registry.getDefinition).toHaveBeenCalledWith(
        PROJECT_ID,
        'DELETED_CUSTOM_TYPE',
      );
    });
  });

  describe('create', () => {
    it('submits the shared WORK_ITEM_TYPE create envelope stamped source: user', async () => {
      const created = { id: 'proposal-1' };
      proposalService.create.mockResolvedValue(created);

      const result = await controller.create(
        user,
        ORG_ID,
        PROJECT_ID,
        definition,
        makeRequest(),
      );

      // The controller returns whatever the proposal pipeline resolves, untouched.
      expect(result).toBe(created);

      expect(proposalService.create).toHaveBeenCalledTimes(1);
      const [org, project, userId, dto] = proposalService.create.mock.calls[0];
      expect(org).toBe(ORG_ID);
      expect(project).toBe(PROJECT_ID);
      expect(userId).toBe(user.userId);

      // The envelope must be byte-for-byte the shared builder's output for the
      // same definition + stamped context — not just a subset of hardcoded
      // fields — so the form path stays identical to the agentic one.
      expect(dto).toEqual(
        buildWorkItemTypeCreateProposal({
          definition,
          requestorContext: dto.requestorContext,
        }),
      );

      expect(dto).toMatchObject({
        type: 'SINGLE',
        action: 'CREATE',
        targetEntityId: NIL_UUID,
        targetEntityType: 'WORK_ITEM_TYPE',
        title: 'Marketing',
        updates: definition,
        influences: [],
      });
      expect(dto.requestorContext).toMatchObject({
        source: 'user',
        userId: user.userId,
        organizationId: ORG_ID,
        toolName: 'POST /work-item-types',
      });
    });

    it('adds TASK to the entity-parent axis when that axis is omitted', async () => {
      proposalService.create.mockResolvedValue({ id: 'proposal-parented' });
      const parentedDefinition = {
        ...definition,
        allowedParentTypes: ['STANDARD'],
      };

      await controller.create(
        user,
        ORG_ID,
        PROJECT_ID,
        parentedDefinition,
        makeRequest(),
      );

      expect(proposalService.create.mock.calls[0][3].updates).toEqual({
        ...parentedDefinition,
        allowedParentEntityTypes: ['TASK'],
      });
    });

    it('submits a stable-key CREATE restoration review for an archived retained definition', async () => {
      const archived = {
        ...summary('MARKETING'),
        status: WorkItemTypeLifecycleStatus.Archived,
      };
      registry.getDefinition.mockReturnValue(archived);
      proposalService.create.mockResolvedValue({ id: 'proposal-restore' });

      await controller.create(
        user,
        ORG_ID,
        PROJECT_ID,
        archived.definition,
        makeRequest(),
      );

      const dto = proposalService.create.mock.calls[0][3];
      expect(dto).toEqual(
        buildWorkItemTypeRestoreProposal({
          typeKey: 'MARKETING',
          definition: archived.definition,
          requestorContext: dto.requestorContext,
        }),
      );
      expect(dto.action).toBe('CREATE');
      expect(dto.targetEntityId).toBe('MARKETING');
      expect(dto.updates).toBe(archived.definition);
    });
  });

  describe('lifecycle review entry', () => {
    it('submits an edit proposal only for an active custom type', async () => {
      const row = summary('MARKETING');
      registry.getDefinition.mockReturnValue(row);
      const created = { id: 'proposal-2' };
      proposalService.create.mockResolvedValue(created);

      await expect(
        controller.edit(
          user,
          ORG_ID,
          PROJECT_ID,
          'MARKETING',
          { definition: row.definition },
          makeRequest(),
        ),
      ).resolves.toBe(created);

      const dto = proposalService.create.mock.calls[0][3];
      expect(dto).toEqual(
        buildWorkItemTypeEditProposal({
          typeKey: 'MARKETING',
          definition: row.definition,
          requestorContext: dto.requestorContext,
        }),
      );
    });

    it('rejects an unacknowledged canonical edit as request validation', async () => {
      const row = {
        ...summary('STANDARD'),
        effectiveSource: WorkItemTypeEffectiveSource.Canonical,
      };
      registry.getDefinition.mockReturnValue(row);

      await expect(
        controller.edit(
          user,
          ORG_ID,
          PROJECT_ID,
          'STANDARD',
          { definition: row.definition },
          makeRequest(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(proposalService.create).not.toHaveBeenCalled();
    });

    it('preserves acknowledgement when submitting a canonical edit', async () => {
      const row = {
        ...summary('STANDARD'),
        effectiveSource: WorkItemTypeEffectiveSource.Canonical,
      };
      const created = { id: 'proposal-canonical-edit' };
      registry.getDefinition.mockReturnValue(row);
      proposalService.create.mockResolvedValue(created);

      await expect(
        controller.edit(
          user,
          ORG_ID,
          PROJECT_ID,
          'STANDARD',
          {
            definition: row.definition,
            acknowledgeCanonicalCustomization: true,
          },
          makeRequest(),
        ),
      ).resolves.toBe(created);

      const dto = proposalService.create.mock.calls[0][3];
      expect(dto).toEqual(
        buildWorkItemTypeEditProposal({
          typeKey: 'STANDARD',
          definition: row.definition,
          acknowledgeCanonicalCustomization: true,
          requestorContext: dto.requestorContext,
        }),
      );
    });

    it('submits authorable semantic edits for review', async () => {
      registry.getDefinition.mockReturnValue(summary('MARKETING'));
      proposalService.create.mockResolvedValue({ id: 'proposal-3' });

      await controller.edit(
        user,
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        {
          definition: {
            ...definition,
            name: 'Campaign',
            allowedStatuses: [WorkStatus.Active],
          },
        },
        makeRequest(),
      );

      expect(proposalService.create).toHaveBeenCalledTimes(1);
    });

    it('submits an archive proposal for an active project-owned type', async () => {
      registry.getDefinition.mockReturnValue(summary('MARKETING'));
      proposalService.create.mockResolvedValue({ id: 'proposal-3' });

      await controller.archive(
        user,
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        { reason: 'No longer needed' },
        makeRequest(),
      );

      const dto = proposalService.create.mock.calls[0][3];
      expect(dto).toEqual(
        buildWorkItemTypeArchiveProposal({
          typeKey: 'MARKETING',
          request: { reason: 'No longer needed' },
          requestorContext: dto.requestorContext,
        }),
      );
      expect(impactService.countCascadeImpact).not.toHaveBeenCalled();
    });

    it('submits an archive proposal for an active canonical-seeded type', async () => {
      registry.getDefinition.mockReturnValue({
        ...summary('STANDARD'),
        effectiveSource: WorkItemTypeEffectiveSource.Canonical,
      });
      proposalService.create.mockResolvedValue({ id: 'proposal-canonical' });

      await expect(
        controller.archive(
          user,
          ORG_ID,
          PROJECT_ID,
          'STANDARD',
          { acknowledgeCanonicalCustomization: true },
          makeRequest(),
        ),
      ).resolves.toEqual({ id: 'proposal-canonical' });
      expect(proposalService.create).toHaveBeenCalledTimes(1);
    });

    it('submits reset-to-canonical only for a canonical override', async () => {
      registry.getDefinition.mockReturnValue({
        ...summary('STANDARD'),
        effectiveSource: WorkItemTypeEffectiveSource.CanonicalOverride,
      });
      proposalService.create.mockResolvedValue({ id: 'proposal-reset' });

      await expect(
        controller.reset(user, ORG_ID, PROJECT_ID, 'STANDARD', makeRequest()),
      ).resolves.toEqual({ id: 'proposal-reset' });

      const dto = proposalService.create.mock.calls[0][3];
      expect(dto).toEqual(
        buildWorkItemTypeResetProposal('STANDARD', dto.requestorContext),
      );
    });

    describe('role denial from the proposal boundary', () => {
      const denial = new ForbiddenException('Insufficient permissions');

      beforeEach(() => {
        proposalService.create.mockRejectedValue(denial);
      });

      it('surfaces the 403 when creating a type', async () => {
        registry.getDefinition.mockReturnValue(undefined);
        await expect(
          controller.create(
            user,
            ORG_ID,
            PROJECT_ID,
            definition,
            makeRequest(),
          ),
        ).rejects.toBe(denial);
      });

      it('surfaces the 403 when editing a type', async () => {
        const row = summary('MARKETING');
        registry.getDefinition.mockReturnValue(row);
        await expect(
          controller.edit(
            user,
            ORG_ID,
            PROJECT_ID,
            'MARKETING',
            { definition: row.definition },
            makeRequest(),
          ),
        ).rejects.toBe(denial);
      });

      it('surfaces the 403 when archiving a type', async () => {
        registry.getDefinition.mockReturnValue(summary('MARKETING'));
        await expect(
          controller.archive(
            user,
            ORG_ID,
            PROJECT_ID,
            'MARKETING',
            {},
            makeRequest(),
          ),
        ).rejects.toBe(denial);
      });

      it('surfaces the 403 when resetting a type', async () => {
        registry.getDefinition.mockReturnValue({
          ...summary('STANDARD'),
          effectiveSource: WorkItemTypeEffectiveSource.CanonicalOverride,
        });
        await expect(
          controller.reset(user, ORG_ID, PROJECT_ID, 'STANDARD', makeRequest()),
        ).rejects.toBe(denial);
      });
    });

    it.each([
      WorkItemTypeEffectiveSource.Canonical,
      WorkItemTypeEffectiveSource.ProjectCustom,
    ])('rejects reset for %s definitions', async (effectiveSource) => {
      registry.getDefinition.mockReturnValue({
        ...summary('STANDARD'),
        effectiveSource,
      });

      await expect(
        controller.reset(user, ORG_ID, PROJECT_ID, 'STANDARD', makeRequest()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(proposalService.create).not.toHaveBeenCalled();
    });

    it('submits a distinct cascade proposal for an archived custom type', async () => {
      registry.getDefinition.mockReturnValue({
        ...summary('MARKETING'),
        status: WorkItemTypeLifecycleStatus.Archived,
      });
      impactService.countCascadeImpact.mockResolvedValue({
        itemCount: 3,
        edgeCount: 5,
      });
      proposalService.create.mockResolvedValue({ id: 'cascade-proposal' });

      await controller.archive(
        user,
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        {},
        makeRequest(),
        {
          cascade: true,
          confirmedItemCount: 3,
          confirmedEdgeCount: 5,
        },
        'token',
      );

      expect(impactService.countCascadeImpact).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        'token',
      );
      const dto = proposalService.create.mock.calls[0][3];
      expect(dto).toEqual(
        buildWorkItemTypeCascadeDeleteProposal({
          typeKey: 'MARKETING',
          itemCount: 3,
          edgeCount: 5,
          requestorContext: dto.requestorContext,
        }),
      );
      expect(dto.updates).toEqual({
        operation: 'CASCADE_DELETE',
        cascade: true,
        typeKey: 'MARKETING',
        itemCount: 3,
        edgeCount: 5,
      });
    });

    it.each([
      ['missing', undefined, HttpStatus.NOT_FOUND],
      [
        'canonical',
        {
          ...summary('STANDARD'),
          canonicalTemplateKey: 'STANDARD',
        },
        HttpStatus.FORBIDDEN,
      ],
      ['active', summary('MARKETING'), HttpStatus.FORBIDDEN],
    ])(
      'rejects %s cascade targets before impact scans or review creation',
      async (_name, row, expectedStatus) => {
        registry.getDefinition.mockReturnValue(row);

        await expect(
          controller.archive(
            user,
            ORG_ID,
            PROJECT_ID,
            'MARKETING',
            {},
            makeRequest(),
            {
              cascade: true,
              confirmedItemCount: 0,
              confirmedEdgeCount: 0,
            },
            'token',
          ),
        ).rejects.toHaveProperty('status', expectedStatus);
        expect(impactService.countCascadeImpact).not.toHaveBeenCalled();
        expect(proposalService.create).not.toHaveBeenCalled();
      },
    );

    it('requires both confirmation counts for cascade review creation', async () => {
      registry.getDefinition.mockReturnValue({
        ...summary('MARKETING'),
        status: WorkItemTypeLifecycleStatus.Archived,
      });

      await expect(
        controller.archive(
          user,
          ORG_ID,
          PROJECT_ID,
          'MARKETING',
          {},
          makeRequest(),
          { cascade: true },
          'token',
        ),
      ).rejects.toHaveProperty('status', HttpStatus.BAD_REQUEST);
      expect(impactService.countCascadeImpact).not.toHaveBeenCalled();
      expect(proposalService.create).not.toHaveBeenCalled();
    });

    it('returns current impact when the confirmed cascade counts are stale', async () => {
      registry.getDefinition.mockReturnValue({
        ...summary('MARKETING'),
        status: WorkItemTypeLifecycleStatus.Archived,
      });
      impactService.countCascadeImpact.mockResolvedValue({
        itemCount: 4,
        edgeCount: 6,
      });

      await expect(
        controller.archive(
          user,
          ORG_ID,
          PROJECT_ID,
          'MARKETING',
          {},
          makeRequest(),
          {
            cascade: true,
            confirmedItemCount: 3,
            confirmedEdgeCount: 5,
          },
          'token',
        ),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: expect.objectContaining({
          data: { currentImpact: { itemCount: 4, edgeCount: 6 } },
        }),
      });
      expect(impactService.countCascadeImpact).toHaveBeenCalledTimes(1);
      expect(proposalService.create).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', undefined, HttpStatus.NOT_FOUND],
      [
        'archived',
        {
          ...summary('MARKETING'),
          status: WorkItemTypeLifecycleStatus.Archived,
        },
        HttpStatus.FORBIDDEN,
      ],
    ])(
      'rejects %s rows before creating review work',
      async (_name, row, expectedStatus) => {
        registry.getDefinition.mockReturnValue(row);

        await expect(
          controller.archive(
            user,
            ORG_ID,
            PROJECT_ID,
            'MARKETING',
            {},
            makeRequest(),
          ),
        ).rejects.toHaveProperty('status', expectedStatus);
        expect(proposalService.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('impact reads', () => {
    it('returns generated cascade impact for an archived custom type', async () => {
      registry.getDefinition.mockReturnValue({
        ...summary('MARKETING'),
        status: WorkItemTypeLifecycleStatus.Archived,
      });
      impactService.countCascadeImpact.mockResolvedValue({
        itemCount: 2,
        edgeCount: 4,
      });

      await expect(
        controller.countCascadeImpact(ORG_ID, PROJECT_ID, 'MARKETING', 'token'),
      ).resolves.toEqual({ itemCount: 2, edgeCount: 4 });
      expect(impactService.countCascadeImpact).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        'token',
      );
    });

    it.each([
      ['missing', undefined, HttpStatus.NOT_FOUND],
      [
        'canonical',
        {
          ...summary('STANDARD'),
          canonicalTemplateKey: 'STANDARD',
        },
        HttpStatus.FORBIDDEN,
      ],
      ['active', summary('MARKETING'), HttpStatus.FORBIDDEN],
    ])(
      'rejects %s cascade impact before scanning',
      async (_name, row, expectedStatus) => {
        registry.getDefinition.mockReturnValue(row);

        await expect(
          controller.countCascadeImpact(
            ORG_ID,
            PROJECT_ID,
            'MARKETING',
            'token',
          ),
        ).rejects.toHaveProperty('status', expectedStatus);
        expect(impactService.countCascadeImpact).not.toHaveBeenCalled();
      },
    );

    it('returns section content impact data for repeated section keys', async () => {
      registry.getDefinition.mockReturnValue(summary('MARKETING'));
      impactService.countSectionContentImpact.mockResolvedValue({
        totalAffectedItemCount: 2,
        sections: [{ sectionKey: 'audience', affectedItemCount: 2 }],
      });

      await expect(
        controller.countSectionContentImpact(ORG_ID, PROJECT_ID, 'MARKETING', {
          removedSectionKeys: ['audience', 'brief'],
        }),
      ).resolves.toEqual({
        data: {
          totalAffectedItemCount: 2,
          sections: [{ sectionKey: 'audience', affectedItemCount: 2 }],
        },
      });
      expect(impactService.countSectionContentImpact).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        ['audience', 'brief'],
      );
    });

    it('returns tracking revocation impact data with the user token', async () => {
      registry.getDefinition.mockReturnValue(summary('MARKETING'));
      impactService.countTrackingLinkRevocationImpact.mockResolvedValue({
        totalAffectedLinkCount: 1,
        sources: [{ sourceTypeKey: 'BUG', affectedLinkCount: 1 }],
      });

      await controller.countTrackingLinkRevocationImpact(
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        { revokedTrackingSourceTypeKeys: ['BUG'] },
        'token',
      );

      expect(
        impactService.countTrackingLinkRevocationImpact,
      ).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, 'MARKETING', ['BUG'], 'token');
    });
  });

  describe('impact query binding', () => {
    it('binds exploded generated-client section keys and returns non-zero impact', async () => {
      registry.getDefinition.mockReturnValue(summary('MARKETING'));
      impactService.countSectionContentImpact.mockResolvedValue({
        totalAffectedItemCount: 2,
        sections: [{ sectionKey: 'audience', affectedItemCount: 2 }],
      });

      const query = await parseSectionQuery({
        removedSectionKeys: ['audience', 'brief'],
      });
      const response = await controller.countSectionContentImpact(
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        query,
      );

      expect(response.data.totalAffectedItemCount).toBe(2);
      expect(impactService.countSectionContentImpact).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        ['audience', 'brief'],
      );
    });

    it('binds exploded generated-client tracking keys and returns non-zero impact', async () => {
      registry.getDefinition.mockReturnValue(summary('MARKETING'));
      impactService.countTrackingLinkRevocationImpact.mockResolvedValue({
        totalAffectedLinkCount: 1,
        sources: [{ sourceTypeKey: 'BUG', affectedLinkCount: 1 }],
      });

      const query = await parseTrackingQuery({
        revokedTrackingSourceTypeKeys: ['BUG', 'STANDARD'],
      });
      const response = await controller.countTrackingLinkRevocationImpact(
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        query,
        'token',
      );

      expect(response.data.totalAffectedLinkCount).toBe(1);
      expect(
        impactService.countTrackingLinkRevocationImpact,
      ).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        'MARKETING',
        ['BUG', 'STANDARD'],
        expect.any(String),
      );
    });

    it('rejects absent, empty, and duplicate canonical query keys', async () => {
      await expect(parseSectionQuery({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        parseSectionQuery({ removedSectionKeys: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        parseSectionQuery({
          removedSectionKeys: ['audience', 'audience'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        parseSectionQuery({ sectionKey: 'audience' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(parseTrackingQuery({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        parseTrackingQuery({ revokedTrackingSourceTypeKeys: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        parseTrackingQuery({
          revokedTrackingSourceTypeKeys: ['BUG', 'BUG'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        parseTrackingQuery({ targetTypeKey: 'BUG' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
