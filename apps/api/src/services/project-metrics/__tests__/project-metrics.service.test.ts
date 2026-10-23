import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ForbiddenException } from '@nestjs/common';
import {
  ProjectMetricIdentity,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { WorkItemTypeRegistryService } from 'src/services/tasks/work-item-type-registry.service';
import { AcceptedEvidenceSelectorService } from '../accepted-evidence-selector.service';
import { ProjectMetricsService } from '../project-metrics.service';

const ORGANIZATION_ID = 'organization-1';
const USER_ID = 'user-1';
const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';
const PROJECT_OTHER_ORGANIZATION = 'project-other-organization';
const NOW = new Date('2026-09-04T12:00:00.000Z');
const WINDOW_START = new Date('2026-09-03T12:00:00.000Z');
const DEFAULT_OCCURRED_AT = new Date('2026-09-04T11:00:00.000Z');

type TestEvent = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  createdAt: Date;
  headers: Record<string, unknown>;
  processedAt: Date;
  correlationId: string;
  causationId: string | null;
  projectId: string | null;
  userId: string | null;
};

type DefinitionFixture = {
  key: string;
  role: WorkItemTypeRole;
  status: WorkItemTypeLifecycleStatus;
};

const DEFAULT_DEFINITIONS: Record<string, DefinitionFixture[]> = {
  [PROJECT_A]: [
    { key: 'STANDARD', role: WorkItemTypeRole.WorkItem, status: 'ACTIVE' },
    { key: 'PLAN', role: WorkItemTypeRole.ProjectInfo, status: 'ACTIVE' },
    { key: 'BUG', role: WorkItemTypeRole.WorkItem, status: 'ACTIVE' },
    { key: 'FEATURE', role: WorkItemTypeRole.ProjectInfo, status: 'ACTIVE' },
  ],
  [PROJECT_B]: [
    { key: 'STANDARD', role: WorkItemTypeRole.WorkItem, status: 'ACTIVE' },
    { key: 'PLAN', role: WorkItemTypeRole.ProjectInfo, status: 'ACTIVE' },
    { key: 'BUG', role: WorkItemTypeRole.WorkItem, status: 'ACTIVE' },
    { key: 'FEATURE', role: WorkItemTypeRole.ProjectInfo, status: 'ARCHIVED' },
    {
      key: 'CUSTOM_INFO',
      role: WorkItemTypeRole.ProjectInfo,
      status: 'ACTIVE',
    },
  ],
};

function event(overrides: Partial<TestEvent>): TestEvent {
  return {
    id: 'event-1',
    eventType: 'task.created',
    aggregateType: 'task',
    aggregateId: 'task-1',
    payload: {},
    createdAt: DEFAULT_OCCURRED_AT,
    headers: {},
    processedAt: new Date('2026-09-04T11:00:02.000Z'),
    correlationId: 'correlation-1',
    causationId: 'causation-1',
    projectId: PROJECT_A,
    userId: USER_ID,
    ...overrides,
  };
}

function taskSnapshot(
  id: string,
  type: string,
  projectId: string,
  createdAt: Date = DEFAULT_OCCURRED_AT,
) {
  return {
    id,
    type,
    projectId,
    name: 'A test item',
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  };
}

function agentSessionSnapshot(
  id: string,
  projectId: string,
  createdAt: Date = DEFAULT_OCCURRED_AT,
) {
  return {
    id,
    projectId,
    userId: USER_ID,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  };
}

