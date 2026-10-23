import { describe, expect, it, vi } from 'vitest';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import type { ServerLogger } from '../../server/logger';
import { loadTaskMonitorCanonicalEvidence } from './task-monitor-evidence';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const MONITOR_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const NEXT_TASK_ID = '55555555-5555-4555-8555-555555555555';
const SESSION_ID = '66666666-6666-4666-8666-666666666666';
const CONVERSATION_ID = '77777777-7777-4777-8777-777777777777';
const IMPLEMENT_REPORT_ID = '99999999-9999-4999-8999-999999999999';
const REVIEW_REPORT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAGE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DESIGN_DOC_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const launchConfiguration = {
  method: 'quick',
  provider: 'codex',
  model: 'gpt-5',
  reasoningEffort: 'high',
} as const;

const envelope = (data: object | object[]): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const workItem = (id: string, name: string) => ({
  id,
  name,
  type: 'STANDARD',
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  status: 'ACTIVE',
  source: 'user',
  sections: [{ key: 'description', materializedMarkdown: `${name} body` }],
});

const report = (id: string, reportType: string) => ({
  id,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  reportType,
  sourceExecutionId: SESSION_ID,
  createdAt: '2026-08-02T00:00:00.000Z',
  payload: {
    reportType,
    summary: `${reportType} evidence`,
  },
});

const logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
} as unknown as ServerLogger;

