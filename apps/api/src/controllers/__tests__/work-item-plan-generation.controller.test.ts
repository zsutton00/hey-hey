import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { WorkItemPlanGenerationController } from '../work-item-plan-generation.controller';
import { WorkItemPlanGenerationService } from '../../services/plan/work-item-plan-generation.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { PlanSubmissionAdmissionService } from '../../services/plan/plan-submission-admission.service';

describe('work-item Plan generation HTTP contract', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const project = '22222222-2222-4222-8222-222222222222';
  const plan = '33333333-3333-4333-8333-333333333333';
  const path = `/api/v1/organizations/${org}/projects/${project}/work-items/${plan}/plan-generation`;
  const generation = { prepare: jest.fn(), reset: jest.fn() };
  const admission = { admit: jest.fn() };
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkItemPlanGenerationController],
      providers: [
        { provide: WorkItemPlanGenerationService, useValue: generation },
        { provide: PlanSubmissionAdmissionService, useValue: admission },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.use(
      (req: { user?: { userId: string } }, _res: unknown, next: () => void) => {
        req.user = { userId: 'owner' };
        next();
      },
    );
    app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns the session directly as declared by the generated client', async () => {
    generation.prepare.mockResolvedValue({
      id: 'session',
      conversationId: 'conversation',
    });
    await request(app.getHttpServer())
      .post(path)
      .expect(200)
      .expect({ id: 'session', conversationId: 'conversation' });
    expect(generation.prepare).toHaveBeenCalledWith(
      org,
      project,
      plan,
      'owner',
    );
  });

  it('resets the same work item with an empty 204 response', async () => {
    generation.reset.mockResolvedValue(undefined);
    await request(app.getHttpServer()).delete(path).expect(204).expect('');
    expect(generation.reset).toHaveBeenCalledWith(org, project, plan, 'owner');
  });

  it('returns the API-owned admission result without wrapping it', async () => {
    const body = {
      kind: 'phase_breakdown',
      conversationId: '44444444-4444-4444-8444-444444444444',
      triggerMessageId: '55555555-5555-4555-8555-555555555555',
      submission: { stageIdx: 0, phaseIdx: 0, plan: { steps: [] } },
    };
    admission.admit.mockResolvedValue({
      status: 'accepted',
      submission: body.submission,
      advisories: [],
    });

    await request(app.getHttpServer())
      .post(`${path}/admission`)
      .send(body)
      .expect(200)
      .expect({
        status: 'accepted',
        submission: body.submission,
        advisories: [],
      });
    expect(admission.admit).toHaveBeenCalledWith({
      organizationId: org,
      projectId: project,
      planId: plan,
      userId: 'owner',
      request: body,
    });
  });
});
