import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { TransformInterceptor } from '../../../common/interceptors/transform.interceptor';
import { ApiMetricsService } from '../api-metrics.service';
import { MetricsController } from '../metrics.controller';

describe('MetricsController', () => {
  let app: INestApplication;
  const contentType = 'text/plain; version=0.0.4; charset=utf-8';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: ApiMetricsService,
          useValue: {
            contentType,
            metrics: jest
              .fn()
              .mockResolvedValue('# HELP retained retained\nretained 1\n'),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the registry text verbatim with the Prometheus content type', async () => {
    const response = await request(app.getHttpServer() as App)
      .get('/metrics')
      .expect(200);

    expect(response.headers['content-type']).toBe(contentType);
    expect(response.text).toBe('# HELP retained retained\nretained 1\n');
    expect(response.text).not.toContain('"success"');
  });
});