describe('loadTaskMonitorCanonicalEvidence', () => {
  it('loads and correlates monitor, Tasks, graph context, session, and full Reports', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl);
      const path = url.pathname;

      if (path.endsWith(`/work-items/${MONITOR_ID}`)) {
        return envelope({
          ...workItem(MONITOR_ID, 'Release monitor'),
          type: 'TASK_MONITOR',
          sections: [
            {
              key: 'executionDefinition',
              materializedMarkdown: JSON.stringify({
                executionPlan: [
                  {
                    taskId: TASK_ID,
                    dependsOnTaskIds: [],
                    launchConfiguration,
                    agentSessionId: SESSION_ID,
                  },
                  {
                    taskId: NEXT_TASK_ID,
                    dependsOnTaskIds: [TASK_ID],
                    launchConfiguration: { ...launchConfiguration, method: 'open' },
                  },
                ],
                launchPolicy: {
                  terminalSupervision: { mode: 'REQUIRE_REVIEW' },
                },
                cursor: 0,
              }),
            },
          ],
        });
      }
      if (path.endsWith(`/work-items/${TASK_ID}`)) {
        return envelope(workItem(TASK_ID, 'Current Task'));
      }
      if (path.endsWith(`/work-items/${NEXT_TASK_ID}`)) {
        return envelope(workItem(NEXT_TASK_ID, 'Next Task'));
      }
      if (path.endsWith(`/entities/TASK/${TASK_ID}/context`)) {
        return envelope({
          entityId: TASK_ID,
          entityType: 'TASK',
          displayName: 'Current Task',
          createdAt: '2026-09-07T00:00:00.000Z',
          relatedEntities: [
            {
              entityId: NEXT_TASK_ID,
              entityType: 'TASK',
              displayName: 'Review contract',
              taskType: 'CONTRACT',
              relationship: 'DEPENDS_ON',
            },
            {
              entityId: NEXT_TASK_ID,
              entityType: 'TASK',
              displayName: 'Review contract',
              taskType: 'CONTRACT',
              relationship: 'DEPENDS_ON',
            },
          ],
          featureHierarchy: [
            {
              id: MONITOR_ID,
              name: 'Task Monitor Supervision',
              tag: 'AI',
              relationshipType: 'structural',
              relationship: 'ancestor',
              distance: 1,
            },
            {
              id: MONITOR_ID,
              name: 'Task Monitor Supervision',
              tag: 'AI',
              relationshipType: 'structural',
              relationship: 'ancestor',
              distance: 1,
            },
          ],
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
              materializedMarkdown: 'Release checks are available.',
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
              materializedMarkdown: 'Implement the release checks.',
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
          name: 'Release Checks Design',
          sections: [
            {
              key: 'approach',
              order: 0,
              materializedMarkdown: 'Ground supervision in the approved release-check design.',
            },
          ],
        });
      }
      if (path.endsWith(`/agent-sessions/${SESSION_ID}`)) {
        return envelope({
          id: SESSION_ID,
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          status: 'IN_PROGRESS',
          conversationId: CONVERSATION_ID,
          serviceIds: ['service-1', 'service-2'],
          launchServiceId: 'service-1',
          config: {
            version: 'v2',
            type: 'CODING_SESSION',
            taskMonitorId: MONITOR_ID,
          },
        });
      }
      if (path.endsWith('/reports')) {
        return envelope([
          report(IMPLEMENT_REPORT_ID, 'SESSION_SUMMARY'),
          report(REVIEW_REPORT_ID, 'RISK_ALERT'),
        ]);
      }
      return new Response('not found', { status: 404 });
    });
    const deps = createPromptTypeHandlerTestDeps({
      fetchImpl: fetchImpl as typeof fetch,
      apiBaseUrl: 'https://api.test/v1',
      logger,
    });

    const evidence = await loadTaskMonitorCanonicalEvidence(deps, {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      accessToken: 'token',
      settledTurn: {
        turnId: 'turn-review-1',
        promptType: 'code_review',
        terminalOutcome: 'COMPLETED',
        completedAssistantMessage: { messageId: 'message-1', content: 'Review complete.' },
        reports: [{ reportId: REVIEW_REPORT_ID, reportType: 'RISK_ALERT' }],
      },
    });

    expect(evidence).toMatchObject({
      monitor: { id: MONITOR_ID, cursor: 0, reviewMode: 'REQUIRE_REVIEW' },
      selectedTask: { executionIndex: 0, id: TASK_ID },
      planGuidance: {
        plan: { id: PLAN_ID },
        designDoc: {
          id: DESIGN_DOC_ID,
          sections: {
            approach: 'Ground supervision in the approved release-check design.',
          },
        },
        stage: { id: STAGE_ID },
        step: { id: TASK_ID },
      },
      remainingWork: [{ executionIndex: 1, taskId: NEXT_TASK_ID }],
      selectedSession: {
        id: SESSION_ID,
        status: 'IN_PROGRESS',
        conversationId: CONVERSATION_ID,
        serviceIds: ['service-1', 'service-2'],
        launchServiceId: 'service-1',
      },
      releasedTurn: { turnId: 'turn-review-1', promptType: 'code_review' },
    });
    expect(evidence.reports.map(({ id }) => id)).toEqual([IMPLEMENT_REPORT_ID, REVIEW_REPORT_ID]);
    expect(evidence.selectedTask.featureHierarchy).toHaveLength(1);
    expect(evidence.selectedTask.contracts).toHaveLength(1);
    expect(evidence.reports[0]).toMatchObject({
      reportType: 'SESSION_SUMMARY',
      sourceExecutionId: SESSION_ID,
      payload: { summary: 'SESSION_SUMMARY evidence' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(12);
    const reportListSources = fetchImpl.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter(({ pathname }) => pathname.endsWith('/reports'))
      .map(({ searchParams }) => searchParams.get('sourceExecutionId'));
    expect(reportListSources).toEqual([SESSION_ID]);
  });

  it('treats zero Reports as ordinary selected-session evidence', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(rawUrl).pathname;
      if (path.endsWith(`/work-items/${MONITOR_ID}`)) {
        return envelope({
          ...workItem(MONITOR_ID, 'Release monitor'),
          type: 'TASK_MONITOR',
          sections: [
            {
              key: 'executionDefinition',
              materializedMarkdown: JSON.stringify({
                executionPlan: [
                  {
                    taskId: TASK_ID,
                    dependsOnTaskIds: [],
                    launchConfiguration,
                    agentSessionId: SESSION_ID,
                  },
                ],
                launchPolicy: {
                  terminalSupervision: { mode: 'AGENT_DECIDES' },
                },
                cursor: 0,
              }),
            },
          ],
        });
      }
      if (path.endsWith(`/work-items/${TASK_ID}`)) {
        return envelope(workItem(TASK_ID, 'Current Task'));
      }
      if (path.endsWith(`/entities/TASK/${TASK_ID}/context`)) {
        return envelope({
          entityId: TASK_ID,
          entityType: 'TASK',
          displayName: 'Current Task',
          createdAt: '2026-09-07T00:00:00.000Z',
        });
      }
      if (path.endsWith(`/agent-sessions/${SESSION_ID}`)) {
        return envelope({
          id: SESSION_ID,
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          status: 'IN_PROGRESS',
          conversationId: CONVERSATION_ID,
          serviceIds: ['service-1'],
          launchServiceId: 'service-1',
          config: {
            version: 'v2',
            type: 'CODING_SESSION',
            taskMonitorId: MONITOR_ID,
          },
        });
      }
      if (path.endsWith('/reports')) return envelope([]);
      return new Response('not found', { status: 404 });
    });
    const deps = createPromptTypeHandlerTestDeps({
      fetchImpl: fetchImpl as typeof fetch,
      apiBaseUrl: 'https://api.test/v1',
      logger,
    });

    await expect(
      loadTaskMonitorCanonicalEvidence(deps, {
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        accessToken: 'token',
        settledTurn: {
          turnId: 'turn-1',
          promptType: 'quick',
          terminalOutcome: 'COMPLETED',
          completedAssistantMessage: null,
          reports: [],
        },
      }),
    ).resolves.toMatchObject({ reports: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('keeps canonical work evidence usable before a session is selected', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const path = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input : input.url,
      ).pathname;
      if (path.endsWith(`/work-items/${MONITOR_ID}`)) {
        return envelope({
          ...workItem(MONITOR_ID, 'Release monitor'),
          type: 'TASK_MONITOR',
          sections: [
            {
              key: 'executionDefinition',
              materializedMarkdown: JSON.stringify({
                executionPlan: [{ taskId: TASK_ID, dependsOnTaskIds: [], launchConfiguration }],
                launchPolicy: { terminalSupervision: { mode: 'AGENT_DECIDES' } },
                cursor: 0,
              }),
            },
          ],
        });
      }
      if (path.endsWith(`/work-items/${TASK_ID}`))
        return envelope(workItem(TASK_ID, 'Current Task'));
      if (path.endsWith(`/entities/TASK/${TASK_ID}/context`)) {
        return envelope({
          entityId: TASK_ID,
          entityType: 'TASK',
          displayName: 'Current Task',
          createdAt: '2026-09-07T00:00:00.000Z',
          relatedEntities: [],
          featureHierarchy: [],
        });
      }
      return new Response('not found', { status: 404 });
    });

    await expect(
      loadTaskMonitorCanonicalEvidence(
        createPromptTypeHandlerTestDeps({
          fetchImpl: fetchImpl as typeof fetch,
          apiBaseUrl: 'https://api.test/v1',
          logger,
        }),
        {
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          accessToken: 'token',
        },
      ),
    ).resolves.toMatchObject({
      selectedTask: { id: TASK_ID },
      selectedSession: null,
      reports: [],
      releasedTurn: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('rejects a selected session whose launch service is outside its service scope', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith(`/work-items/${MONITOR_ID}`)) {
        return envelope({
          ...workItem(MONITOR_ID, 'Release monitor'),
          type: 'TASK_MONITOR',
          sections: [
            {
              key: 'executionDefinition',
              materializedMarkdown: JSON.stringify({
                executionPlan: [
                  {
                    taskId: TASK_ID,
                    dependsOnTaskIds: [],
                    launchConfiguration,
                    agentSessionId: SESSION_ID,
                  },
                ],
                launchPolicy: {
                  terminalSupervision: { mode: 'AGENT_DECIDES' },
                },
                cursor: 0,
              }),
            },
          ],
        });
      }
      if (path.endsWith(`/work-items/${TASK_ID}`)) return envelope(workItem(TASK_ID, 'Task'));
      if (path.endsWith(`/entities/TASK/${TASK_ID}/context`)) {
        return envelope({
          entityId: TASK_ID,
          entityType: 'TASK',
          displayName: 'Task',
          createdAt: '2026-09-07T00:00:00.000Z',
        });
      }
      if (path.endsWith(`/agent-sessions/${SESSION_ID}`)) {
        return envelope({
          id: SESSION_ID,
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          status: 'IN_PROGRESS',
          conversationId: CONVERSATION_ID,
          serviceIds: ['service-1'],
          launchServiceId: 'service-2',
          config: { version: 'v2', type: 'CODING_SESSION', taskMonitorId: MONITOR_ID },
        });
      }
      return new Response('not found', { status: 404 });
    });
    const deps = createPromptTypeHandlerTestDeps({
      fetchImpl: fetchImpl as typeof fetch,
      apiBaseUrl: 'https://api.test/v1',
      logger,
    });

    await expect(
      loadTaskMonitorCanonicalEvidence(deps, {
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        accessToken: 'token',
      }),
    ).rejects.toThrow(/valid launch service scope/i);
  });

  it('rejects canonical work responses outside the requested identity and ownership scope', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const path = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input : input.url,
      ).pathname;
      if (path.endsWith(`/work-items/${MONITOR_ID}`)) {
        return envelope({
          ...workItem('88888888-8888-4888-8888-888888888888', 'Different monitor'),
          type: 'TASK_MONITOR',
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await expect(
      loadTaskMonitorCanonicalEvidence(
        createPromptTypeHandlerTestDeps({
          fetchImpl: fetchImpl as typeof fetch,
          apiBaseUrl: 'https://api.test/v1',
          logger,
        }),
        {
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          accessToken: 'token',
        },
      ),
    ).rejects.toThrow(/identity or ownership/i);
  });
});
