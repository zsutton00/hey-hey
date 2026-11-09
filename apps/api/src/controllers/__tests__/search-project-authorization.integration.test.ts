import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessService } from '../../auth/services/project-access.service';
import { EmbeddingsClientService } from '../../services/embeddings-client.service';
import { EntityRegistryService } from '../../services/entity-registry/entity-registry.service';
import { UnifiedSearchService } from '../../services/unified-search/unified-search.service';
import { EntitySearchController } from '../entity-search.controller';
import { UnifiedSearchController } from '../unified-search.controller';

const projects = [
  { id: 'member-project', organizationId: 'org-1', members: ['alice'] },
  { id: 'other-project', organizationId: 'org-1', members: ['bob'] },
  { id: 'foreign-project', organizationId: 'org-2', members: ['alice'] },
];

describe('search requires current project access before any downstream call', () => {
  let app: INestApplication;
  const unifiedSearch = { search: jest.fn(), batchSearch: jest.fn() };
  const embeddings = { searchWithUserToken: jest.fn() };

  beforeAll(async () => {
    const prisma = {
      db: {
        project: {
          findFirst: jest.fn(async ({ where }) =>
            projects.find(
              (project) =>
                project.id === where.id &&
                project.organizationId === where.organizationId &&
                project.members.includes(where.members.some.userId),
            ),
          ),
        },
      },
    };
    const module = await Test.createTestingModule({
      controllers: [UnifiedSearchController, EntitySearchController],
      providers: [
        {
          provide: ProjectAccessService,
          useValue: new ProjectAccessService(prisma as never),
        },
        { provide: UnifiedSearchService, useValue: unifiedSearch },
        { provide: EmbeddingsClientService, useValue: embeddings },
        { provide: EntityRegistryService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OrganizationGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.organizationId = req.params.organizationId;
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      req.user = { userId: req.headers['x-test-user'] };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    unifiedSearch.search.mockResolvedValue({ results: [] });
    embeddings.searchWithUserToken.mockResolvedValue({
      success: true,
      query: 'q',
      results: 0,
      data: [],
    });
  });

  const unified = (organizationId: string, projectId: string, user: string) =>
    request(app.getHttpServer())
      .post(
        `/api/v1/organizations/${organizationId}/projects/${projectId}/search`,
      )
      .set('x-test-user', user)
      .send({ intent: 'semantic', query: 'q' });

  const legacy = (organizationId: string, projectId: string, user: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${organizationId}/entities/semantic-search`)
      .query({ q: 'q', projectId })
      .set('x-test-user', user)
      .set('Authorization', 'Bearer token-without-project-ids');

  it.each([
    ['unified search', unified, () => unifiedSearch.search],
    ['semantic search', legacy, () => embeddings.searchWithUserToken],
  ])('%s admits a project member', async (_name, send, downstream) => {
    await send('org-1', 'member-project', 'alice').expect(200);

    expect(downstream()).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unified search', unified, () => unifiedSearch.search],
    ['semantic search', legacy, () => embeddings.searchWithUserToken],
  ])(
    '%s denies non-members, wrong-organization and absent projects',
    async (_name, send, downstream) => {
      await send('org-1', 'member-project', 'bob').expect(403);
      await send('org-1', 'foreign-project', 'alice').expect(403);
      await send('org-1', 'missing-project', 'alice').expect(403);

      expect(downstream()).not.toHaveBeenCalled();
    },
  );
});
