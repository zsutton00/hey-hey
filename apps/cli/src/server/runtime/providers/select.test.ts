/** @vitest-environment node */

import type { NativePermissionModeResolution } from '../../../agents/providers/native-permission-mode';
import {
  installCapabilityCatalog,
  resetCapabilityCatalogForTests,
} from '../../../shared/runtime/components/AgentSession/capabilityCatalog';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentRunResult,
  ResumeArgs,
  RunPromptArgs,
} from '../../../agents/providers/session-runner';

const opencodeState = vi.hoisted(() => ({
  lastRunPromptArgs: null as RunPromptArgs | null,
  runPromptCalls: 0,
  lastResumeArgs: null as ResumeArgs | null,
  resumeCalls: 0,
  createdRunners: [] as object[],
  createdRunnerDependencies: [] as Array<{
    toolRuleStore: object;
    runStore: object;
    repoStore: object;
    agentOutputOwner: object;
  }>,
}));

const claudeState = vi.hoisted(() => ({
  lastRunPromptArgs: undefined as
    | { model?: string | null; skipPermissions?: boolean; providerPermissionMode?: string }
    | undefined,
  lastResumeArgs: undefined as ResumeArgs | undefined,
  createdRunnerDependencies: [] as Array<{
    toolRuleStore: object;
    runStore: object;
    repoStore: object;
    agentOutputOwner?: object;
  }>,
}));

const codexState = vi.hoisted(() => ({
  createdRunnerDependencies: [] as Array<{
    runStore: object;
    repoStore: object;
    agentOutputOwner?: object;
  }>,
}));

vi.mock('../../../agents/providers/opencode/session-runner-opencode', () => ({
  OpenCodeAgentSessionRunner: class {
    public constructor(dependencies: (typeof opencodeState.createdRunnerDependencies)[number]) {
      opencodeState.createdRunners.push(this);
      opencodeState.createdRunnerDependencies.push(dependencies);
    }
    public async runPrompt(args: RunPromptArgs): Promise<AgentRunResult> {
      opencodeState.runPromptCalls += 1;
      opencodeState.lastRunPromptArgs = args;
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    }
    public async resumeSession(args: ResumeArgs): Promise<AgentRunResult> {
      opencodeState.resumeCalls += 1;
      opencodeState.lastResumeArgs = args;
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    }
  },
}));
vi.mock('../../../agents/providers/claude/session-runner-claude', () => ({
  ClaudeAgentSessionRunner: class {
    public constructor(dependencies: (typeof claudeState.createdRunnerDependencies)[number]) {
      claudeState.createdRunnerDependencies.push(dependencies);
    }

    public async resumeSession(args: ResumeArgs): Promise<AgentRunResult> {
      claudeState.lastResumeArgs = args;
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    }

    public async runPrompt(args: { model?: string | null }): Promise<AgentRunResult> {
      claudeState.lastRunPromptArgs = args;
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    }

    public getContextUsageByResume() {
      return Promise.resolve({
        categories: [],
        totalTokens: 0,
        maxTokens: 0,
        rawMaxTokens: 0,
        percentage: 0,
        gridRows: [],
        model: 'claude-test',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
        isAutoCompactEnabled: false,
        apiUsage: null,
      });
    }
  },
}));
vi.mock('../../../agents/providers/codex/session-runner-codex', () => ({
  CodexAgentSessionRunner: class {
    public constructor(dependencies: (typeof codexState.createdRunnerDependencies)[number]) {
      codexState.createdRunnerDependencies.push(dependencies);
    }

    public async runPrompt(): Promise<AgentRunResult> {
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    }
  },
}));

import { SessionRunnerFacade } from './select';
import { NOOP_LOGGER } from '../../logger';
import { createTestAgentSessionReader } from '../../monitors/test-owners.test-support';
import { RepoMappingStore } from '../../../repo/index';
import { Run, type RunArgs } from '../../../run/run';
import { createTestRepoMappingStore, createTestRun } from '../../../run/run.test-support';
import { RunStore } from '../../../run-store/run-store';
import { OAuthClient } from '../../../auth';
import type { AgenticSession } from '../../../session/index';
import type { AgentSessionMonitorState } from '../../monitors/agent-session-reader';
import { SubmissionToolRegistry } from '../../../agents/submission-tools/registry';
import { LocalAgentEndpoint } from '../../local-base-url';
import { ToolRuleStore } from '../../../session/tool-rules';
import { SETTLED_CATALOG_AVAILABILITY } from '../../../test-support/capability-catalog';

const stubSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'agent-session-1',
    provider: 'opencode',
    services: [],
    provider_session_id: 'ps-1',
    provider_conversation_id: null,
    status: 'idle',
    conversationId: 'conv-1',
    createdAt: '2026-06-25T00:00:00.000Z',
    updatedAt: '2026-06-25T00:00:00.000Z',
    events: [],
    contextMetadata: { projectId: 'project-1' },
    ...overrides,
  }) as unknown as AgenticSession;

const buildRun = (overrides: { runId?: string; provider?: RunArgs['provider'] } = {}): Run => {
  const provider = overrides.provider ?? 'opencode';
  const run = createTestRun({
    runId: overrides.runId ?? 'agent-session-1',
    provider,
    session: stubSession({ provider }),
  });
  vi.spyOn(run, 'setRunner');
  return run;
};

const buildFacade = (
  readAgentSession?: (id: string) => Promise<AgentSessionMonitorState | null>,
  preciseFileChangeTracking = false,
  nativeMode: NativePermissionModeResolution = { mode: 'auto', installedVersion: '9.9.9' },
) =>
  new SessionRunnerFacade({
    nativePermissionModeProbe: {
      resolve: async (providerId) =>
        providerId === 'opencode'
          ? ({ mode: null, reason: 'provider_has_no_native_mode' } as const)
          : nativeMode,
    },
    machineOptionsStore: {
      isPreciseFileChangeTrackingEnabled: async () => preciseFileChangeTracking,
    },
    capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
    runStore: new RunStore(),
    repoStore: createTestRepoMappingStore(),
    oauthClient: new OAuthClient(),
    localAgentEndpoint: new LocalAgentEndpoint(),
    submissionToolRegistry: new SubmissionToolRegistry(),
    logger: NOOP_LOGGER,
    agentSessionReader: createTestAgentSessionReader(readAgentSession ?? (async () => null)),
    toolRuleStore: new ToolRuleStore(),
  });

const buildRunArgs = (overrides: Partial<RunPromptArgs> = {}): RunPromptArgs => ({
  session: stubSession(),
  prompt: 'hi',
  ...overrides,
});

const dto = (autoDecide: boolean): AgentSessionMonitorState => ({ autoDecide });

const buildResumeArgs = (overrides: Partial<ResumeArgs> = {}): ResumeArgs => ({
  session: stubSession(),
  ...overrides,
});

const resetState = (): void => {
  opencodeState.runPromptCalls = 0;
  opencodeState.lastRunPromptArgs = null;
  opencodeState.resumeCalls = 0;
  opencodeState.lastResumeArgs = null;
  opencodeState.createdRunners = [];
  opencodeState.createdRunnerDependencies = [];
  claudeState.createdRunnerDependencies = [];
  claudeState.lastRunPromptArgs = undefined;
  claudeState.lastResumeArgs = undefined;
  codexState.createdRunnerDependencies = [];
};

it('rejects Antigravity before selecting any existing runner', async () => {
  resetState();
  const facade = buildFacade();
  const run = buildRun({ provider: 'antigravity' });

  expect(() => facade.forRun(run)).toThrow('Antigravity runner not available');
  await expect(facade.runPrompt(run, buildRunArgs())).rejects.toThrow(
    'Antigravity runner not available',
  );
  expect(run.setRunner).not.toHaveBeenCalled();
});

