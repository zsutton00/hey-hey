import { PrivateBetaAccessProgramService } from '../../services/private-beta-access-program.service';
import { PrivateBetaAccessDecisionService } from '../../services/private-beta-access-decision.service';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivateBetaAccessService } from '../../services/private-beta-access.service';
import { PrivateBetaAccessController } from '../private-beta-access.controller';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import * as deploymentEnvironment from '../../deployment-environment';

const validSubmission = {
  name: 'Ada Lovelace',
  workEmail: 'ada@example.com',
  organizationName: 'Analytical Engines',
  teamSize: 5,
  productContext: 'A developer tool.',
  accessRationale: 'Evaluate agent-assisted planning.',
};

describe('PrivateBetaAccessController', () => {
  let app: INestApplication;
  let findFirst: jest.Mock;
  let createRequest: jest.Mock;
  let createNotification: jest.Mock;
  let getAdmissionMode: jest.Mock;

  beforeEach(async () => {
    jest
      .spyOn(deploymentEnvironment, 'getDeploymentEnvironment')
      .mockReturnValue('test');
    findFirst = jest.fn().mockResolvedValue(null);
    createRequest = jest.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
    });
    createNotification = jest.fn().mockResolvedValue({});
    getAdmissionMode = jest.fn();
    const transaction = jest.fn(
      async (
        operation: (tx: {
          privateBetaAccessRequest: { create: jest.Mock; findFirst: jest.Mock };
          user: { findFirst: jest.Mock };
          $executeRaw: jest.Mock;
          privateBetaAccessNotificationAttempt: { create: jest.Mock };
        }) => Promise<void>,
      ) =>
        operation({
          privateBetaAccessRequest: { create: createRequest, findFirst },
          user: { findFirst: jest.fn().mockResolvedValue(null) },
          $executeRaw: jest.fn().mockResolvedValue(0),
          privateBetaAccessNotificationAttempt: {
            create: createNotification,
          },
        }),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            ttl: 60 * 60 * 1000,
            limit: 5,
          },
        ]),
      ],
      controllers: [PrivateBetaAccessController],
      providers: [
        PrivateBetaAccessService,
        {
          provide: PrivateBetaAccessProgramService,
          useValue: {
            getSelfServiceAdmissionMode: getAdmissionMode,
            assertOpenInTransaction: jest.fn(),
            isSelfServiceAdmissionOpenInTransaction: jest
              .fn()
              .mockResolvedValue(false),
          },
        },
        {
          provide: PrivateBetaAccessDecisionService,
          useValue: { completeSignupApproval: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: {
            db: {
              privateBetaAccessRequest: { findFirst },
              $transaction: transaction,
            },
          },
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('routes a public submission and wraps the generated 202 response', async () => {
    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/private-beta/access-requests')
      .send(validSubmission)
      .expect(202);

    expect(response.body).toMatchObject({
      success: true,
      statusCode: 202,
      path: '/api/v1/private-beta/access-requests',
      data: { accepted: true },
    });
    expect(createRequest).toHaveBeenCalledWith({
      data: expect.objectContaining({
        normalizedEmail: 'ada@example.com',
        status: 'PENDING',
      }),
    });
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith({
      data: expect.objectContaining({ recipientRole: 'REQUESTER' }),
    });
  });

  it('returns HTTP 400 before persistence for a contract-invalid submission', async () => {
    await request(app.getHttpServer() as App)
      .post('/api/v1/private-beta/access-requests')
      .send({ ...validSubmission, workEmail: 'not-an-email' })
      .expect(400);

    expect(findFirst).not.toHaveBeenCalled();
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('enforces the five-per-hour public throttle at the real HTTP boundary', async () => {
    for (let submission = 0; submission < 5; submission += 1) {
      await request(app.getHttpServer() as App)
        .post('/api/v1/private-beta/access-requests')
        .send({
          ...validSubmission,
          workEmail: `ada-${submission}@example.com`,
        })
        .expect(202);
    }

    await request(app.getHttpServer() as App)
      .post('/api/v1/private-beta/access-requests')
      .send({ ...validSubmission, workEmail: 'ada-blocked@example.com' })
      .expect(429);
  });

  it.each(['OPEN', 'PAUSED'])(
    'allows anonymous mode reads without audit data in %s mode',
    async (mode) => {
      getAdmissionMode.mockResolvedValue({
        mode,
        updatedAt: '2026-10-05T00:00:00.000Z',
        updatedByUserId: 'operator',
      });
      const response = await request(app.getHttpServer() as App)
        .get('/api/v1/private-beta-access/admission-mode')
        .expect(200);
      expect(response.body.data).toEqual({ mode });
      expect(
        Reflect.getMetadata(
          'isPublic',
          PrivateBetaAccessController.prototype.getAdmissionMode,
        ),
      ).toBe(true);
    },
  );

  it('marks the submission operation public without exposing the controller', () => {
    const submitDescriptor = Object.getOwnPropertyDescriptor(
      PrivateBetaAccessController.prototype,
      'submit',
    );
    const submitHandler = submitDescriptor?.value as object | undefined;
    expect(typeof submitHandler).toBe('function');
    if (submitHandler === undefined) {
      throw new Error('Expected the submit handler to be defined.');
    }
    expect(Reflect.getMetadata('isPublic', submitHandler)).toBe(true);
    expect(Reflect.getMetadata('isPublic', PrivateBetaAccessController)).toBe(
      undefined,
    );
  });
});
