import { describe, expect, it, vi } from 'vitest';
import { NOOP_LOGGER } from './logger';
import { TaskMonitorPlanContext } from './task-monitor-plan-context';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const STAGE_ID = '55555555-5555-4555-8555-555555555555';
const DESIGN_DOC_ID = '77777777-7777-4777-8777-777777777777';

const envelope = (data: object): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('TaskMonitorPlanContext', () => {
  it('resolves the selected Task Plan stage, step, and design document once', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith(`/entities/TASK/${TASK_ID}/context`)) {
        return envelope({
          entityId: TASK_ID,
          entityType: 'TASK',
          displayName: 'Selected Task',
          createdAt: '2026-09-07T00:00:00.000Z',
          planContext: {
            parentPlan: {
              id: PLAN_ID,
              entityType: 'TASK',
              taskType: 'PLAN',
              displayName: 'Delivery Plan',
            },
            parentStage: {
              id: STAGE_ID,
              entityType: 'TASK',
              taskType: 'PLAN_STAGE',
              displayName: 'Implementation',
            },
          },
        });
      }
      if (path.endsWith(`/work-items/${PLAN_ID}`)) {
        return envelope({
          id: PLAN_ID,
          name: 'Delivery Plan',
          type: 'PLAN',
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          status: 'ACTIVE',
          source: 'system',
          sections: [
            {
              id: 'plan-description',
              key: 'description',
              order: 1,
              materializedMarkdown: 'Deliver the capability safely.',
            },
            {
              id: 'plan-outcome',
              key: 'outcome',
              order: 0,
              materializedMarkdown: 'The capability is available.',
            },
          ],
        });
      }
      if (path.endsWith(`/work-items/${STAGE_ID}`)) {
        return envelope({
          id: STAGE_ID,
          name: 'Implementation',
          type: 'PLAN_STAGE',
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          status: 'ACTIVE',
          source: 'system',
          sections: [
            {
              id: 'stage-description',
              key: 'description',
              order: 0,
              materializedMarkdown: 'Build and verify the capability.',
            },
          ],
        });
      }
      if (path.endsWith(`/work-items/${TASK_ID}`)) {
        return envelope({
          id: TASK_ID,
          name: 'Implement the capability',
          type: 'STANDARD',
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          status: 'ACTIVE',
          source: 'user',
          sections: [
            {
              id: 'task-description',
              key: 'description',
              order: 0,
              materializedMarkdown: 'Follow the staged rollout constraints.',
            },
            {
              id: 'task-criteria',
              key: 'acceptanceCriteria',
              order: 1,
              materializedMarkdown: 'This produces the planned outcome.',
            },
          ],
        });
      }
      if (path.endsWith('/design-docs')) {
        return envelope([{ id: DESIGN_DOC_ID, template: 'PLAN_DOCUMENT' }]);
      }
      if (path.endsWith(`/design-docs/${DESIGN_DOC_ID}`)) {
        return envelope({
          id: DESIGN_DOC_ID,
          name: 'Release Safety Design',
          sections: [
            {
              key: 'verification',
              order: 1,
              materializedMarkdown: ' Run focused and full release checks. ',
            },
            {
              key: 'approach',
              order: 0,
              materializedMarkdown: 'Make canonical Plan evidence available to both consumers.',
            },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    });
    const owner = new TaskMonitorPlanContext({
      apiBaseUrl: 'https://api.test/v1',
      fetchImpl: fetchImpl as typeof fetch,
      logger: NOOP_LOGGER,
    });

    await expect(
      owner.resolve({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        accessToken: 'token',
      }),
    ).resolves.toEqual({
      plan: {
        id: PLAN_ID,
        title: 'Delivery Plan',
        description: 'Deliver the capability safely.',
        outcome: 'The capability is available.',
      },
      designDoc: {
        id: DESIGN_DOC_ID,
        title: 'Release Safety Design',
        sections: {
          approach: 'Make canonical Plan evidence available to both consumers.',
          verification: 'Run focused and full release checks.',
        },
      },
      stage: {
        id: STAGE_ID,
        title: 'Implementation',
        description: 'Build and verify the capability.',
      },
      step: {
        id: TASK_ID,
        title: 'Implement the capability',
        description: 'Follow the staged rollout constraints.',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    const designDocsUrl = fetchImpl.mock.calls
      .map(([input]) => new URL(String(input)))
      .find(({ pathname }) => pathname.endsWith('/design-docs'));
    expect(designDocsUrl?.searchParams.get('projectId')).toBe(PROJECT_ID);
    expect(designDocsUrl?.searchParams.get('taskId')).toBe(PLAN_ID);
  });

  it('returns null after the single context read when the Task is not in a Plan', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        envelope({
          entityId: TASK_ID,
          entityType: 'TASK',
          displayName: 'Free Task',
          createdAt: '2026-09-07T00:00:00.000Z',
        }),
      ),
    );
    const owner = new TaskMonitorPlanContext({
      apiBaseUrl: 'https://api.test/v1',
      fetchImpl: fetchImpl as typeof fetch,
      logger: NOOP_LOGGER,
    });

    await expect(
      owner.resolve({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        accessToken: 'token',
      }),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps Plan guidance usable when no design document is returned', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith(`/entities/TASK/${TASK_ID}/context`)) {
        return envelope({
          entityId: TASK_ID,
          entityType: 'TASK',
          displayName: 'Selected Task',
          createdAt: '2026-09-07T00:00:00.000Z',
          planContext: {
            parentPlan: {
              id: PLAN_ID,
              entityType: 'TASK',
              taskType: 'PLAN',
              displayName: 'Delivery Plan',
            },
            parentStage: {
              id: STAGE_ID,
              entityType: 'TASK',
              taskType: 'PLAN_STAGE',
              displayName: 'Implementation',
            },
          },
        });
      }
      if (path.endsWith(`/work-items/${PLAN_ID}`)) {
        return envelope({
          id: PLAN_ID,
          name: 'Delivery Plan',
          type: 'PLAN',
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          status: 'ACTIVE',
          source: 'system',
          sections: [
            {
              id: 'plan-outcome',
              key: 'outcome',
              order: 0,
              materializedMarkdown: 'The capability is available.',
            },
          ],
        });
      }
      if (path.endsWith(`/work-items/${STAGE_ID}`)) {
        return envelope({
          id: STAGE_ID,
          name: 'Implementation',
          type: 'PLAN_STAGE',
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          status: 'ACTIVE',
          source: 'system',
          sections: [],
        });
      }
      if (path.endsWith(`/work-items/${TASK_ID}`)) {
        return envelope({
          id: TASK_ID,
          name: 'Selected Task',
          type: 'STANDARD',
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          status: 'ACTIVE',
          source: 'user',
          sections: [
            {
              id: 'task-criteria',
              key: 'acceptanceCriteria',
              order: 0,
              materializedMarkdown: 'This delivers the capability.',
            },
          ],
        });
      }
      if (path.endsWith('/design-docs')) {
        return envelope([]);
      }
      return new Response('not found', { status: 404 });
    });
    const owner = new TaskMonitorPlanContext({
      apiBaseUrl: 'https://api.test/v1',
      fetchImpl: fetchImpl as typeof fetch,
      logger: NOOP_LOGGER,
    });

    const resolved = await owner.resolve({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      accessToken: 'token',
    });
    expect(resolved).toMatchObject({
      plan: { id: PLAN_ID },
      stage: { id: STAGE_ID },
      step: { id: TASK_ID },
    });
    expect(resolved).not.toHaveProperty('designDoc');
  });
});
