import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  Configuration,
  TasksApi,
  WorkStatus,
  type TaskResponseDto,
} from '../../shared/api/generated';
import type { AgenticSession } from '../../session/types';
import type { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';
import type { ServerLogger } from '../../server/logger';
import { taskIdFromSession } from '../run-entity';

export type ReviewIntegrationContext =
  | {
      trigger: 'multi_service_run';
      selectedServiceIds: readonly string[];
    }
  | {
      trigger: 'cross_service_dependency';
      selectedServiceIds: readonly string[];
      originatingTaskId: string;
      originatingTaskServiceIds: readonly string[];
      dependencyTaskIds: readonly string[];
      dependencyServiceIds: readonly string[];
    };

type ReviewTasksClient = Pick<
  TasksApi,
  | 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet'
  | 'organizationsOrganizationIdProjectsProjectIdTasksGet'
>;

interface ReviewIntegrationContextResolverOptions {
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  logger: ServerLogger;
  createClient?: (accessToken: string) => ReviewTasksClient;
}

const unique = (values: Iterable<string>): string[] => [...new Set(values)];

const serviceIdsForTask = (task: TaskResponseDto): string[] =>
  unique((task.serviceRelations ?? []).map((relation) => relation.serviceId));

const isArchived = (task: TaskResponseDto): boolean =>
  task.status === WorkStatus.Archived || Boolean(task.archivedAt);

export class ReviewIntegrationContextResolver {
  private readonly auth: SubmissionToolAuth;
  private readonly logger: ServerLogger;
  private readonly createClient: (accessToken: string) => ReviewTasksClient;

  public constructor(options: ReviewIntegrationContextResolverOptions) {
    this.auth = options.auth;
    this.logger = options.logger;
    this.createClient =
      options.createClient ??
      ((accessToken) =>
        new TasksApi(new Configuration({ accessToken, basePath: options.apiBaseUrl })));
  }

  public async resolve(run: AgenticSession): Promise<ReviewIntegrationContext | null> {
    const selectedServiceIds = unique((run.services ?? []).map((service) => service.id));
    if (selectedServiceIds.length > 1) {
      this.logger.debug('local.review.integration_context.multi_service_run', {
        runId: run.agentic_session_id,
        selectedServiceIds,
      });
      return { trigger: 'multi_service_run', selectedServiceIds };
    }

    const originatingTaskId = taskIdFromSession(run);
    if (!originatingTaskId) {
      this.logger.debug('local.review.integration_context.no_originating_task', {
        runId: run.agentic_session_id,
        selectedServiceCount: selectedServiceIds.length,
      });
      return null;
    }

    const { organizationId, projectId } = run.contextMetadata;
    if (!organizationId || !projectId) {
      this.logger.warn('local.review.integration_context.missing_project_context', {
        runId: run.agentic_session_id,
        originatingTaskId,
        hasOrganizationId: Boolean(organizationId),
        hasProjectId: Boolean(projectId),
      });
      return null;
    }

    let client: ReviewTasksClient;
    try {
      client = this.createClient(await this.auth.getAccessToken());
    } catch (error) {
      this.logger.warn('local.review.integration_context.auth_failed', {
        runId: run.agentic_session_id,
        originatingTaskId,
        error,
      });
      return null;
    }

    let originatingTask: TaskResponseDto | undefined;
    try {
      const response = await client.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet({
        organizationId,
        projectId,
        taskId: originatingTaskId,
        includeServiceRelations: true,
        includeEdges: true,
        edgeTypes: [AgentEdgeType.DependsOn],
      });
      originatingTask = response.data.data;
    } catch (error) {
      this.logger.warn('local.review.integration_context.originating_task_read_failed', {
        runId: run.agentic_session_id,
        originatingTaskId,
        error,
      });
      return null;
    }

    if (!originatingTask) {
      this.logger.warn('local.review.integration_context.originating_task_missing', {
        runId: run.agentic_session_id,
        originatingTaskId,
      });
      return null;
    }

    const originatingTaskServiceIds = serviceIdsForTask(originatingTask);
    const dependencyTaskIds = unique(
      (originatingTask.edges ?? [])
        .filter(
          (edge) =>
            edge.type === AgentEdgeType.DependsOn &&
            edge.sourceNodeId === originatingTaskId &&
            edge.targetEntityType === AgentEdgeEndpointEntityType.Task,
        )
        .map((edge) => edge.targetNodeId),
    );

    this.logger.debug('local.review.integration_context.direct_dependencies_resolved', {
      runId: run.agentic_session_id,
      originatingTaskId,
      originatingTaskServiceIds,
      dependencyTaskIds,
    });

    if (dependencyTaskIds.length === 0) return null;

    let dependencyTasks: TaskResponseDto[];
    try {
      const response = await client.organizationsOrganizationIdProjectsProjectIdTasksGet({
        organizationId,
        projectId,
        taskIds: new Set(dependencyTaskIds),
        includeServiceRelations: true,
        limit: dependencyTaskIds.length,
      });
      dependencyTasks = response.data.data ?? [];
    } catch (error) {
      this.logger.warn('local.review.integration_context.dependencies_read_failed', {
        runId: run.agentic_session_id,
        originatingTaskId,
        dependencyTaskIds,
        error,
      });
      return null;
    }

    const originatingServiceSet = new Set(originatingTaskServiceIds);
    const crossServiceDependencies = dependencyTasks.filter(
      (task) =>
        dependencyTaskIds.includes(task.id) &&
        !isArchived(task) &&
        serviceIdsForTask(task).some((serviceId) => !originatingServiceSet.has(serviceId)),
    );
    const dependencyServiceIds = unique(crossServiceDependencies.flatMap(serviceIdsForTask));

    if (crossServiceDependencies.length === 0) {
      this.logger.debug('local.review.integration_context.no_cross_service_dependency', {
        runId: run.agentic_session_id,
        originatingTaskId,
        loadedDependencyCount: dependencyTasks.length,
      });
      return null;
    }

    const crossServiceDependencyTaskIds = crossServiceDependencies.map((task) => task.id);
    this.logger.debug('local.review.integration_context.cross_service_dependency', {
      runId: run.agentic_session_id,
      originatingTaskId,
      originatingTaskServiceIds,
      dependencyTaskIds: crossServiceDependencyTaskIds,
      dependencyServiceIds,
    });
    return {
      trigger: 'cross_service_dependency',
      selectedServiceIds,
      originatingTaskId,
      originatingTaskServiceIds,
      dependencyTaskIds: crossServiceDependencyTaskIds,
      dependencyServiceIds,
    };
  }
}