describe('SessionRunnerFacade — ToolRuleStore ownership', () => {
  it('sends no capture hooks while precise file change tracking is off', async () => {
    resetState();
    const facade = buildFacade();
    for (const provider of ['codex', 'claude'] as const) {
      const run = buildRun({ runId: `${provider}-run`, provider });
      await facade.runPrompt(run, buildRunArgs());
    }

    expect(codexState.createdRunnerDependencies[0]).not.toHaveProperty('executionRecorder');
    expect(claudeState.createdRunnerDependencies[0]).not.toHaveProperty('executionRecorder');
  });

  it('rebuilds the runner the picker cached before the first prompt, so the option takes effect', async () => {
    resetState();
    const facade = buildFacade(undefined, true);
    const run = buildRun({ runId: 'picked-run', provider: 'codex' });

    // RunnerPicker.pick calls forRun before the runner prompts.
    facade.forRun(run);
    expect(codexState.createdRunnerDependencies[0]).not.toHaveProperty('executionRecorder');
    await facade.runPrompt(run, buildRunArgs());

    const latest = codexState.createdRunnerDependencies.at(-1);
    expect(latest).toHaveProperty('executionRecorder');
    expect(vi.mocked(run.setRunner).mock.calls.length).toBe(2);
    // Later prompts reuse the recorder-equipped runner.
    await facade.runPrompt(run, buildRunArgs());
    expect(codexState.createdRunnerDependencies).toHaveLength(2);
  });

  it('gives Codex and Claude runners the recorder when the option is on, but never OpenCode', async () => {
    resetState();
    const facade = buildFacade(undefined, true);
    for (const provider of ['codex', 'claude', 'opencode'] as const) {
      const run = buildRun({ runId: `${provider}-run`, provider });
      await facade.runPrompt(run, buildRunArgs());
    }

    expect(codexState.createdRunnerDependencies[0]).toHaveProperty('executionRecorder');
    expect(claudeState.createdRunnerDependencies[0]).toHaveProperty('executionRecorder');
    expect(opencodeState.createdRunnerDependencies[0]).not.toHaveProperty('executionRecorder');
  });

  it('launches the first model the provider reported when none is named', async () => {
    resetState();
    installCapabilityCatalog([
      {
        provider: 'claude',
        models: [
          { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: [] },
          { id: 'claude-haiku-5-5', label: 'Haiku 5.5', efforts: [] },
        ],
      },
    ]);

    await buildFacade().runPrompt(buildRun({ provider: 'claude' }), buildRunArgs());

    expect(claudeState.lastRunPromptArgs).toMatchObject({ model: 'claude-opus-5-5' });
  });

  it('launches with no model when the provider reported none', async () => {
    resetState();
    installCapabilityCatalog([
      { provider: 'claude', models: [], notice: 'Claude could not report its models: down' },
    ]);

    await buildFacade().runPrompt(buildRun({ provider: 'claude' }), buildRunArgs());

    expect(claudeState.lastRunPromptArgs?.model ?? null).toBeNull();
  });
});

describe('SessionRunnerFacade — skipPermissions derivation', () => {
  it('augments args with skipPermissions=true when autoDecide is true and caller omits the flag', async () => {
    resetState();
    const readAgentSession = vi.fn(async () => dto(true));
    const facade = buildFacade(readAgentSession);
    const run = buildRun();

    await facade.runPrompt(run, buildRunArgs());

    expect(readAgentSession).toHaveBeenCalledWith('agent-session-1');
    expect(opencodeState.runPromptCalls).toBe(1);
    expect(opencodeState.lastRunPromptArgs).toMatchObject({ skipPermissions: true });
  });

  it('keeps explicit permissions on a Task Monitor Run when autoDecide is off', async () => {
    resetState();
    const facade = buildFacade(async () => dto(false));
    const run = buildRun();
    vi.spyOn(run, 'taskMonitorId', 'get').mockReturnValue('monitor-1');

    await facade.runPrompt(run, buildRunArgs());
    await facade.resumeSession(run, buildResumeArgs());

    expect(opencodeState.lastRunPromptArgs).toMatchObject({ skipPermissions: false });
    expect(opencodeState.lastResumeArgs).toMatchObject({ skipPermissions: false });
  });

  it('forwards skipPermissions=false when autoDecide is false', async () => {
    resetState();
    const facade = buildFacade(async () => dto(false));

    await facade.runPrompt(buildRun(), buildRunArgs());

    expect(opencodeState.lastRunPromptArgs).toMatchObject({ skipPermissions: false });
  });

  it('honors an explicit caller skipPermissions=false without consulting the reader', async () => {
    resetState();
    const readAgentSession = vi.fn(async () => dto(true));
    const facade = buildFacade(readAgentSession);

    await facade.runPrompt(buildRun(), buildRunArgs({ skipPermissions: false }));

    expect(readAgentSession).not.toHaveBeenCalled();
    expect(opencodeState.lastRunPromptArgs).toMatchObject({ skipPermissions: false });
  });

  it('falls back to undefined when the live read throws (fail-open toward prompting)', async () => {
    resetState();
    const facade = buildFacade(async () => {
      throw new Error('network down');
    });

    await facade.runPrompt(buildRun(), buildRunArgs());

    const forwarded = opencodeState.lastRunPromptArgs;
    if (forwarded === null) {
      throw new Error('Expected OpenCode run prompt args to be captured.');
    }
    expect(forwarded.skipPermissions).toBeUndefined();
  });
});

