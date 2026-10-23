import { INestApplication, NotFoundException } from '@nestjs/common';
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
import { PrivateBetaAccessReviewService } from '../../services/private-beta-access-review.service';
import { PrivateBetaAccessReviewController } from '../private-beta-access-review.controller';

const requestId = '550e8400-e29b-41d4-a716-446655440026';
const review = {
  requestId,
  name: 'Ada Lovelace',
  workEmail: 'ada@example.com',
  organizationName: 'Analytical Engines',
  teamSize: 5,
  productContext: 'A developer tool.',
  accessRationale: 'Evaluate agent-assisted planning.',
  status: 'PENDING',
  createdAt: '2026-08-12T00:00:00.000Z',
  decidedAt: null,
  provisioningOutcome: null,
};

describe('PrivateBetaAccessReviewController', () => {
  let app: INestApplication;
  let findMany: jest.Mock;
  let findOne: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([review]);
    findOne = jest.fn().mockResolvedValue(review);
    const moduleRef = await Test.createTestingModule({
      controllers: [PrivateBetaAccessReviewController],
      providers: [
        {
          provide: PrivateBetaAccessReviewService,
          useValue: { findMany, findOne },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('discovers durable requests through one authenticated collection delegation', async () => {
    const response = await request(app.getHttpServer() as App)
      .get('/api/v1/admin/private-beta-access-requests')
      .expect(200);

    expect(response.body).toEqual([review]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('forwards the generated review response after exactly one service delegation', async () => {
    const response = await request(app.getHttpServer() as App)
      .get(`/api/v1/admin/private-beta-access-requests/${requestId}`)
      .expect(200);

    expect(response.body).toEqual(review);
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith(requestId);
  });

  it('rejects malformed identities before service lookup', async () => {
    await request(app.getHttpServer() as App)
      .get('/api/v1/admin/private-beta-access-requests/not-a-uuid')
      .expect(400);

    expect(findOne).not.toHaveBeenCalled();
  });

  it('forwards the service not-found result', async () => {
    findOne.mockRejectedValueOnce(
      new NotFoundException('Private-beta access request not found'),
    );

    await request(app.getHttpServer() as App)
      .get(`/api/v1/admin/private-beta-access-requests/${requestId}`)
      .expect(404);
  });

  it('declares the exact route and authentication guards', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, PrivateBetaAccessReviewController),
    ).toBe('api/v1/admin/private-beta-access-requests');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        PrivateBetaAccessControllerPrototype(),
      ),
    ).toBe(0);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PrivateBetaAccessReviewController),
    ).toEqual([JwtAuthGuard, AdminGuard]);
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        PrivateBetaAccessControllerFindManyPrototype(),
      ),
    ).toBe(0);
  });
});

function PrivateBetaAccessControllerPrototype(): object {
  return Object.getOwnPropertyDescriptor(
    PrivateBetaAccessReviewController.prototype,
    'findOne',
  )?.value as object;
}

function PrivateBetaAccessControllerFindManyPrototype(): object {
  return Object.getOwnPropertyDescriptor(
    PrivateBetaAccessReviewController.prototype,
    'findMany',
  )?.value as object;
}
