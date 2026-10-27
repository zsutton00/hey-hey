import { describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../session/types';
import { ChildAgentLauncher } from '../../run/child-agent-launcher';
import type { PreparationRecords } from '../preparation-records';
import {
  createPromptTypeHandlerTestDeps,
  createPromptTypeHandlerTestRunStore,
} from '../prompt-type-handler.test-support';
import { researchHandler } from '../research/research.handler';
import { EvalChildExecution } from './eval-child-execution';

describe('EvalChildExecution preparation', () => {
  it.each(['rejected', 'incomplete'] as const)(
    'fails the attempt when required Project Assistant preparation is %s',
    async (outcome) => {
      const deps = createPromptTypeHandlerTestDeps();
      const launcher = deps.childAgentLauncher as ChildAgentLauncher;
      const launch = vi.spyOn(launcher, 'launchRegistered');
      if (outcome === 'rejected') launch.mockRejectedValue(new Error('Preparation failed.'));
      else launch.mockResolvedValue({ assistantCompleted: false, usage: {} });
      const prepare = vi.fn(researchHandler.prepare!);
      const execution = new EvalChildExecution(
        {
          parentSession: {} as AgenticSession,
          handler: {
            ...researchHandler,
            projectAssistant: {
              allowEdgeUpdates: false,
              notifyDiscrepancies: false,
              workItemProposalMode: 'none',
            },
            prepare,
          },
          payload: { userMessage: 'Research the feature.' },
          entity: { entityType: 'TASK', entityId: 'focal' },
          handlerDeps: deps,
          signal: new AbortController().signal,
          evalExecution: {
            attemptId: 'attempt',
            targetSessionId: 'target',
            targetConversationId: 'conversation',
          },
        },
        {
          services: [],
          contextMetadata: { organizationId: 'organization', projectId: 'project' },
        } as unknown as AgenticSession,
        launcher,
      );

      await expect(execution.prepare()).rejects.toThrow(
        outcome === 'rejected' ? 'Preparation failed.' : 'without a completed research report',
      );
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it('keeps preparation records with the attempt and out of the local run store', async () => {
    const runStore = createPromptTypeHandlerTestRunStore();
    const deps = createPromptTypeHandlerTestDeps({ runStore });
    const append = vi.spyOn(runStore, 'appendRunGatherTrace');
    let traced: unknown;
    const execution = new EvalChildExecution(
      {
        parentSession: {} as AgenticSession,
        handler: {
          ...researchHandler,
          prepare: async (_run, payload, handlerDeps) => {
            traced = await handlerDeps.preparationRecords.appendGatherTrace('target', {
              turnId: 'attempt',
            } as Parameters<PreparationRecords['appendGatherTrace']>[1]);
            return { payload };
          },
        },
        payload: { userMessage: 'Research the feature.' },
        entity: { entityType: 'TASK', entityId: 'focal' },
        handlerDeps: deps,
        signal: new AbortController().signal,
        evalExecution: {
          attemptId: 'attempt',
          targetSessionId: 'target',
          targetConversationId: 'conversation',
        },
      },
      {
        services: [],
        contextMetadata: { organizationId: 'organization', projectId: 'project' },
      } as unknown as AgenticSession,
      deps.childAgentLauncher as ChildAgentLauncher,
    );

    await execution.prepare();

    expect(traced).toMatchObject({ turnId: 'attempt', round: 1 });
    expect(execution.preparationRecords.gatherTraces).toEqual([traced]);
    expect(append).not.toHaveBeenCalled();
  });
});