describe('SessionRunnerFacade — provider permission mode', () => {
  it('runs a Claude Task Monitor launch and resume in auto mode without blanket approval', async () => {
    resetState();
    const facade = buildFacade(async () => dto(true));
    const run = buildRun({ provider: 'claude' });
    vi.spyOn(run, 'taskMonitorId', 'get').mockReturnValue('monitor-1');

    await facade.runPrompt(run, buildRunArgs());
    await facade.resumeSession(run, buildResumeArgs());

    expect(claudeState.lastRunPromptArgs).toMatchObject({
      skipPermissions: false,
      providerPermissionMode: 'auto',
    });
    expect(claudeState.lastResumeArgs).toMatchObject({
      skipPermissions: false,
      providerPermissionMode: 'auto',
    });
    // The monitor-owned authorization is unchanged by the provider mode.
  });

  it('keeps explicit permissions, with no blanket approval, whenever native automation is unavailable or authorization is unknown', async () => {
    const cases: Array<{
      name: string;
      provider: 'claude' | 'opencode';
      read: () => Promise<AgentSessionMonitorState | null>;
      nativeMode?: NativePermissionModeResolution;
    }> = [
      { name: 'provider without a native mode', provider: 'opencode', read: async () => dto(true) },
      {
        name: 'installed version too old',
        provider: 'claude',
        read: async () => dto(true),
        nativeMode: { mode: null, reason: 'installed_version_too_old', installedVersion: '1.0.0' },
      },
      {
        name: 'version unreadable',
        provider: 'claude',
        read: async () => dto(true),
        nativeMode: { mode: null, reason: 'version_unreadable', cause: 'ENOENT' },
      },
      { name: 'autoDecide off', provider: 'claude', read: async () => dto(false) },
      {
        name: 'authorization read throws',
        provider: 'claude',
        read: async () => {
          throw new Error('platform down');
        },
      },
    ];

    for (const testCase of cases) {
      resetState();
      const facade = buildFacade(testCase.read, false, testCase.nativeMode);
      const run = buildRun({ provider: testCase.provider });
      vi.spyOn(run, 'taskMonitorId', 'get').mockReturnValue('monitor-1');

      await facade.runPrompt(run, buildRunArgs());
      await facade.resumeSession(run, buildResumeArgs());

      const state = testCase.provider === 'claude' ? claudeState : opencodeState;
      expect(state.lastRunPromptArgs, testCase.name).toMatchObject({ skipPermissions: false });
      expect(state.lastResumeArgs, testCase.name).toMatchObject({ skipPermissions: false });
      expect(state.lastRunPromptArgs, testCase.name).not.toHaveProperty('providerPermissionMode');
      expect(state.lastResumeArgs, testCase.name).not.toHaveProperty('providerPermissionMode');
    }
  });

  it('leaves a Claude run outside Task Monitor without a provider mode', async () => {
    resetState();

    await buildFacade(async () => dto(false)).runPrompt(
      buildRun({ provider: 'claude' }),
      buildRunArgs(),
    );

    expect(claudeState.lastRunPromptArgs).not.toHaveProperty('providerPermissionMode');
  });
});

describe('SessionRunnerFacade — skipPermissions derivation on resume', () => {
  it('augments resume args with skipPermissions=true when autoDecide is true and caller omits the flag', async () => {
    resetState();
    const readAgentSession = vi.fn(async () => dto(true));
    const facade = buildFacade(readAgentSession);
    const run = buildRun();

    await facade.resumeSession(run, buildResumeArgs());

    expect(readAgentSession).toHaveBeenCalledWith('agent-session-1');
    expect(opencodeState.resumeCalls).toBe(1);
    expect(opencodeState.lastResumeArgs).toMatchObject({ skipPermissions: true });
  });

  it('forwards skipPermissions=false on resume when autoDecide is false', async () => {
    resetState();
    const facade = buildFacade(async () => dto(false));

    await facade.resumeSession(buildRun(), buildResumeArgs());

    expect(opencodeState.lastResumeArgs).toMatchObject({ skipPermissions: false });
  });

  it('honors an explicit caller skipPermissions on resume without consulting the reader', async () => {
    resetState();
    const readAgentSession = vi.fn(async () => dto(true));
    const facade = buildFacade(readAgentSession);

    await facade.resumeSession(buildRun(), buildResumeArgs({ skipPermissions: false }));

    expect(readAgentSession).not.toHaveBeenCalled();
    expect(opencodeState.lastResumeArgs).toMatchObject({ skipPermissions: false });
  });

  it('falls back to undefined on resume when the live read throws', async () => {
    resetState();
    const facade = buildFacade(async () => {
      throw new Error('network down');
    });

    await facade.resumeSession(buildRun(), buildResumeArgs());

    const forwarded = opencodeState.lastResumeArgs;
    if (forwarded === null) {
      throw new Error('Expected OpenCode resume args to be captured.');
    }
    expect(forwarded.skipPermissions).toBeUndefined();
  });
});
