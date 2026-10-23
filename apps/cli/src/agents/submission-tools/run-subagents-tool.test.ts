import { describe, expect, it, vi } from 'vitest';

import { createTestRun } from '../../run/run.test-support';
import { RunEntityReferenceEntityTypeEnum } from '../../shared/agent-bridge-contract/generated/api';
import type { Turn } from '../../turn/turn';
import type { ProjectAssistantPolicy } from '../prompt-type-handler';
import {
  SubagentFanoutUnavailableError,
  type SubagentFanout,
} from '../subagent-fanout/subagent-fanout-runtime';
import { RunSubagentsTool } from './run-subagents-tool';
import { SubmissionToolCorrectableError } from './types';

const EDIT_POLICY: ProjectAssistantPolicy = {
  allowEdgeUpdates: false,
  notifyDiscrepancies: true,
  workItemProposalMode: 'edit',
};

/** A Run in the middle of a Project Assistant Turn on a task. */
const createProjectAssistantRun = (policy: ProjectAssistantPolicy = EDIT_POLICY) => {
  const run = createTestRun({ conversationId: 'conv-test', projectId: 'proj-test' });
  run.session.entity = { entityType: RunEntityReferenceEntityTypeEnum.Task, entityId: 'task-1' };
  const controller = new AbortController();
  run.activeTurn = {
    turnId: 'turn-1',
    abortSignal: controller.signal,
    payload: { projectAssistantHandoff: { consumerHandlerId: 'coding_agent', policy } },
  } as unknown as Turn;
  return { run, controller };
};

const execute = (tool: RunSubagentsTool, objectives: unknown) => {
  const { run } = createProjectAssistantRun();
  return { run, result: tool.execute({ runId: 'run-1', args: { objectives }, run }) };
};

const boundTool = (fanout: SubagentFanout['run']) => {
  const tool = new RunSubagentsTool();
  const run = vi.fn(fanout);
  tool.bindFanout({ run });
  return { tool, run };
};

describe('RunSubagentsTool', () => {
  it.each([
    ['no objectives', []],
    ['more than five objectives', ['a', 'b', 'c', 'd', 'e', 'f']],
    ['a blank objective', ['a', '  ']],
    ['a non-array value', 'a'],
  ])('rejects %s as a correctable error without starting children', async (_label, objectives) => {
    const { tool, run } = boundTool(() => Promise.resolve([]));

    await expect(execute(tool, objectives).result).rejects.toBeInstanceOf(
      SubmissionToolCorrectableError,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('declares the objective bounds in its schema', () => {
    expect(new RunSubagentsTool().inputSchema).toMatchObject({
      properties: { objectives: { minItems: 1, maxItems: 5 } },
      required: ['objectives'],
    });
  });

  it('returns a correctable error while the fan-out is unbound or unavailable', async () => {
    await expect(execute(new RunSubagentsTool(), ['a']).result).rejects.toBeInstanceOf(
      SubmissionToolCorrectableError,
    );

    const { tool } = boundTool(() => Promise.reject(new SubagentFanoutUnavailableError()));
    await expect(execute(tool, ['a']).result).rejects.toMatchObject({
      name: 'SubmissionToolCorrectableError',
      findings: [{ identity: 'run_subagents' }],
    });
  });

  it('runs the trimmed objectives for the parent Run and returns results in request order', async () => {
    const { tool, run: fanoutRun } = boundTool(() =>
      Promise.resolve([
        { objective: 'first angle', outcome: 'succeeded', outputText: 'First findings.' },
        { objective: 'second angle', outcome: 'failed', reason: 'provider crashed' },
      ]),
    );

    const { run, result } = execute(tool, [' first angle ', 'second angle']);
    const output = await result;

    expect(fanoutRun).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSession: run.session,
        parentRunId: 'run-1',
        objectives: ['first angle', 'second angle'],
      }),
    );
    const text = String(output.content[0]?.['text']);
    expect(text.indexOf('### 1. first angle')).toBeLessThan(text.indexOf('### 2. second angle'));
    expect(text).toContain('Outcome: succeeded\n\nFirst findings.');
    expect(text).toContain('Outcome: failed — provider crashed\n\n(No final text.)');
  });

  it('passes the parent Turn abort signal to the fan-out', async () => {
    const { tool, run: fanoutRun } = boundTool(() => Promise.resolve([]));
    const { run, controller } = createProjectAssistantRun();

    await tool.execute({ runId: 'run-1', args: { objectives: ['a'] }, run });

    expect(fanoutRun.mock.calls[0]?.[0].signal).toBe(controller.signal);
    expect(fanoutRun.mock.calls[0]?.[0].parentTurnId).toBe('turn-1');
  });

  it.each([
    ['none', false],
    ['edit', true],
    ['all', true],
  ] as const)(
    "passes the parent's %s proposal gate to every child",
    async (workItemProposalMode, fulfilledBySuggestionEligible) => {
      const { tool, run: fanoutRun } = boundTool(() => Promise.resolve([]));
      const policy: ProjectAssistantPolicy = { ...EDIT_POLICY, workItemProposalMode };
      const { run } = createProjectAssistantRun(policy);

      await tool.execute({ runId: 'run-1', args: { objectives: ['a'] }, run });

      expect(fanoutRun.mock.calls[0]?.[0].projectAssistantChecks).toEqual({
        policy,
        fulfilledBySuggestionEligible,
      });
    },
  );

  it('refuses to be bound twice', () => {
    const tool = new RunSubagentsTool();
    tool.bindFanout({ run: () => Promise.resolve([]) });
    expect(() => {
      tool.bindFanout({ run: () => Promise.resolve([]) });
    }).toThrow('already bound');
  });
});
