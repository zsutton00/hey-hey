import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { PrivateBetaAccessDecisionService } from '../../services/private-beta-access-decision.service';
import { PrivateBetaAccessDecisionController } from '../private-beta-access-decision.controller';

const requestId = '550e8400-e29b-41d4-a716-446655440026';
const operatorId = '550e8400-e29b-41d4-a716-446655440027';
const input = { decision: 'REJECT' as const };
const result = {
  requestId,
  decision: 'REJECT',
  status: 'REJECTED',
  decidedAt: '2026-08-12T01:00:00.000Z',
  provisioningOutcome: null,
};

describe('PrivateBetaAccessDecisionController', () => {
  let app: INestApplication;
  let decide: jest.Mock;

  beforeEach(async () => {
    decide = jest.fn().mockResolvedValue(result);
    const moduleRef = await Test.createTestingModule({
      controllers: [PrivateBetaAccessDecisionController],
      providers: [
        { provide: PrivateBetaAccessDecisionService, useValue: { decide } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = {
            userId: operatorId,
          };
          return true;
        },
      })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('delegates the generated decision input exactly once with bounded request metadata', async () => {
    await request(app.getHttpServer() as App)
      .post(`/api/v1/admin/private-beta-access-requests/${requestId}/decision`)
      .set('User-Agent', 'decision-controller-test')
      .send(input)
      .expect(200);

    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith(
      requestId,
      input,
      operatorId,
      expect.objectContaining({
        ipAddress: expect.any(String),
        userAgent: 'decision-controller-test',
      }),
    );
  });

  it('rejects malformed request identities before delegation', async () => {
    await request(app.getHttpServer() as App)
      .post('/api/v1/admin/private-beta-access-requests/not-a-uuid/decision')
      .send(input)
      .expect(400);
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([
    ['missing decision', {}],
    ['invalid decision', { decision: 'ALLOW' }],
    ['additional field', { decision: 'APPROVE', note: 'submitted content' }],
  ])(
    'rejects %s with the generated contract before delegation',
    async (_, body) => {
      await request(app.getHttpServer() as App)
        .post(
          `/api/v1/admin/private-beta-access-requests/${requestId}/decision`,
        )
        .send(body)
        .expect(400);

      expect(decide).not.toHaveBeenCalled();
    },
  );

  it('declares the route and both required guards', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, PrivateBetaAccessDecisionController),
    ).toBe('api/v1/admin/private-beta-access-requests');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        Object.getOwnPropertyDescriptor(
          PrivateBetaAccessDecisionController.prototype,
          'decide',
        )?.value,
      ),
    ).toBe(':requestId/decision');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        Object.getOwnPropertyDescriptor(
          PrivateBetaAccessDecisionController.prototype,
          'decide',
        )?.value,
      ),
    ).toBe(1);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PrivateBetaAccessDecisionController),
    ).toEqual([JwtAuthGuard, AdminGuard]);
  });
});
