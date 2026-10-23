import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectResourceAccessService } from 'src/auth/services/project-resource-access.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ImplementationHintController } from '../implementation-hint.controller';
import { ImplementationHintService } from '../../services/service/implementation-hint.service';

describe('ImplementationHintController', () => {
  let controller: ImplementationHintController;
  const mockService = {
    findAll: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    appendVersion: jest.fn(),
    listOrganizationVersions: jest.fn(),
    listVersions: jest.fn(),
    createFileReference: jest.fn(),
    listFileReferences: jest.fn(),
    updateFileReference: jest.fn(),
    getFileReference: jest.fn(),
    queryFileReferences: jest.fn(),
    deleteFileReference: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImplementationHintController],
      providers: [
        {
          provide: ProjectAccessService,
          useValue: {
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
          provide: ImplementationHintService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ImplementationHintController>(
      ImplementationHintController,
    );
    jest.clearAllMocks();
  });

  it('delegates findAll to the service with extended filters', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.findAll(
      'caller',
      'org-1' as any,
      'service-1',
      'agent-session-1',
      'src/app.ts',
      'prefix',
      'true',
      '2',
      '10',
      '0.8',
      'AGENT',
    );

    expect(mockService.findAll).toHaveBeenCalledWith('org-1', 'service-1', {
      accessibleProjectIds: ['allowed-project'],
      agentSessionId: 'agent-session-1',
      filePath: 'src/app.ts',
      filePathMatch: 'prefix',
      latest: true,
      page: 2,
      size: 10,
      confidence: 0.8,
      extractedFrom: 'AGENT',
    });
  });

  it('delegates create to the service', async () => {
    mockService.create.mockResolvedValue({ id: 'hint-1' });

    const result = await controller.create(
      {
        serviceId: 'service-1',
        agentSessionId: 'agent-session-1',
        featureName: 'Auth',
        description: 'Use JWT guard',
        sourceType: 'USER',
      },
      'org-1' as any,
    );

    expect(mockService.create).toHaveBeenCalledWith(
      'org-1',
      expect.any(Object),
    );
    expect(result.id).toBe('hint-1');
  });

  it('delegates findOne with latest flag', async () => {
    mockService.findOne.mockResolvedValue({ id: 'hint-1' });

    const result = await controller.findOne(
      'hint-1',
      'org-1' as any,
      'service-1',
      'true',
    );

    expect(mockService.findOne).toHaveBeenCalledWith(
      'org-1',
      'hint-1',
      'service-1',
      true,
    );
    expect(result.id).toBe('hint-1');
  });

  it('delegates appendVersion', async () => {
    mockService.appendVersion.mockResolvedValue({ id: 'hint-1' });

    const result = await controller.appendVersion(
      'hint-1',
      {
        expectedVersion: 2,
        hint: 'Prefer transaction boundary in service',
        extractedFrom: 'AGENT',
      },
      'org-1' as any,
      'service-1',
    );

    expect(mockService.appendVersion).toHaveBeenCalledWith(
      'org-1',
      'hint-1',
      expect.any(Object),
      'service-1',
    );
    expect(result.id).toBe('hint-1');
  });

  it('delegates appendVersionAtOpenApiRoute', async () => {
    mockService.appendVersion.mockResolvedValue({
      id: 'hint-1',
      latestVersion: { id: 'ver-3' },
    });

    const result = await controller.appendVersionAtOpenApiRoute(
      'hint-1',
      {
        expectedVersion: 2,
        hint: 'Prefer transaction boundary in service',
        extractedFrom: 'AGENT',
      },
      'org-1' as any,
      'service-1',
    );

    expect(mockService.appendVersion).toHaveBeenCalledWith(
      'org-1',
      'hint-1',
      expect.any(Object),
      'service-1',
    );
    expect(result.id).toBe('ver-3');
  });

  it('delegates listOrganizationVersions', async () => {
    mockService.listOrganizationVersions.mockResolvedValue([]);

    await controller.listOrganizationVersions(
      'caller',
      'org-1' as any,
      'service-1',
      'src/',
      'prefix',
      'true',
      '1',
      '50',
      '0.8',
      'AGENT',
    );

    expect(mockService.listOrganizationVersions).toHaveBeenCalledWith('org-1', {
      accessibleProjectIds: ['allowed-project'],
      serviceId: 'service-1',
      filePath: 'src/',
      filePathMatch: 'prefix',
      latest: true,
      page: 1,
      size: 50,
      confidence: 0.8,
      extractedFrom: 'AGENT',
    });
  });

  it('delegates listVersions', async () => {
    mockService.listVersions.mockResolvedValue([]);

    await controller.listVersions(
      'hint-1',
      'org-1' as any,
      'service-1',
      'false',
    );

    expect(mockService.listVersions).toHaveBeenCalledWith(
      'org-1',
      'hint-1',
      false,
      'service-1',
    );
  });

  it('delegates file reference endpoints', async () => {
    mockService.createFileReference.mockResolvedValue({ id: 'ref-1' });
    mockService.listFileReferences.mockResolvedValue([{ id: 'ref-1' }]);
    mockService.getFileReference.mockResolvedValue({ id: 'ref-1' });
    mockService.updateFileReference.mockResolvedValue({ id: 'ref-2' });
    mockService.queryFileReferences.mockResolvedValue([{ id: 'ref-1' }]);

    const created = await controller.createFileReference(
      'hint-1',
      { filePath: 'src/app.ts', startLine: 1, endLine: 10 },
      'org-1' as any,
      'service-1',
    );

    const listed = await controller.listFileReferences(
      'hint-1',
      'org-1' as any,
      'service-1',
      'src/',
      'prefix',
      '1',
      '25',
    );

    const retrieved = await controller.getFileReference(
      'hint-1',
      'ref-1',
      'org-1' as any,
      'service-1',
    );
    const updated = await controller.updateFileReference(
      'hint-1',
      'ref-1',
      { startLine: 2, endLine: 20 },
      'org-1' as any,
      'service-1',
    );

    const queried = await controller.queryFileReferences(
      'caller',
      {
        serviceId: 'service-1',
        filePath: 'src/',
      },
      'org-1' as any,
    );

    await controller.removeFileReference(
      'hint-1',
      'ref-1',
      'org-1' as any,
      'service-1',
    );

    expect(created.id).toBe('ref-1');
    expect(listed).toHaveLength(1);
    expect(retrieved.id).toBe('ref-1');
    expect(updated.id).toBe('ref-2');
    expect(queried).toHaveLength(1);
    expect(mockService.queryFileReferences).toHaveBeenCalledWith(
      'org-1',
      {
        serviceId: 'service-1',
        filePath: 'src/',
      },
      ['allowed-project'],
    );
    expect(mockService.deleteFileReference).toHaveBeenCalledWith(
      'org-1',
      'hint-1',
      'ref-1',
      'service-1',
    );
  });

  it('delegates update and remove', async () => {
    mockService.update.mockResolvedValue({ id: 'hint-1' });
    mockService.remove.mockResolvedValue(undefined);

    const result = await controller.update(
      'hint-1',
      { serviceId: 'service-1', description: 'Updated' },
      'org-1' as any,
    );

    await controller.remove('hint-1', 'org-1' as any);

    expect(mockService.update).toHaveBeenCalledWith(
      'org-1',
      'hint-1',
      expect.any(Object),
    );
    expect(mockService.remove).toHaveBeenCalledWith('org-1', 'hint-1');
    expect(result.id).toBe('hint-1');
  });
});
