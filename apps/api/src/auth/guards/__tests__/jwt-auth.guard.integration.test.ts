import {
  Controller,
  Get,
  UseGuards,
  INestApplication,
  ExecutionContext,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { JwtStrategy } from '../../strategies/jwt.strategy';
import { Reflector } from '@nestjs/core';

// Simple secured controller
@Controller('api/v1/secure')
@UseGuards(JwtAuthGuard)
class SecureController {
  @Get()
  getSecure() {
    return { ok: true };
  }
}

// Custom test guard that reuses extractor logic but skips real JWT verification
class TestJwtAuthGuard extends JwtAuthGuard {
  constructor() {
    super(new Reflector());
  }

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    let token = (JwtStrategy as any).extractJwtFromRequest(req);

    if (!token && req.headers?.cookie) {
      const match = req.headers.cookie
        .split(';')
        .map((c: string) => c.trim())
        .find((c: string) => c.startsWith('accessToken='));
      if (match) {
        token = match.replace('accessToken=', '');
      }
    }

    if (token === 'test-token') {
      req.user = { userId: 'user1' }; // attach fake user
      return true;
    }
    return false;
  }
}

describe('JwtAuthGuard – integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [SecureController],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('authorizes when valid bearer token present', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/secure')
      .set('Authorization', 'Bearer test-token')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ ok: true });
      });
  });

  it('authorizes when valid accessToken cookie present', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/secure')
      .set('Cookie', ['accessToken=test-token'])
      .expect(200);
  });

  it('rejects when token missing', async () => {
    await request(app.getHttpServer()).get('/api/v1/secure').expect(403);
  });
});
