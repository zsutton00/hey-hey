import { isAxiosError } from 'axios';

import type { LocalRollupProposalPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import type {
  PromptTypeHandler,
  PromptTypeHandlerDeps,
  PrepareResult,
} from '../prompt-type-handler';
import type { AgenticSession } from '../../session/types';
import type {
  TriggeringTask,
  AncestorTask,
  RollupProposalPromptInput,
} from './rollup-proposal-prompt';
import { buildRollupProposalPrompt } from './rollup-proposal-prompt';
import { Configuration, TasksApi, type TaskResponseDto } from '../../shared/api/generated';

type EnrichedPayload = LocalRollupProposalPromptPayload & {
  _enriched?: RollupProposalPromptInput;
};

type RollupTasksClient = Pick<
  TasksApi,
  'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet'
>;

interface TaskReadScope {
  client: RollupTasksClient;
  organizationId: string;
  projectId: string;
}

const toTaskSections = (sections: TaskResponseDto['sections']) =>
  (sections ?? []).map((s) => ({ key: s.key, content: s.materializedMarkdown }));

const readTask = async (scope: TaskReadScope, taskId: string): Promise<TaskResponseDto> => {
  let task: TaskResponseDto | undefined;
  try {
    const response = await scope.client.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      taskId,
    });
    task = response.data.data;
  } catch (error) {
    if (!isAxiosError(error)) throw error;
    const status = error.response ? String(error.response.status) : 'no response';
    throw new Error(
      `Rollup proposal could not read task ${taskId} (organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet): HTTP ${status}.`,
      { cause: error },
    );
  }
  if (!task) {
    throw new Error(`Rollup proposal received no task body for ${taskId}.`);
  }
  return task;
};

/**
 * Walks up the parent chain from the triggering task, fetching each ancestor.
 * Returns ancestors ordered closest-first (direct parent at index 0).
 * Stops at a reasonable depth to avoid unbounded fetches.
 */
const readAncestors = async (
  scope: TaskReadScope,
  triggeringTask: TaskResponseDto,
  maxDepth = 5,
): Promise<TaskResponseDto[]> => {
  const ancestors: TaskResponseDto[] = [];
  let currentParentId = triggeringTask.parentTaskId;

  while (currentParentId && ancestors.length < maxDepth) {
    const parent = await readTask(scope, currentParentId);
    ancestors.push(parent);
    currentParentId = parent.parentTaskId;
  }

  return ancestors;
};

export const rollupProposalHandler: PromptTypeHandler<LocalRollupProposalPromptPayload> = {
  id: 'rollup_proposal',
  promptType: 'rollup_proposal',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'none',
  expectedResponseTypes: ['rollup_proposal_v1'],
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],

  async prepare(
    run: AgenticSession,
    payload: LocalRollupProposalPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<LocalRollupProposalPromptPayload>> {
    const { organizationId, projectId } = run.contextMetadata;
    if (!organizationId || !projectId) {
      deps.logger.warn('rollup_proposal.prepare.missing_context', {
        runId: run.agentic_session_id,
        hasOrganizationId: !!organizationId,
        hasProjectId: !!projectId,
      });
      return { payload };
    }

    const accessToken = await deps.auth.getAccessToken();
    const scope: TaskReadScope = {
      client: new TasksApi(new Configuration({ accessToken, basePath: deps.apiBaseUrl })),
      organizationId,
      projectId,
    };
    const taskData = await readTask(scope, payload.taskId);
    const ancestorData = await readAncestors(scope, taskData);

    deps.logger.debug('rollup_proposal.prepare.fetched', {
      runId: run.agentic_session_id,
      taskId: payload.taskId,
      ancestorCount: ancestorData.length,
    });

    const triggeringTask: TriggeringTask = {
      id: taskData.id,
      title: taskData.name,
      status: taskData.status,
    };

    const ancestors: AncestorTask[] = ancestorData.map((t) => ({
      id: t.id,
      title: t.name,
      status: t.status,
      sections: toTaskSections(t.sections),
    }));

    const enriched: EnrichedPayload = {
      ...payload,
      _enriched: { triggeringTask, ancestors, projectId },
    };

    return { payload: enriched };
  },

  buildPrompt(payload: LocalRollupProposalPromptPayload): string {
    const enriched = (payload as EnrichedPayload)._enriched;
    if (enriched) {
      return buildRollupProposalPrompt(enriched);
    }
    // Fallback: prepare was skipped (missing context).
    return buildRollupProposalPrompt({
      triggeringTask: { id: payload.taskId, title: payload.taskId, status: '' },
      ancestors: [],
      projectId: '',
    });
  },

  buildStartingMessage(): string | null {
    return 'Analyzing task and generating feature rollup proposals...';
  },
};