function createHarness(
  definitions: Record<string, DefinitionFixture[]> = DEFAULT_DEFINITIONS,
) {
  const organizationMemberFindUnique = jest
    .fn()
    .mockResolvedValue({ id: 'membership' });
  const projectFindMany = jest
    .fn()
    .mockResolvedValue([{ id: PROJECT_A }, { id: PROJECT_B }]);
  const outboxEventFindMany = jest.fn().mockResolvedValue([]);
  const taskFindMany = jest.fn().mockResolvedValue([]);
  const registryGetDefinitions = jest.fn(
    (projectId: string, status?: WorkItemTypeLifecycleStatus) => {
      const rows = definitions[projectId] ?? [];
      return rows
        .filter((row) => status === undefined || row.status === status)
        .map((row) => ({
          id: `${projectId}:${row.key}`,
          projectId,
          status: row.status,
          effectiveSource: 'CANONICAL',
          definition: {
            key: row.key,
            role: row.role,
          },
        }));
    },
  );

  const prisma = {
    db: {
      organizationMember: { findFirst: organizationMemberFindUnique },
      project: { findMany: projectFindMany },
      outboxEvent: { findMany: outboxEventFindMany },
      task: { findMany: taskFindMany },
    },
  } as unknown as PrismaService;
  const registry = {
    getDefinitions: registryGetDefinitions,
  } as unknown as WorkItemTypeRegistryService;
  const selector = new AcceptedEvidenceSelectorService(
    prisma,
    new ProjectAccessService(prisma),
    registry,
    () => NOW,
  );
  const service = new ProjectMetricsService(selector);

  return {
    selector,
    service,
    organizationMemberFindUnique,
    projectFindMany,
    outboxEventFindMany,
    taskFindMany,
    registryGetDefinitions,
  };
}

function metricValue(
  response: Awaited<ReturnType<ProjectMetricsService['getProjectMetrics']>>,
  metric: ProjectMetricIdentity,
): number {
  return response.metrics.find((item) => item.metric === metric)?.value ?? -1;
}

