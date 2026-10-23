import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RegisteredChildLaunchRequest } from '../../../run/child-agent-launcher';
import type { ProjectAssistantChildChecks } from '../../prompts/project-assistant';
import type { SubAgentResult } from '../../../run/subagent';
import { NOOP_LOGGER } from '../../../server/logger';
import type { AgenticSession } from '../../../session/types';
import { MachineStateStore } from '../../../state-machine';
import { subagentFanoutStateStoreCodec } from '../machine';
import {
  SubagentFanoutRuntime,
  SubagentFanoutUnavailableError,
  type SubagentFanoutRequest,
} from '../subagent-fanout-runtime';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

const createStorePath = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-fanout-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'subagent-fanout.json');
};

interface PendingLaunch {
  readonly handlerId: string;
  readonly request: RegisteredChildLaunchRequest;
  readonly resolve: (result: SubAgentResult) => void;
  readonly reject: (error: Error) => void;
}

/** A launcher whose children stay running until the test settles them. */
const createGatedLauncher = () => {
  const launches: PendingLaunch[] = [];
  const launcher = {
    launchRegistered: vi.fn(
      (handlerId: string, request: RegisteredChildLaunchRequest) =>
        new Promise<SubAgentResult>((resolve, reject) => {
          launches.push({ handlerId, request, resolve, reject });
          request.signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    ),
  };
  const objectiveOf = (launch: PendingLaunch): string =>
    (launch.request.payload as { userMessage: string }).userMessage;
  const find = (objective: string): PendingLaunch => {
    const launch = launches.find((candidate) => objectiveOf(candidate) === objective);
    if (!launch) throw new Error(`No child launched for ${objective}.`);
    return launch;
  };
  return { launcher, launches, find };
};

const parentSession = {
  agentic_session_id: 'parent-run',
  model: 'parent-model',
} as unknown as AgenticSession;

const projectAssistantChecks: ProjectAssistantChildChecks = {
  policy: { allowEdgeUpdates: false, notifyDiscrepancies: true, workItemProposalMode: 'edit' },
  fulfilledBySuggestionEligible: true,
};

const request = (
  objectives: readonly string[],
  signal: AbortSignal = new AbortController().signal,
): SubagentFanoutRequest => ({
  parentSession,
  parentRunId: 'parent-run',
  parentTurnId: 'parent-turn',
  objectives,
  projectAssistantChecks,
  signal,
});

const startRuntime = async (
  storePath: string,
  launcher: ReturnType<typeof createGatedLauncher>['launcher'],
  instanceIds: readonly string[] = ['fanout-1', 'fanout-2'],
) => {
  const ids = [...instanceIds];
  const runtime = new SubagentFanoutRuntime({
    storePath,
    childAgentLauncher: launcher,
    logger: NOOP_LOGGER,
    randomId: () => ids.shift() ?? 'fanout-extra',
  });
  await runtime.restore();
  runtime.startLiveProcessing();
  return runtime;
};

describe('SubagentFanoutRuntime', () => {
  it('runs every child of one call in parallel and returns results in request order', async () => {
    const storePath = await createStorePath();
    const gated = createGatedLauncher();
    const runtime = await startRuntime(storePath, gated.launcher);

    const results = runtime.run(request(['angle A', 'angle B', 'angle C']));
    await vi.waitFor(() => {
      expect(gated.launches).toHaveLength(3);
    });
    for (const launch of gated.launches) {
      expect(launch.handlerId).toBe('research');
      expect(launch.request.parentSession).toBe(parentSession);
      expect(launch.request.model).toBe('parent-model');
      // Child output stays in the tool result; it never streams into the parent Turn.
      expect(launch.request.onAgentOutput).toBeUndefined();
      // The parent has no launch Service, so each child runs graph-only.
      expect(launch.request.serviceIds).toEqual([]);
      // Each child runs the research checks under the parent's resolved gates.
      expect(launch.request.payload).toMatchObject({
        _projectAssistantChecks: projectAssistantChecks,
      });
    }

    gated.find('angle C').resolve({ assistantCompleted: true, usage: {}, outputText: 'C found' });
    gated.find('angle A').reject(new Error('provider crashed'));
    gated.find('angle B').resolve({ assistantCompleted: true, usage: {}, outputText: 'B found' });

    await expect(results).resolves.toEqual([
      { objective: 'angle A', outcome: 'failed', reason: 'provider crashed' },
      { objective: 'angle B', outcome: 'succeeded', outputText: 'B found' },
      { objective: 'angle C', outcome: 'succeeded', outputText: 'C found' },
    ]);
    runtime.stopClaiming();
  });

  it('lets a child share the workspace of a parent with a launch Service', async () => {
    const storePath = await createStorePath();
    const gated = createGatedLauncher();
    const runtime = await startRuntime(storePath, gated.launcher);
    const serviceParent = { ...parentSession, launchServiceId: 'service-1' } as AgenticSession;

    const results = runtime.run({ ...request(['angle A']), parentSession: serviceParent });
    await vi.waitFor(() => {
      expect(gated.launches).toHaveLength(1);
    });
    expect(gated.find('angle A').request.serviceIds).toBeUndefined();

    gated.find('angle A').resolve({ assistantCompleted: true, usage: {}, outputText: 'A found' });
    await expect(results).resolves.toEqual([
      { objective: 'angle A', outcome: 'succeeded', outputText: 'A found' },
    ]);
    runtime.stopClaiming();
  });

  it('records a child that ends without completing its answer as failed', async () => {
    const storePath = await createStorePath();
    const gated = createGatedLauncher();
    const runtime = await startRuntime(storePath, gated.launcher);

    const results = runtime.run(request(['angle A']));
    await vi.waitFor(() => {
      expect(gated.launches).toHaveLength(1);
    });
    gated.find('angle A').resolve({ assistantCompleted: false, usage: {}, outputText: 'partial' });

    await expect(results).resolves.toEqual([
      {
        objective: 'angle A',
        outcome: 'failed',
        outputText: 'partial',
        reason: 'The research child ended without completing its answer.',
      },
    ]);
    runtime.stopClaiming();
  });

  it('cancels running children when the parent Turn aborts', async () => {
    const storePath = await createStorePath();
    const gated = createGatedLauncher();
    const runtime = await startRuntime(storePath, gated.launcher);
    const controller = new AbortController();

    const results = runtime.run(request(['angle A', 'angle B'], controller.signal));
    await vi.waitFor(() => {
      expect(gated.launches).toHaveLength(2);
    });
    controller.abort();

    await expect(results).resolves.toEqual([
      { objective: 'angle A', outcome: 'cancelled', reason: 'The parent turn was cancelled.' },
      { objective: 'angle B', outcome: 'cancelled', reason: 'The parent turn was cancelled.' },
    ]);
    runtime.stopClaiming();
  });

  it('settles unfinished children as interrupted after a restart without running them again', async () => {
    const storePath = await createStorePath();
    const first = createGatedLauncher();
    const crashed = await startRuntime(storePath, first.launcher, ['fanout-crashed']);
    void crashed.run(request(['angle A', 'angle B']));
    await vi.waitFor(() => {
      expect(first.launches).toHaveLength(2);
    });
    // Simulate the process ending while both children are still running.
    crashed.stopClaiming();

    const second = createGatedLauncher();
    const restarted = new SubagentFanoutRuntime({
      storePath,
      childAgentLauncher: second.launcher,
      logger: NOOP_LOGGER,
    });
    await restarted.restore();

    expect(second.launcher.launchRegistered).not.toHaveBeenCalled();
    const store = new MachineStateStore(storePath, subagentFanoutStateStoreCodec);
    await expect(store.findByInstanceId('fanout-crashed')).resolves.toMatchObject({
      snapshot: {
        state: 'settled',
        context: {
          children: [
            { index: 0, outcome: 'interrupted' },
            { index: 1, outcome: 'interrupted' },
          ],
        },
      },
    });
  });

  it('is unavailable until its machine has been restored and started', async () => {
    const gated = createGatedLauncher();
    const runtime = new SubagentFanoutRuntime({
      storePath: await createStorePath(),
      childAgentLauncher: gated.launcher,
      logger: NOOP_LOGGER,
    });

    await expect(runtime.run(request(['angle A']))).rejects.toBeInstanceOf(
      SubagentFanoutUnavailableError,
    );
    expect(gated.launcher.launchRegistered).not.toHaveBeenCalled();
  });

  it('fails restore without rewriting a store it cannot read', async () => {
    const storePath = await createStorePath();
    const unreadable = '{"schemaVersion": 999, "instances": []}';
    await fs.writeFile(storePath, unreadable);
    const runtime = new SubagentFanoutRuntime({
      storePath,
      childAgentLauncher: createGatedLauncher().launcher,
      logger: NOOP_LOGGER,
    });

    await expect(runtime.restore()).rejects.toThrow();
    await expect(fs.readFile(storePath, 'utf8')).resolves.toBe(unreadable);
    await expect(runtime.run(request(['angle A']))).rejects.toBeInstanceOf(
      SubagentFanoutUnavailableError,
    );
  });
});
