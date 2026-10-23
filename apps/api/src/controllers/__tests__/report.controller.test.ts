import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectResourceAccessService } from 'src/auth/services/project-resource-access.service';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FileTouchServiceHistorySortBy,
  FileTouchServiceHistorySortOrder,
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportSortBy,
  ReportSortOrder,
  ReportType,
} from 'src/generated';
import {
  ProjectReportsController,
  ReportController,
} from '../report.controller';
import { ReportService } from '../../services/reports/report.service';

describe('ReportController', () => {
  let controller: ReportController;
  const mockService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportController],
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
          provide: ReportService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ReportController>(ReportController);
    jest.clearAllMocks();
  });

  it('delegates create to the service', async () => {
    mockService.create.mockResolvedValue({ id: 'report-1' });

    const result = await controller.create(
      {
        reportType: ReportType.CodingResearch,
        audience: ReportAudience.WorkflowOnly,
        payload: {
          reportType: 'CODING_RESEARCH',
          summary: 'ok',
          analysis: '',
          frame: {},
          provenance: { discoveryCalls: [], edgesTraversed: [] },
          updates: [],
        },
      },
      'org-1' as any,
      'caller-1' as any,
    );

    expect(mockService.create).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        reportType: ReportType.CodingResearch,
      }),
      undefined,
      'caller-1',
    );
    expect(result.id).toBe('report-1');
  });

  it('passes the run Agent Session through IMPLEMENT creation and returns action guidance unchanged', async () => {
    mockService.create.mockResolvedValue({
      id: 'report-1',
      reportGuidance: { actions: [] },
    });

    const result = await controller.create(
      {
        reportType: ReportType.Implement,
        audience: ReportAudience.WorkflowOnly,
        payload: {
          reportType: 'IMPLEMENT',
          summary: 'The report persistence boundary returns action guidance.',
          filesChanged: ['src/services/reports/report.service.ts'],
        },
      },
      '11111111-1111-4111-8111-111111111111' as any,
      'caller-1' as any,
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    );

    expect(mockService.create).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        reportType: ReportType.Implement,
        projectId: '22222222-2222-4222-8222-222222222222',
        sourceExecutionId: '33333333-3333-4333-8333-333333333333',
        entities: [
          {
            entityType: ReportRelatedEntityType.AgentSession,
            entityId: '33333333-3333-4333-8333-333333333333',
            relation: ReportEntityRelation.Context,
          },
          {
            entityType: ReportRelatedEntityType.Conversation,
            entityId: '44444444-4444-4444-8444-444444444444',
            relation: ReportEntityRelation.Context,
          },
        ],
      }),
      '44444444-4444-4444-8444-444444444444',
      'caller-1',
    );
    expect(result.reportGuidance).toEqual({
      actions: [],
    });
  });

  it('delegates list with parsed filters', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.findAll(
      'caller',
      'org-1' as any,
      'project-1',
      ReportType.CodingResearch,
      ReportAudience.ProjectVisible,
      'exec-1',
      ReportRelatedEntityType.Task,
      'task-1',
      ReportEntityRelation.Primary,
      undefined,
      'true',
      '10',
    );

    expect(mockService.findAll).toHaveBeenCalledWith('org-1', {
      accessibleProjectIds: ['allowed-project'],
      projectId: 'project-1',
      reportType: ReportType.CodingResearch,
      audience: ReportAudience.ProjectVisible,
      sourceExecutionId: 'exec-1',
      entityType: ReportRelatedEntityType.Task,
      entityId: 'task-1',
      relation: ReportEntityRelation.Primary,
      includeExpired: true,
      limit: 10,
    });
  });

  it('forwards sortBy and sortOrder query params to the service', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.findAll(
      'caller',
      'org-1' as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '1',
      ReportSortBy.CreatedAt,
      ReportSortOrder.Desc,
    );

    expect(mockService.findAll).toHaveBeenCalledWith('org-1', {
      accessibleProjectIds: ['allowed-project'],
      limit: 1,
      sortBy: ReportSortBy.CreatedAt,
      sortOrder: ReportSortOrder.Desc,
    });
  });

  it('rejects invalid includeExpired value', async () => {
    await expect(
      controller.findAll(
        'caller',
        'org-1' as any,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'yes',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('delegates findOne and remove', async () => {
    mockService.findOne.mockResolvedValue({ id: 'report-1' });
    mockService.remove.mockResolvedValue(undefined);

    const result = await controller.findOne('report-1', 'org-1' as any);
    await controller.remove('report-1', 'org-1' as any);

    expect(result.id).toBe('report-1');
    expect(mockService.findOne).toHaveBeenCalledWith('org-1', 'report-1');
    expect(mockService.remove).toHaveBeenCalledWith('org-1', 'report-1');
  });

  it('delegates update to the service', async () => {
    mockService.update.mockResolvedValue({ id: 'report-1', version: 2 });

    const result = await controller.update(
      'report-1',
      {
        payload: {
          reportType: 'CODING_RESEARCH',
          summary: 'updated',
          analysis: '',
          frame: {},
          provenance: { discoveryCalls: [], edgesTraversed: [] },
          updates: [],
        },
      },
      'org-1' as any,
    );

    expect(mockService.update).toHaveBeenCalledWith('org-1', 'report-1', {
      payload: {
        reportType: 'CODING_RESEARCH',
        summary: 'updated',
        analysis: '',
        frame: {},
        provenance: { discoveryCalls: [], edgesTraversed: [] },
        updates: [],
      },
    });
    expect(result.version).toBe(2);
  });
});

describe('ProjectReportsController', () => {
  let controller: ProjectReportsController;
  const mockService = {
    findAll: jest.fn(),
    listFileHistoryByFile: jest.fn(),
    listFileHistoryByService: jest.fn(),
    listFileHistoryByWork: jest.fn(),
    listFileTouchesByFile: jest.fn(),
    listFileTouchesByWork: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectReportsController],
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
          provide: ReportService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ProjectReportsController>(ProjectReportsController);
    jest.clearAllMocks();
  });

  it('forwards a repeated types[] query as reportTypes and includes projectId', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.listProjectReports('org-1' as any, 'project-1', [
      ReportType.Implement,
      ReportType.Plan,
    ]);

    expect(mockService.findAll).toHaveBeenCalledWith('org-1', {
      projectId: 'project-1',
      reportTypes: [ReportType.Implement, ReportType.Plan],
    });
  });

  it('forwards a single types value as a one-element reportTypes array', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.listProjectReports(
      'org-1' as any,
      'project-1',
      ReportType.Implement,
    );

    expect(mockService.findAll).toHaveBeenCalledWith('org-1', {
      projectId: 'project-1',
      reportTypes: [ReportType.Implement],
    });
  });

  it('omits reportTypes when types[] is not supplied', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.listProjectReports('org-1' as any, 'project-1');

    expect(mockService.findAll).toHaveBeenCalledWith('org-1', {
      projectId: 'project-1',
    });
  });

  it('delegates file-to-work lookups to the service', async () => {
    mockService.listFileTouchesByFile.mockResolvedValue({ entries: [] });

    await controller.listFileTouchesByFile(
      'org-1' as any,
      'project-1',
      'service-1',
      './src/index.ts',
    );

    expect(mockService.listFileTouchesByFile).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      serviceId: 'service-1',
      path: './src/index.ts',
    });
  });

  it('delegates work-to-file lookups to the service', async () => {
    mockService.listFileTouchesByWork.mockResolvedValue({ candidates: [] });

    await controller.listFileTouchesByWork(
      'org-1' as any,
      'project-1',
      ReportRelatedEntityType.Task,
      'task-1',
      undefined,
      'service-1',
    );

    expect(mockService.listFileTouchesByWork).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      entityType: ReportRelatedEntityType.Task,
      entityId: 'task-1',
      serviceId: 'service-1',
    });
  });

  it('delegates feature-attributed file lookups with featureId', async () => {
    mockService.listFileTouchesByWork.mockResolvedValue({ candidates: [] });

    await controller.listFileTouchesByWork(
      'org-1' as any,
      'project-1',
      undefined,
      undefined,
      'feature-1',
      'service-1',
    );

    expect(mockService.listFileTouchesByWork).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      entityType: undefined,
      entityId: undefined,
      featureId: 'feature-1',
      serviceId: 'service-1',
    });
  });

  it('delegates production reverse file history with project, service, and path identity', async () => {
    mockService.listFileHistoryByFile.mockResolvedValue({ tasks: [] });

    await controller.listFileHistoryByFile(
      'org-1' as any,
      'project-1',
      'service-1',
      './src/index.ts',
    );

    expect(mockService.listFileHistoryByFile).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      serviceId: 'service-1',
      path: './src/index.ts',
    });
  });

  it('validates and delegates the service file-history collection inputs', async () => {
    mockService.listFileHistoryByService.mockResolvedValue({
      files: [],
      nextCursor: null,
    });

    await controller.listFileHistoryByService(
      'org-1' as any,
      'project-1',
      'service-1',
      'src/',
      FileTouchServiceHistorySortBy.TouchCount,
      FileTouchServiceHistorySortOrder.Asc,
      'opaque-cursor',
      '25',
    );

    expect(mockService.listFileHistoryByService).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      serviceId: 'service-1',
      pathFilter: 'src/',
      sortBy: FileTouchServiceHistorySortBy.TouchCount,
      sortOrder: FileTouchServiceHistorySortOrder.Asc,
      cursor: 'opaque-cursor',
      limit: 25,
    });
  });

  it('delegates production focal task file history without changing candidate lookup parameters', async () => {
    mockService.listFileHistoryByWork.mockResolvedValue({
      kind: 'task',
      files: [],
    });

    await controller.listFileHistoryByWork(
      'org-1' as any,
      'project-1',
      ReportRelatedEntityType.Task,
      'task-1',
      undefined,
      'service-1',
    );

    expect(mockService.listFileHistoryByWork).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      entityType: ReportRelatedEntityType.Task,
      entityId: 'task-1',
      featureId: undefined,
      serviceId: 'service-1',
    });
    expect(mockService.listFileTouchesByWork).not.toHaveBeenCalled();
  });

  it('delegates production sectioned Feature history with the focal feature only', async () => {
    mockService.listFileHistoryByWork.mockResolvedValue({
      kind: 'feature',
      sections: [],
    });

    await controller.listFileHistoryByWork(
      'org-1' as any,
      'project-1',
      undefined,
      undefined,
      'feature-1',
    );

    expect(mockService.listFileHistoryByWork).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      entityType: undefined,
      entityId: undefined,
      featureId: 'feature-1',
    });
  });

  it('parses limit, offset, sortBy, and sortOrder and forwards them to the service', async () => {
    mockService.findAll.mockResolvedValue([]);

    await controller.listProjectReports(
      'org-1' as any,
      'project-1',
      undefined,
      '25',
      '50',
      ReportSortBy.CreatedAt,
      ReportSortOrder.Asc,
    );

    expect(mockService.findAll).toHaveBeenCalledWith('org-1', {
      projectId: 'project-1',
      limit: 25,
      offset: 50,
      sortBy: ReportSortBy.CreatedAt,
      sortOrder: ReportSortOrder.Asc,
    });
  });

  it('rejects a negative offset', async () => {
    await expect(
      controller.listProjectReports(
        'org-1' as any,
        'project-1',
        undefined,
        undefined,
        '-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
