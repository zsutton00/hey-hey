import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { EntityContextService } from '../../services/entity-context/entity-context.service';
import * as TestUtils from '../../utils/testUtils';
import { ProjectFeaturesController } from '../entity-context.controller';

const { testIds } = TestUtils;

describe('ProjectFeaturesController — GET features/skeleton', () => {
  let app: INestApplication;
  let mockService: {
    getProjectFeaturesSkeleton: jest.Mock;
    listFeatures: jest.Mock;
  };
  const jwtGuard = { canActivate: jest.fn(() => true) };
  const orgGuard = { canActivate: jest.fn(() => true) };

  beforeAll(async () => {
    mockService = {
      getProjectFeaturesSkeleton: jest.fn(),
      listFeatures: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectFeaturesController],
      providers: [{ provide: EntityContextService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
      .overrideGuard(OrganizationGuard)
      .useValue(orgGuard)
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jwtGuard.canActivate.mockReturnValue(true);
    orgGuard.canActivate.mockReturnValue(true);
  });

  function url(projectId: string = testIds.project) {
    return (
      `/api/v1/organizations/${testIds.organization}` +
      `/projects/${projectId}/features/skeleton`
    );
  }

  const skeletonNode = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Alpha',
    tag: 'product',
    status: 'IN_PROGRESS',
    parentId: null,
    depth: 0,
    taskCount: 4,
  };

  it('routes to getProjectFeaturesSkeleton with the org and project id', async () => {
    mockService.getProjectFeaturesSkeleton.mockResolvedValue([skeletonNode]);

    const response = await request(app.getHttpServer() as App)
      .get(url())
      .expect(200);

    expect(mockService.getProjectFeaturesSkeleton).toHaveBeenCalledTimes(1);
    expect(mockService.getProjectFeaturesSkeleton).toHaveBeenCalledWith(
      testIds.organization,
      testIds.project,
    );
    // Body is the array directly — the response envelope is applied by the
    // global interceptor in production, which is out of scope here.
    expect(response.body).toEqual([skeletonNode]);
  });

  it('applies JwtAuthGuard and OrganizationGuard', async () => {
    mockService.getProjectFeaturesSkeleton.mockResolvedValue([]);

    await request(app.getHttpServer() as App)
      .get(url())
      .expect(200);

    expect(jwtGuard.canActivate).toHaveBeenCalled();
    expect(orgGuard.canActivate).toHaveBeenCalled();
  });

  it('rejects a malformed projectId via ParseUUIDPipe', async () => {
    await request(app.getHttpServer() as App)
      .get(url('not-a-uuid'))
      .expect(400);

    expect(mockService.getProjectFeaturesSkeleton).not.toHaveBeenCalled();
  });

  it('ignores query parameters — none are accepted or required', async () => {
    mockService.getProjectFeaturesSkeleton.mockResolvedValue([]);

    await request(app.getHttpServer() as App)
      .get(`${url()}?limit=5&offset=10`)
      .expect(200);

    expect(mockService.getProjectFeaturesSkeleton).toHaveBeenCalledWith(
      testIds.organization,
      testIds.project,
    );
    expect(mockService.listFeatures).not.toHaveBeenCalled();
  });
});
