import { ForbiddenException } from '@nestjs/common';
import { ProjectAccessService } from '../../services/project-access.service';
import {
  INestApplication,
  ExecutionContext,
  UseGuards,
  Controller,
  Get,
  Param,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { OrganizationGuard } from '../organization.guard';
import { JwtAuthGuard } from '../jwt-auth.guard';

// Dummy controller protected by OrganizationGuard
@Controller('api/v1/organizations/:organizationId/test')
@UseGuards(JwtAuthGuard, OrganizationGuard)
class DummyProtectedController {
  @Get()
  getResource(@Param('organizationId') orgId: string) {
    return { ok: true, orgId };
  }
}

describe('OrganizationGuard – HTTP negative path', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [DummyProtectedController],
      providers: [
        {
          provide: ProjectAccessService,
          useValue: {
            assertOrganization: async (_user: string, org: string) => {
              if (org !== 'org_allowed') throw new ForbiddenException();
            },
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          // Attach a user that does NOT belong to requested organization
          const req = context.switchToHttp().getRequest();
          req.user = {
            userId: 'user-1',
            orgMemberships: [{ orgId: 'org_allowed', role: 'Member' }],
          };
          return true; // Allow JWT step
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 403 when user lacks organization membership', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/organizations/org_forbidden/test')
      .expect(403);
  });

  it('returns 200 when user has organization membership', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/organizations/org_allowed/test')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ ok: true, orgId: 'org_allowed' });
      });
  });
});
