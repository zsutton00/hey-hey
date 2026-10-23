import { AxiosError } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TasksApi, type TaskResponseDto } from '../../../shared/api/generated';
import type { AgenticSession } from '../../../session/types';
import type { LocalRollupProposalPromptPayload } from '../../../shared/agent-bridge-contract/runtime-types';
import type { PromptTypeHandlerDeps } from '../../prompt-type-handler';
import { rollupProposalHandler } from '../rollup-proposal.handler';

type TaskGetResult = Awaited<
  ReturnType<TasksApi['organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet']>
>;

const makeDeps = (): PromptTypeHandlerDeps =>
  ({
    auth: { getAccessToken: vi.fn().mockResolvedValue('token-1') },
    apiBaseUrl: 'http://platform.test',
    fetchImpl: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
  }) as unknown as PromptTypeHandlerDeps;

const makeRun = (): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
  }) as unknown as AgenticSession;

const payload = { taskId: 'task-1' } as LocalRollupProposalPromptPayload;

const taskResult = (task: Partial<TaskResponseDto>): TaskGetResult =>
  ({ data: { success: true, message: 'ok', data: task } }) as unknown as TaskGetResult;

const prepare = (...args: Parameters<NonNullable<typeof rollupProposalHandler.prepare>>) => {
  if (!rollupProposalHandler.prepare) throw new Error('rollup proposal handler must prepare');
  return rollupProposalHandler.prepare(...args);
};

describe('rollupProposalHandler.prepare', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the task and its ancestors through the project-scoped task route', async () => {
    const tasks: Record<string, Partial<TaskResponseDto>> = {
      'task-1': {
        id: 'task-1',
        name: 'Task',
        status: 'ACTIVE',
        parentTaskId: 'feature-1',
      },
      'feature-1': {
        id: 'feature-1',
        name: 'Feature',
        status: 'ACTIVE',
        sections: [{ key: 'description', materializedMarkdown: 'Feature body.' } as never],
      },
    };
    const read = vi
      .spyOn(TasksApi.prototype, 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet')
      .mockImplementation(({ taskId }) => Promise.resolve(taskResult(tasks[taskId] ?? {})));

    const prepared = await prepare(makeRun(), payload, makeDeps());
    const prompt = rollupProposalHandler.buildPrompt(prepared.payload);

    expect(read).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      taskId: 'feature-1',
    });
    expect(prompt).toContain('**ID:** feature-1');
    expect(prompt).toContain('Feature body.');
  });

  it('fails prepare with the operation and status when an ancestor cannot be read', async () => {
    vi.spyOn(TasksApi.prototype, 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet')
      .mockResolvedValueOnce(taskResult({ id: 'task-1', name: 'Task', parentTaskId: 'feature-1' }))
      .mockRejectedValueOnce(
        new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, null, {
          status: 404,
        } as never),
      );

    await expect(prepare(makeRun(), payload, makeDeps())).rejects.toThrow(
      'Rollup proposal could not read task feature-1 (organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet): HTTP 404.',
    );
  });
});
