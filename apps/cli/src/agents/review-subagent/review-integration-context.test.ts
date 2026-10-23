import { describe, expect, it, vi } from 'vitest';

import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  TaskSource,
  WorkStatus,
  type AgentEdgeResponseDto,
  type TaskResponseDto,
} from '../../shared/api/generated';
import type { AgenticSession } from '../../session/types';
import type { ServerLogger } from '../../server/logger';
import type { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';
import { ReviewIntegrationContextResolver } from './review-integration-context';

const logger = (): ServerLogger => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

const task = (
  id: string,
  serviceIds: readonly string[],
  overrides: Partial<TaskResponseDto> = {},
): TaskResponseDto => ({
  id,
  name: id,
  type: 'STANDARD',
  organizationId: 'org-1',
  projectId: 'project-1',
  status: WorkStatus.Active,
  source: TaskSource.Agent,
  serviceRelations: serviceIds.map((serviceId) => ({
    id: `${id}-${serviceId}`,
    serviceId,
    taskId: id,
    createdAt: '2026-09-16T00:00:00.000Z',
  })),
  ...overrides,
});

const dependencyEdge = (
  sourceNodeId: string,
  targetNodeId: string,
  overrides: Partial<AgentEdgeResponseDto> = {},
): AgentEdgeResponseDto => ({
  id: `${sourceNodeId}-${targetNodeId}`,
  sourceNodeId,
  sourceEntityType: AgentEdgeEndpointEntityType.Task,
  targetNodeId,
  targetEntityType: AgentEdgeEndpointEntityType.Task,
  type: AgentEdgeType.DependsOn,
  reasoning: 'Required first.',
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
  ...overrides,
});

const run = (serviceIds: readonly string[], withTask = true): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    entity: withTask ? { entityType: 'TASK', entityId: 'origin' } : null,
    services: serviceIds.map((id) => ({ id, path: `/repos/${id}` })),
    contextMetadata: {
      capturedAt: '2026-09-16T00:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: 'run-1',
      userComments: [],
      fileReferences: { references: [] },
    },
  }) as unknown as AgenticSession;

const resolver = (origin: TaskResponseDto, dependencies: readonly TaskResponseDto[]) => {
  const getTask = vi.fn().mockResolvedValue({ data: { data: origin } });
  const listTasks = vi.fn().mockResolvedValue({ data: { data: dependencies } });
  const auth = {
    getAccessToken: vi.fn().mockResolvedValue('token'),
  } as unknown as SubmissionToolAuth;
  const instance = new ReviewIntegrationContextResolver({
    auth,
    apiBaseUrl: 'https://api.example.test',
    logger: logger(),
    createClient: () =>
      ({
        organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet: getTask,
        organizationsOrganizationIdProjectsProjectIdTasksGet: listTasks,
      }) as never,
  });
  return { instance, getTask, listTasks, auth };
};

describe('ReviewIntegrationContextResolver', () => {
  it('detects a multi-Service Run before attempting a task lookup', async () => {
    const setup = resolver(task('origin', ['service-a']), []);

    await expect(setup.instance.resolve(run(['service-a', 'service-b']))).resolves.toEqual({
      trigger: 'multi_service_run',
      selectedServiceIds: ['service-a', 'service-b'],
    });
    expect(setup.auth.getAccessToken).not.toHaveBeenCalled();
    expect(setup.getTask).not.toHaveBeenCalled();
  });

  it('detects a direct outbound dependency assigned to another Service', async () => {
    const origin = task('origin', ['service-a'], {
      edges: [dependencyEdge('origin', 'dependency-cross-service')],
    });
    const setup = resolver(origin, [task('dependency-cross-service', ['service-b'])]);

    await expect(setup.instance.resolve(run(['service-a']))).resolves.toEqual({
      trigger: 'cross_service_dependency',
      selectedServiceIds: ['service-a'],
      originatingTaskId: 'origin',
      originatingTaskServiceIds: ['service-a'],
      dependencyTaskIds: ['dependency-cross-service'],
      dependencyServiceIds: ['service-b'],
    });
    expect(setup.getTask).toHaveBeenCalledWith(
      expect.objectContaining({
        includeServiceRelations: true,
        includeEdges: true,
        edgeTypes: [AgentEdgeType.DependsOn],
      }),
    );
    expect(setup.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        taskIds: new Set(['dependency-cross-service']),
        includeServiceRelations: true,
      }),
    );
  });

  it('ignores same-Service, archived, inbound, and non-task dependencies', async () => {
    const origin = task('origin', ['service-a'], {
      edges: [
        dependencyEdge('origin', 'same-service'),
        dependencyEdge('origin', 'archived-cross-service'),
        dependencyEdge('inbound-source', 'origin'),
        dependencyEdge('origin', 'service-target', {
          targetEntityType: AgentEdgeEndpointEntityType.Service,
        }),
      ],
    });
    const setup = resolver(origin, [
      task('same-service', ['service-a']),
      task('archived-cross-service', ['service-b'], { status: WorkStatus.Archived }),
    ]);

    await expect(setup.instance.resolve(run(['service-a']))).resolves.toBeNull();
    expect(setup.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ taskIds: new Set(['same-service', 'archived-cross-service']) }),
    );
  });

  it('does not query dependencies when no task or no direct edge is available', async () => {
    const setup = resolver(task('origin', ['service-a'], { edges: [] }), []);

    await expect(setup.instance.resolve(run(['service-a'], false))).resolves.toBeNull();
    expect(setup.getTask).not.toHaveBeenCalled();

    await expect(setup.instance.resolve(run(['service-a']))).resolves.toBeNull();
    expect(setup.getTask).toHaveBeenCalledOnce();
    expect(setup.listTasks).not.toHaveBeenCalled();
  });
});
