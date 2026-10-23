import {
  BadRequestException,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  INestApplication,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { ScopePathParamsGuard } from '../scope-path-params.guard';
import { ProjectAccessGuard } from '../project-access.guard';
import { ProjectAccessService } from '../../services/project-access.service';

const ORG_ID = '99e0a635-9fe1-48c3-b145-6a61b89b9d76';
const MEMBER_PROJECT_ID = '96c5429a-84d1-4813-b661-75be18f2b3c2';
const FOREIGN_PROJECT_ID = '0542f15a-3106-49c4-9699-0eb43d3b4fde';
const PROPOSAL_ID = '893e6e24-6ed5-4f67-a1a9-9e27719a7565';

describe('ScopePathParamsGuard', () => {
  const guard = new ScopePathParamsGuard();
  const context = (params?: object, type = 'http'): ExecutionContext =>
    ({
      getType: () => type,
      switchToHttp: () => ({ getRequest: () => ({ params }) }),
    }) as unknown as ExecutionContext;

  it('admits well-formed organization and project ids', async () => {
    await expect(
      guard.canActivate(
        context({ organizationId: ORG_ID, projectId: MEMBER_PROJECT_ID }),
      ),
    ).resolves.toBe(true);
  });

  it.each([
    [{ organizationId: 'projected', projectId: MEMBER_PROJECT_ID }],
    [{ organizationId: ORG_ID, projectId: 'projected' }],
    [{ organizationId: ORG_ID, projectId: '' }],
  ])('rejects a malformed scope id with 400 (%o)', async (params) => {
    await expect(guard.canActivate(context(params))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('names the offending path parameter', async () => {
    await expect(
      guard.canActivate(
        context({ organizationId: ORG_ID, projectId: 'projected' }),
      ),
    ).rejects.toThrow('Path parameter "projectId"');
  });

  it('ignores routes without scope params and non-http contexts', async () => {
    await expect(
      guard.canActivate(context({ id: 'not-a-uuid' })),
    ).resolves.toBe(true);
    await expect(guard.canActivate(context(undefined))).resolves.toBe(true);
    await expect(
      guard.canActivate(context({ organizationId: 'projected' }, 'ws')),
    ).resolves.toBe(true);
  });
});

@Controller('organizations/:organizationId/projects/:projectId/proposals')
@UseGuards(ProjectAccessGuard)
class ProtectedProposals {
  @Get(':proposalId') detail() {
    return { content: 'proposal' };
  }
}

describe('ScopePathParamsGuard over HTTP', () => {
  let app: INestApplication<App>;
  const assertProject = jest.fn(
    async (_userId: string, _organizationId: string, projectId: string) => {
      if (projectId !== MEMBER_PROJECT_ID)
        throw new ForbiddenException('Project access denied');
    },
  );

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProtectedProposals],
      providers: [
        { provide: APP_GUARD, useClass: ScopePathParamsGuard },
        { provide: ProjectAccessService, useValue: { assertProject } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: { user?: object }, _res: unknown, next: () => void) => {
      req.user = { userId: 'alice' };
      next();
    });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => assertProject.mockClear());

  const get = (organizationId: string, projectId: string) =>
    request(app.getHttpServer()).get(
      `/organizations/${organizationId}/projects/${projectId}/proposals/${PROPOSAL_ID}`,
    );

  it('returns 400 for placeholder scope before the membership check', async () => {
    await get('projected', 'projected').expect(400);
    expect(assertProject).not.toHaveBeenCalled();
  });

  it('keeps the membership denial for a well-formed foreign project', async () => {
    await get(ORG_ID, FOREIGN_PROJECT_ID).expect(403);
    expect(assertProject).toHaveBeenCalledWith(
      'alice',
      ORG_ID,
      FOREIGN_PROJECT_ID,
    );
  });

  it('admits a member', async () => {
    await get(ORG_ID, MEMBER_PROJECT_ID).expect(200, { content: 'proposal' });
  });
});
