import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OrganizationId, UserId } from '../../src/types';
import { createTestUser } from '../helpers/user.helper';
import { getTestOrganization } from '../helpers/organization.helper';
import { JwtService } from '@nestjs/jwt';

describe('EntitySearchController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let organizationId: OrganizationId;
  let userId: UserId;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    const org = await getTestOrganization(prisma);
    organizationId = org.id as OrganizationId;
    const user = await createTestUser(prisma, organizationId);
    userId = user.id as UserId;

    token = jwtService.sign({
      userId,
      organizationId,
      email: user.email,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/organizations/:organizationId/entities/search (GET)', () => {
    it('should return a 200 OK response', async () => {
      return request(app.getHttpServer())
        .get(`/api/v1/organizations/${organizationId}/entities/search?query=test`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});