describe('ProjectMetricsService', () => {
  it('counts Plan work-item creation and lifecycle through Task events', async () => {
    const harness = createHarness();
    harness.taskFindMany.mockResolvedValue([
      { id: 'plan-1', type: 'PLAN', projectId: PROJECT_A },
      { id: 'stage-1', type: 'PLAN_STAGE', projectId: PROJECT_A },
    ]);
    harness.outboxEventFindMany.mockResolvedValue([
      event({
        id: 'created',
        aggregateId: 'plan-1',
        payload: { task: taskSnapshot('plan-1', 'PLAN', PROJECT_A) },
      }),
      ...['plan-1', 'stage-1'].flatMap((aggregateId) => [
        event({
          id: aggregateId + '-verifying',
          aggregateId,
          eventType: 'task.status_changed',
          payload: { previousStatus: 'IN_PROGRESS', newStatus: 'VERIFYING' },
        }),
        event({
          id: aggregateId + '-completed',
          aggregateId,
          eventType: 'task.status_changed',
          payload: { previousStatus: 'VERIFYING', newStatus: 'COMPLETED' },
        }),
      ]),
    ]);
    const response = await harness.service.getProjectMetrics(
      ORGANIZATION_ID as never,
      USER_ID as never,
    );
    expect(metricValue(response, ProjectMetricIdentity.PlanCreated)).toBe(1);
    expect(metricValue(response, ProjectMetricIdentity.PlanVerifying)).toBe(1);
    expect(metricValue(response, ProjectMetricIdentity.PlanCompleted)).toBe(1);
    expect(
      metricValue(response, ProjectMetricIdentity.ProjectInfoCreated),
    ).toBe(1);
    expect(metricValue(response, ProjectMetricIdentity.TaskCreated)).toBe(0);
    expect(metricValue(response, ProjectMetricIdentity.TaskCompleted)).toBe(0);
  });

  it('returns the closed metric set and zeroes when no evidence is accepted', async () => {
    const harness = createHarness();

    const response = await harness.service.getProjectMetrics(
      ORGANIZATION_ID as never,
      USER_ID as never,
    );

    expect(response.metrics.map((metric) => metric.metric)).toEqual([
      ProjectMetricIdentity.TaskCreated,
      ProjectMetricIdentity.TaskCompleted,
      ProjectMetricIdentity.TaskVerifying,
      ProjectMetricIdentity.BugCreated,
      ProjectMetricIdentity.BugCompleted,
      ProjectMetricIdentity.BugVerifying,
      ProjectMetricIdentity.PlanCreated,
      ProjectMetricIdentity.PlanCompleted,
      ProjectMetricIdentity.PlanVerifying,
      ProjectMetricIdentity.AgentSessionCreated,
      ProjectMetricIdentity.ProjectInfoCreated,
      ProjectMetricIdentity.ProjectInfoUpdated,
    ]);
    expect(response.metrics.every((metric) => metric.value === 0)).toBe(true);
    expect([...response.effectiveProjectIds]).toEqual([PROJECT_A, PROJECT_B]);
    expect(response.windowStart).toBe(WINDOW_START.toISOString());
    expect(response.windowEnd).toBe(NOW.toISOString());
    response.metrics.forEach((metric) => {
      expect(metric.activityContinuation.metric).toBe(metric.metric);
      expect([...metric.activityContinuation.projectIds]).toEqual([
        PROJECT_A,
        PROJECT_B,
      ]);
      expect(metric.activityContinuation.windowStart).toBe(
        WINDOW_START.toISOString(),
      );
      expect(metric.activityContinuation.windowEnd).toBe(NOW.toISOString());
    });
  });

  it('serializes set-backed generated collection fields as JSON arrays', async () => {
    const harness = createHarness();

    const response = await harness.service.getProjectMetrics(
      ORGANIZATION_ID as never,
      USER_ID as never,
    );

    const serialized = JSON.parse(JSON.stringify(response));
    expect(serialized.effectiveProjectIds).toEqual([PROJECT_A, PROJECT_B]);
    expect(serialized.metrics[0].activityContinuation.projectIds).toEqual([
      PROJECT_A,
      PROJECT_B,
    ]);
  });

  it('filters personal evidence by actor and omits Project Info metrics', async () => {
    const harness = createHarness();
    harness.taskFindMany.mockResolvedValue([
      { id: 'mine', type: 'STANDARD', projectId: PROJECT_A },
      { id: 'theirs', type: 'STANDARD', projectId: PROJECT_A },
      { id: 'my-info', type: 'FEATURE', projectId: PROJECT_A },
    ]);
    harness.outboxEventFindMany.mockResolvedValue([
      event({
        id: 'mine-event',
        aggregateId: 'mine',
        payload: { task: taskSnapshot('mine', 'STANDARD', PROJECT_A) },
      }),
      event({
        id: 'their-event',
        aggregateId: 'theirs',
        userId: 'user-2',
        payload: { task: taskSnapshot('theirs', 'STANDARD', PROJECT_A) },
      }),
      event({
        id: 'my-info-event',
        aggregateId: 'my-info',
        payload: { task: taskSnapshot('my-info', 'FEATURE', PROJECT_A) },
      }),
    ]);

    const response = await harness.service.getProjectMetrics(
      ORGANIZATION_ID as never,
      USER_ID as never,
      undefined,
      { mode: 'PERSONAL', userId: USER_ID as never },
    );

    expect(metricValue(response, ProjectMetricIdentity.TaskCreated)).toBe(1);
    expect(response.metrics).toHaveLength(10);
    expect(
      response.metrics.some((metric) =>
        metric.metric.startsWith('PROJECT_INFO_'),
      ),
    ).toBe(false);
    expect(response.actorScope).toEqual({ mode: 'PERSONAL', userId: USER_ID });
    expect(response.metrics[0]?.activityContinuation.actorScope).toEqual(
      response.actorScope,
    );
  });

  it('uses the event timestamp rather than its publication timestamp', async () => {
    const harness = createHarness();
    const beforeStart = new Date(WINDOW_START.getTime() - 1_000);
    const beforeEnd = new Date(NOW.getTime() - 1_000);
    harness.taskFindMany.mockResolvedValue([
      { id: 'task-before-start', type: 'STANDARD', projectId: PROJECT_A },
      { id: 'feature-before-end', type: 'FEATURE', projectId: PROJECT_A },
    ]);
    harness.outboxEventFindMany.mockResolvedValue([
      event({
        id: 'event-at-start',
        createdAt: WINDOW_START,
        processedAt: new Date(WINDOW_START.getTime() + 2_000),
        payload: {
          task: taskSnapshot(
            'task-at-start',
            'STANDARD',
            PROJECT_A,
            WINDOW_START,
          ),
        },
        aggregateId: 'task-at-start',
      }),
      event({
        id: 'status-before-start-processed-inside',
        eventType: 'task.status_changed',
        aggregateId: 'task-before-start',
        createdAt: beforeStart,
        processedAt: new Date(WINDOW_START.getTime() + 1_000),
        payload: { previousStatus: 'ACTIVE', newStatus: 'COMPLETED' },
      }),
      event({
        id: 'update-before-end-processed-after',
        eventType: 'task.updated',
        aggregateId: 'feature-before-end',
        createdAt: beforeEnd,
        processedAt: new Date(NOW.getTime() + 1_000),
        payload: { update: { name: 'renamed' } },
      }),
      event({
        id: 'event-at-end',
        createdAt: NOW,
        processedAt: new Date(NOW.getTime() + 2_000),
        eventType: 'task.created',
        aggregateType: 'task',
        aggregateId: 'plan-at-end',
        payload: {
          task: taskSnapshot('plan-at-end', 'PLAN', PROJECT_A, NOW),
        },
      }),
    ]);

    const response = await harness.service.getProjectMetrics(
      ORGANIZATION_ID as never,
      USER_ID as never,
    );

    expect(metricValue(response, ProjectMetricIdentity.TaskCreated)).toBe(1);
    expect(metricValue(response, ProjectMetricIdentity.TaskCompleted)).toBe(0);
    expect(
      metricValue(response, ProjectMetricIdentity.ProjectInfoUpdated),
    ).toBe(1);
    expect(metricValue(response, ProjectMetricIdentity.PlanCreated)).toBe(0);
    expect(harness.outboxEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: WINDOW_START, lt: NOW },
          status: 'PUBLISHED',
        }),
      }),
    );
  });

  it('deduplicates repeated status entries and canonical agent-session identities', async () => {
    const harness = createHarness();
    harness.taskFindMany.mockResolvedValue([
      { id: 'task-1', type: 'STANDARD', projectId: PROJECT_A },
      { id: 'bug-1', type: 'BUG', projectId: PROJECT_A },
    ]);
    harness.outboxEventFindMany.mockResolvedValue([
      event({
        id: 'task-complete-1',
        eventType: 'task.status_changed',
        aggregateId: 'task-1',
        payload: { previousStatus: 'ACTIVE', newStatus: 'COMPLETED' },
        processedAt: new Date('2026-09-04T09:00:00.000Z'),
      }),
      event({
        id: 'task-complete-2',
        eventType: 'task.status_changed',
        aggregateId: 'task-1',
        payload: { previousStatus: 'ON_HOLD', newStatus: 'COMPLETED' },
        processedAt: new Date('2026-09-04T10:00:00.000Z'),
      }),
      event({
        id: 'task-verifying',
        eventType: 'task.status_changed',
        aggregateId: 'task-1',
        payload: { previousStatus: 'COMPLETED', newStatus: 'VERIFYING' },
      }),
      event({
        id: 'bug-complete',
        eventType: 'task.status_changed',
        aggregateId: 'bug-1',
        payload: { previousStatus: 'ACTIVE', newStatus: 'COMPLETED' },
      }),
      event({
        id: 'agent-create-1',
        eventType: 'agent_session.created',
        aggregateType: 'agent_session',
        aggregateId: 'agent-1',
        payload: {
          agentSession: agentSessionSnapshot('agent-1', PROJECT_A),
        },
      }),
      event({
        id: 'agent-create-2',
        eventType: 'agent_session.created',
        aggregateType: 'agent_session',
        aggregateId: 'agent-1',
        payload: {
          agentSession: {
            ...agentSessionSnapshot('agent-1', PROJECT_A),
            providerAgentSessionId: 'provider-retry-2',
          },
        },
      }),
    ]);

    const response = await harness.service.getProjectMetrics(
      ORGANIZATION_ID as never,
      USER_ID as never,
    );

    expect(metricValue(response, ProjectMetricIdentity.TaskCompleted)).toBe(1);
    expect(metricValue(response, ProjectMetricIdentity.TaskVerifying)).toBe(1);
    expect(metricValue(response, ProjectMetricIdentity.BugCompleted)).toBe(1);
    expect(
      metricValue(response, ProjectMetricIdentity.AgentSessionCreated),
    ).toBe(1);
  });

  it('uses per-project registry roles, the plan adapter, and one logical update', async () => {
    const harness = createHarness();
    harness.taskFindMany.mockResolvedValue([
      { id: 'feature-a', type: 'FEATURE', projectId: PROJECT_A },
      { id: 'feature-b', type: 'FEATURE', projectId: PROJECT_B },
      { id: 'custom-info-b', type: 'CUSTOM_INFO', projectId: PROJECT_B },
    ]);
    harness.outboxEventFindMany.mockResolvedValue([
      event({
        id: 'feature-a-created',
        aggregateId: 'feature-a',
        payload: {
          task: taskSnapshot('feature-a', 'FEATURE', PROJECT_A),
        },
      }),
      event({
        id: 'feature-b-created',
        aggregateId: 'feature-b',
        projectId: PROJECT_B,
        payload: {
          task: taskSnapshot('feature-b', 'FEATURE', PROJECT_B),
        },
      }),
      event({
        id: 'custom-info-created',
        aggregateId: 'custom-info-b',
        projectId: PROJECT_B,
        payload: {
          task: taskSnapshot('custom-info-b', 'CUSTOM_INFO', PROJECT_B),
        },
      }),
      event({
        id: 'feature-a-updated',
        aggregateId: 'feature-a',
        payload: { update: { name: 'renamed' } },
        correlationId: 'logical-feature-update',
        causationId: 'logical-feature-update',
      }),
      event({
        id: 'feature-a-content',
        aggregateId: 'feature-a',
        eventType: 'task.content_changed',
        payload: {
          content: {
            type: 'FEATURE',
            description: 'updated',
          },
        },
        correlationId: 'logical-feature-update',
        causationId: 'logical-feature-update',
      }),
      event({
        id: 'plan-created',
        eventType: 'task.created',
        aggregateType: 'task',
        aggregateId: 'plan-1',
        projectId: PROJECT_B,
        payload: { task: taskSnapshot('plan-1', 'PLAN', PROJECT_B) },
      }),
      event({
        id: 'plan-updated-1',
        eventType: 'task.updated',
        aggregateType: 'task',
        aggregateId: 'plan-1',
        projectId: PROJECT_B,
        payload: { update: { type: 'PLAN', name: 'Updated plan' } },
        correlationId: 'logical-plan-update',
        causationId: 'logical-plan-update',
      }),
      event({
        id: 'plan-updated-2',
        eventType: 'task.updated',
        aggregateType: 'task',
        aggregateId: 'plan-1',
        projectId: PROJECT_B,
        payload: { update: { type: 'PLAN', name: 'Updated plan' } },
        correlationId: 'logical-plan-update',
        causationId: 'logical-plan-update',
      }),
    ]);

    const response = await harness.service.getProjectMetrics(
      ORGANIZATION_ID as never,
      USER_ID as never,
    );

    expect(
      metricValue(response, ProjectMetricIdentity.ProjectInfoCreated),
    ).toBe(3);
    expect(
      metricValue(response, ProjectMetricIdentity.ProjectInfoUpdated),
    ).toBe(2);
    expect(metricValue(response, ProjectMetricIdentity.PlanCreated)).toBe(1);
    expect(harness.registryGetDefinitions).toHaveBeenCalledWith(
      PROJECT_A,
      WorkItemTypeLifecycleStatus.Active,
    );
    expect(harness.registryGetDefinitions).toHaveBeenCalledWith(
      PROJECT_B,
      WorkItemTypeLifecycleStatus.Active,
    );
  });

  it('narrows within the authorized organization scope and rejects inaccessible projects', async () => {
    const harness = createHarness();
    harness.taskFindMany.mockResolvedValue([
      { id: 'task-a', type: 'STANDARD', projectId: PROJECT_A },
      { id: 'task-b', type: 'STANDARD', projectId: PROJECT_B },
    ]);
    harness.outboxEventFindMany.mockResolvedValue([
      event({
        id: 'task-a-created',
        aggregateId: 'task-a',
        payload: { task: taskSnapshot('task-a', 'STANDARD', PROJECT_A) },
      }),
      event({
        id: 'task-b-created',
        aggregateId: 'task-b',
        projectId: PROJECT_B,
        payload: { task: taskSnapshot('task-b', 'STANDARD', PROJECT_B) },
      }),
    ]);

    const response = await harness.service.getProjectMetrics(
      ORGANIZATION_ID as never,
      USER_ID as never,
      PROJECT_B as never,
    );

    expect([...response.effectiveProjectIds]).toEqual([PROJECT_B]);
    expect(metricValue(response, ProjectMetricIdentity.TaskCreated)).toBe(1);

    await expect(
      harness.service.getProjectMetrics(
        ORGANIZATION_ID as never,
        USER_ID as never,
        PROJECT_OTHER_ORGANIZATION as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reuses an exact continuation scope, window, and metric classification', async () => {
    const harness = createHarness();
    harness.outboxEventFindMany.mockResolvedValue([
      event({
        id: 'task-created-in-continuation',
        projectId: PROJECT_B,
        aggregateId: 'task-in-continuation',
        createdAt: WINDOW_START,
        processedAt: new Date(WINDOW_START.getTime() + 2_000),
        payload: {
          task: taskSnapshot(
            'task-in-continuation',
            'STANDARD',
            PROJECT_B,
            WINDOW_START,
          ),
        },
      }),
      event({
        id: 'task-created-at-end',
        projectId: PROJECT_B,
        aggregateId: 'task-at-end',
        payload: {
          task: taskSnapshot('task-at-end', 'STANDARD', PROJECT_B, NOW),
        },
        createdAt: NOW,
        processedAt: new Date(NOW.getTime() + 2_000),
      }),
    ]);

    const result = await harness.selector.select(
      {
        organizationId: ORGANIZATION_ID as never,
        userId: USER_ID as never,
        actorScope: { mode: 'ORGANIZATION' },
      },
      {
        projectIds: [PROJECT_B] as never,
        windowStart: WINDOW_START,
        windowEnd: NOW,
        metric: ProjectMetricIdentity.TaskCreated,
      },
    );

    expect(result.effectiveProjectIds).toEqual([PROJECT_B]);
    expect(result.windowStart).toEqual(WINDOW_START);
    expect(result.windowEnd).toEqual(NOW);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.metric).toBe(ProjectMetricIdentity.TaskCreated);
    expect(harness.outboxEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: { in: [PROJECT_B] },
          createdAt: { gte: WINDOW_START, lt: NOW },
          status: 'PUBLISHED',
        }),
      }),
    );

    await expect(
      harness.selector.select(
        {
          organizationId: ORGANIZATION_ID as never,
          userId: USER_ID as never,
          actorScope: { mode: 'ORGANIZATION' },
        },
        {
          projectIds: [PROJECT_OTHER_ORGANIZATION] as never,
          windowStart: WINDOW_START,
          windowEnd: NOW,
          metric: ProjectMetricIdentity.TaskCreated,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ignores irrelevant and malformed boundary records without inventing classifications', async () => {
    const harness = createHarness();
    harness.outboxEventFindMany.mockResolvedValue([
      event({
        id: 'missing-payload',
        payload: null,
      }),
      event({
        id: 'missing-authoritative-occurrence',
        aggregateId: 'missing-authoritative-occurrence',
        createdAt: new Date(Number.NaN),
        payload: {
          task: taskSnapshot(
            'missing-authoritative-occurrence',
            'STANDARD',
            PROJECT_A,
          ),
        },
      }),
      event({
        id: 'wrong-project',
        projectId: 'project-not-in-scope',
        payload: { task: taskSnapshot('wrong-project', 'STANDARD', PROJECT_A) },
      }),
      event({
        id: 'missing-task-type',
        aggregateId: 'missing-task-type',
        payload: {
          task: { id: 'missing-task-type', projectId: PROJECT_A },
        },
      }),
      event({
        id: 'irrelevant-status',
        eventType: 'task.status_changed',
        payload: {
          previousStatus: 'ACTIVE',
          newStatus: 'ON_HOLD',
        },
      }),
      event({
        id: 'same-status-entry',
        eventType: 'task.status_changed',
        payload: {
          previousStatus: 'COMPLETED',
          newStatus: 'COMPLETED',
        },
      }),
      event({
        id: 'replayed-task-created',
        headers: { replayed: true, replaySourceEventId: 'original-event' },
        payload: {
          task: taskSnapshot('replayed-task', 'STANDARD', PROJECT_A),
        },
      }),
    ]);

    const response = await harness.service.getProjectMetrics(
      ORGANIZATION_ID as never,
      USER_ID as never,
    );

    expect(response.metrics.every((metric) => metric.value === 0)).toBe(true);
    expect(harness.outboxEventFindMany).toHaveBeenCalledTimes(1);
  });

  it('requires an active organization membership before resolving projects', async () => {
    const harness = createHarness();
    harness.organizationMemberFindUnique.mockResolvedValue(null);

    await expect(
      harness.service.getProjectMetrics(
        ORGANIZATION_ID as never,
        USER_ID as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.projectFindMany).not.toHaveBeenCalled();
  });
});
