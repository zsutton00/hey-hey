import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { AgentSessionOutputAttentionState } from '../../generated';
import { AgentSessionOutputAttentionService } from '../../services/agent-session-output-attention.service';
import { AgentSessionOutputAttentionController } from '../agent-session-output-attention.controller';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const entry = (state: AgentSessionOutputAttentionState) => ({
  agentSessionId: SESSION_ID,
  state,
  revision: state === AgentSessionOutputAttentionState.MessageReady ? 1 : 2,
  changedAt: '2026-08-12T12:00:00.000Z',
});

class AuthenticatedRequestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.user = {
      userId: USER_ID,
      currentOrgId: ORGANIZATION_ID,
      orgMemberships: [{ orgId: ORGANIZATION_ID, role: 'MEMBER' }],
    };
    return true;
  }
}

describe('AgentSessionOutputAttentionController routing', () => {
  let app: INestApplication;
  const outputAttentionService = {
    readAuthorized: jest.fn(),
    setReady: jest.fn(),
    acknowledge: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentSessionOutputAttentionController],
      providers: [
        {
          provide: AgentSessionOutputAttentionService,
          useValue: outputAttentionService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AuthenticatedRequestGuard)
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes readiness writes only to setReady', async () => {
    outputAttentionService.setReady.mockResolvedValue(
      entry(AgentSessionOutputAttentionState.MessageReady),
    );

    await request(app.getHttpServer() as App)
      .post(
        `/api/v1/organizations/${ORGANIZATION_ID}/projects/${PROJECT_ID}/agent-sessions/${SESSION_ID}/output-attention:ready`,
      )
      .send({ state: AgentSessionOutputAttentionState.MessageReady })
      .expect(200);

    expect(outputAttentionService.setReady).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      PROJECT_ID,
      USER_ID,
      SESSION_ID,
    );
    expect(outputAttentionService.acknowledge).not.toHaveBeenCalled();
  });

  it('routes acknowledgments only to acknowledge', async () => {
    outputAttentionService.acknowledge.mockResolvedValue(
      entry(AgentSessionOutputAttentionState.None),
    );

    await request(app.getHttpServer() as App)
      .post(
        `/api/v1/organizations/${ORGANIZATION_ID}/projects/${PROJECT_ID}/agent-sessions/${SESSION_ID}/output-attention:acknowledge`,
      )
      .expect(200);

    expect(outputAttentionService.acknowledge).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      PROJECT_ID,
      USER_ID,
      SESSION_ID,
    );
    expect(outputAttentionService.setReady).not.toHaveBeenCalled();
  });
});
