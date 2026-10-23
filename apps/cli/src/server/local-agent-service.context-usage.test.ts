import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSessionRunnerError } from '../agents/providers/session-runner';
import { SessionCostAdapter } from './services/session-cost-adapter';
import { LocalAgentService } from './local-agent-service';
import {
  createTestRepoMappingStore,
  createTestRunStore,
  createTestSessionRunnerFacade,
} from '../run/run.test-support';
import {
  createTestRunRegistryWiring,
  LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
} from './__tests__/helpers/test-run-registry';
import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';
import { Run } from '../run/run';
import type { ProviderSessionHistoryEntry } from '../session/types';
import type { CliReadRunContextUsageResult } from '../shared/agent-bridge-contract/contract';
import { SETTLED_CATALOG_AVAILABILITY } from '../test-support/capability-catalog';

const contextData = {
  model: 'fixture',
  totalTokens: 10,
} as CliReadRunContextUsageResult['contextData'];
const promptTypeRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
const member = (
  providerSessionId: string,
  providerSessionAgentId: string | null,
): ProviderSessionHistoryEntry => ({
  providerSessionId,
  providerConversationId: null,
  providerSessionAgentId,
  observedAt: '2026-10-05T00:00:00.000Z',
});
const fixture = (
  read: () => Promise<string>,
  context: () => Promise<typeof contextData>,
  history: ProviderSessionHistoryEntry[] = [member('selected', null)],
) => {
  const runStore = createTestRunStore();
  const repoStore = createTestRepoMappingStore();
  const wiring = createTestRunRegistryWiring({ runStore, repoStore });
  const sessionRunnerFacade = createTestSessionRunnerFacade();
  const resume = vi
    .spyOn(sessionRunnerFacade, 'readContextUsageByResume')
    .mockResolvedValue(contextData);
  const service = new LocalAgentService({
    capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
    ...LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
    ...wiring,
    runStore,
    repoStore,
    sessionRunnerFacade,
    readCcusageSessionJson: read,
  });
  // A Run reduced to what the read touches, selecting its context session
  // through the real registry-backed Run rule.
  const run = Object.assign(Object.create(Run.prototype) as object, {
    runId: 'run',
    session: {
      provider: 'codex',
      provider_session_id: 'selected',
      provider_session_history: history,
    },
    runner: { getContextUsage: context },
    promptTypeRegistry,
  }) as unknown as Run;
  return { service, run, resume };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('Context usage controlled fixture', () => {
  it('records cold and repeated warm reads with 40ms context and 80ms cost fixtures', async () => {
    vi.useFakeTimers();
    const read = vi.fn(
      () =>
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('{"sessions":[{"sessionId":"selected","costUSD":2}]}'), 80),
        ),
    );
    const context = vi.fn(
      () =>
        new Promise<typeof contextData>((resolve) => setTimeout(() => resolve(contextData), 40)),
    );
    const { service, run } = fixture(read, context);
    const durations: number[] = [];
    for (let i = 0; i < 3; i++) {
      const started = Date.now();
      const result = service.readRunContextUsage(run, 'selected');
      await vi.runAllTimersAsync();
      expect((await result).cost).toMatchObject({ state: 'available', amountUsd: 2 });
      durations.push(Date.now() - started);
    }
    process.stdout.write(
      JSON.stringify({
        contextMs: 40,
        sourceCostMs: 80,
        totalMs: durations,
        contextCalls: context.mock.calls.length,
        costCalls: read.mock.calls.length,
      }) + '\n',
    );
  });
});

describe('selected context and cost reads', () => {
  it('starts both before either resolves and validates membership first', async () => {
    let resolveContext!: (value: typeof contextData) => void;
    let resolveCost!: (value: string) => void;
    const context = vi.fn(
      () =>
        new Promise<typeof contextData>((done) => {
          resolveContext = done;
        }),
    );
    const cost = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolveCost = done;
        }),
    );
    const { service, run } = fixture(cost, context);
    await expect(service.readRunContextUsage(run, 'foreign')).rejects.toThrow('does not belong');
    expect(context).not.toHaveBeenCalled();
    expect(cost).not.toHaveBeenCalled();
    const pending = service.readRunContextUsage(run, 'selected');
    expect(context).toHaveBeenCalledWith('selected');
    expect(cost).toHaveBeenCalledTimes(1);
    resolveCost('{"sessions":[{"sessionId":"selected","costUSD":2}]}');
    resolveContext(contextData);
    expect(await pending).toMatchObject({
      runId: 'run',
      providerSessionId: 'selected',
      contextData,
      cost: { amountUsd: 2 },
    });
  });

  it.each([true, false])('preserves resume reading when runner exists: %s', async (hasRunner) => {
    const { service, run, resume } = fixture(
      async () => '{"sessions":[]}',
      async () => {
        throw new AgentSessionRunnerError('NO_ACTIVE_SESSION', 'inactive');
      },
    );
    if (!hasRunner) Object.assign(run, { runner: undefined });
    const result = await service.readRunContextUsage(run);
    expect(resume).toHaveBeenCalledWith(run.session, 'selected');
    expect(result.contextData).toBe(contextData);
  });

  it('preserves adapter_error and propagates context errors', async () => {
    const { service, run } = fixture(
      async () => '{"sessions":[]}',
      async () => contextData,
    );
    vi.spyOn(SessionCostAdapter.prototype, 'read').mockRejectedValue(new Error('adapter failed'));
    expect((await service.readRunContextUsage(run)).cost).toMatchObject({
      state: 'unavailable',
      reason: 'adapter_error',
    });
    const broken = fixture(
      async () => '{"sessions":[]}',
      async () => {
        throw new Error('context failed');
      },
    );
    await expect(broken.service.readRunContextUsage(broken.run)).rejects.toThrow('context failed');
  });

  it('defaults to the latest counted session and skips one-off subagent sessions', async () => {
    const context = vi.fn(() => Promise.resolve(contextData));
    const { service, run } = fixture(() => Promise.resolve('{"sessions":[]}'), context, [
      member('selected', 'coding_freeform'),
      member('coding-plan', 'startup_session'),
      member('reviewer', 'code_review'),
      member('committer', 'commit'),
    ]);
    const result = await service.readRunContextUsage(run);
    expect(result.providerSessionId).toBe('coding-plan');
    expect(context).toHaveBeenCalledWith('coding-plan');
  });

  it.each([
    ['Review', 'reviewer', 'code_review'],
    ['coding plan', 'coding-plan', 'startup_session'],
  ])(
    'accepts an explicit finished %s session and reads it by resume',
    async (_label, providerSessionId, agentId) => {
      const { service, run, resume } = fixture(
        () => Promise.resolve('{"sessions":[]}'),
        () =>
          Promise.reject(new AgentSessionRunnerError('NO_ACTIVE_SESSION', 'not the live session')),
        [member('selected', 'coding_freeform'), member(providerSessionId, agentId)],
      );
      const result = await service.readRunContextUsage(run, providerSessionId);
      expect(result.providerSessionId).toBe(providerSessionId);
      expect(resume).toHaveBeenCalledWith(run.session, providerSessionId);
      expect(result.contextData).toBe(contextData);
    },
  );
});
