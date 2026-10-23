import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectResourceAccessService } from 'src/auth/services/project-resource-access.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceLinkDto, ServiceTaskRelation } from '../../generated';
import { ServiceService } from '../../services/service/service.service';
import { testIds } from '../../utils/testUtils';
import { ServiceController } from '../service.controller';

describe('ServiceController', () => {
  let controller: ServiceController;
  let mockServiceService: jest.Mocked<
    Pick<
      ServiceService,
      'removeLink' | 'archive' | 'delete' | 'findOwningProjectId'
    >
  >;
  let mockProjectAccess: { assertProjectRoles: jest.Mock };

  beforeEach(async () => {
    mockServiceService = {
      removeLink: jest.fn(),
      archive: jest.fn(),
      delete: jest.fn(),
      findOwningProjectId: jest.fn(),
    };
    mockProjectAccess = { assertProjectRoles: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceController],
      providers: [
        { provide: ProjectAccessService, useValue: mockProjectAccess },
        { provide: ProjectResourceAccessService, useValue: {} },
        {
          provide: ServiceService,
          useValue: mockServiceService,
        },
      ],
    }).compile();

    controller = module.get<ServiceController>(ServiceController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('removeLink', () => {
    it('delegates with validated entityType and entityId', async () => {
      const relation: ServiceTaskRelation = {
        id: 'rel-1',
        serviceId: 'service-1',
        taskId: 'task-1',
        relationType: 'implements',
        createdAt: new Date().toISOString(),
      };
      mockServiceService.removeLink.mockResolvedValue(relation);

      const result = await controller.removeLink(
        'service-1',
        'task',
        'task-1',
        testIds.organization,
      );

      expect(mockServiceService.removeLink).toHaveBeenCalledWith(
        'service-1',
        testIds.organization,
        {
          entityType: ServiceLinkDto.EntityTypeEnum.Task,
          entityId: 'task-1',
        },
      );
      expect(result).toEqual(relation);
    });

    it('rejects requests missing entityType or entityId', async () => {
      await expect(
        controller.removeLink(
          'service-1',
          undefined,
          'task-1',
          testIds.organization,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        controller.removeLink(
          'service-1',
          'task',
          undefined,
          testIds.organization,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockServiceService.removeLink).not.toHaveBeenCalled();
    });

    it('rejects unsupported entityType values', async () => {
      await expect(
        controller.removeLink(
          'service-1',
          'unknown-type',
          'task-1',
          testIds.organization,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockServiceService.removeLink).not.toHaveBeenCalled();
    });
  });

  describe('service lifecycle', () => {
    it('authorizes archive against the owning project for Owner and Architect', async () => {
      mockServiceService.findOwningProjectId.mockResolvedValue(testIds.project);
      mockServiceService.archive.mockResolvedValue({
        id: 'service-1',
      } as never);

      await controller.archive('service-1', 'alice', testIds.organization);

      expect(mockProjectAccess.assertProjectRoles).toHaveBeenCalledWith(
        'alice',
        testIds.organization,
        testIds.project,
        ['OWNER', 'ARCHITECT'],
      );
      expect(mockServiceService.archive).toHaveBeenCalledWith(
        'service-1',
        testIds.organization,
      );
    });

    it('does not delete when the caller lacks the project role', async () => {
      mockServiceService.findOwningProjectId.mockResolvedValue(testIds.project);
      mockProjectAccess.assertProjectRoles.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        controller.delete('service-1', 'member', testIds.organization),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockServiceService.delete).not.toHaveBeenCalled();
    });

    it('rejects lifecycle changes for services without an owning project', async () => {
      mockServiceService.findOwningProjectId.mockResolvedValue(null);

      await expect(
        controller.archive('service-1', 'alice', testIds.organization),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockProjectAccess.assertProjectRoles).not.toHaveBeenCalled();
      expect(mockServiceService.archive).not.toHaveBeenCalled();
    });
  });
});
