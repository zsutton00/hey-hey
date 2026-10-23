import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunChangedFilesReader,
  createTestRunOwnership,
  createTestRunStore,
  createRunTestOAuthClient,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from '../run.test-support';

import { RunnerPicker } from './pick-runner';
import { ChildAgentLauncher } from '../child-agent-launcher';
import { NewSessionRunner } from './new-session-runner';
import { ResumeRunner } from './resume-runner';
import { SubagentRunner } from './subagent-runner';
import { DeterministicE2ERunner } from './deterministic-e2e-runner';
import type { RunnerContext, RunnerPickerDependencies } from './types';
import { Run, type RunArgs, type RunCollaborators } from '../run';
import type { InternalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../../agents/prompt-type-handler';
import type { AgentSessionRunner } from '../../agents/providers/session-runner';
import type { AgenticSession } from '../../session/types';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import { LocalAgentEndpoint } from '../../server/local-base-url';

const makeSession = (): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'ACTIVE',
    serviceId: null,
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    events: [],
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session: makeSession(),
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const makeLogger = (): RunCollaborators['logger'] =>
  ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as RunCollaborators['logger'];

const makeCollaborators = (): RunCollaborators => ({
  runStore: createTestRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(),
  logger: makeLogger(),
});

const makeInput = (): InternalRunPromptRequest => ({
  promptType: 'coding_freeform',
  payload: { promptType: 'coding_freeform', userMessage: 'x' },
  references: { resolved: [], unresolved: [] },
  triggerContext: null,
});

const baseDeps = (overrides?: Partial<RunnerPickerDependencies>): RunnerPickerDependencies => {
  const ownership = createTestRunOwnership();
  const runner = {
    runPrompt: vi.fn(),
    resumeSession: vi.fn(),
    promptOnce: vi.fn(),
    getContextUsage: vi.fn(),
  } as AgentSessionRunner;
  return {
    sessionRunnerFacade: createTestSessionRunnerFacade(runner),
    childAgentLauncher: {} as ChildAgentLauncher,
    logger: makeLogger(),
    runChangedFilesReader: createTestRunChangedFilesReader(),
    submissionToolRegistry: ownership.submissionToolRegistry,
    localAgentEndpoint: new LocalAgentEndpoint(),
    ...overrides,
  };
};

const subagentHandler = (
  overrides?: Partial<PromptTypeHandler<unknown>>,
): PromptTypeHandler<unknown> => ({
  id: 'commit',
  promptType: 'commit',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'none',
  runnerKind: 'subagent',
  providerSessionCountsForContext: false,
  reports: [],
  subagentConfig: {
    mcpAllowedTools: [],
    builtinAllowedTools: [],
    adapterId: 'test-subagent',
  },
  buildPrompt: () => 'unused',
  ...overrides,
});

const providerHandler = (): PromptTypeHandler<unknown> => ({
  id: 'entity_conversation',
  promptType: 'entity_conversation',
  service: 'optional',
  launchEntity: 'required',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'prompt',
});

const makeCtx = (args: {
  run: Run;
  handler: PromptTypeHandler<unknown>;
  resolvedPrompt?: string;
}): RunnerContext => ({
  run: args.run,
  handler: args.handler,
  resolvedPrompt: args.resolvedPrompt ?? 'resolved',
  input: makeInput(),
  cwd: '/tmp/test-cwd',
  effectiveModel: null,
  effectiveReasoningEffort: null,
  priorReports: [],
  providerSessionDecision: args.run.hasProviderSession ? 'resume' : 'first-turn-mint',
});

describe('RunnerPicker', () => {
  it('returns SubagentRunner for runnerKind="subagent"', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const picker = new RunnerPicker(baseDeps());
    const runner = picker.pick(makeCtx({ run, handler: subagentHandler() }));
    expect(runner).toBeInstanceOf(SubagentRunner);
  });

  it('returns ResumeRunner for provider_session when the Run has a session', () => {
    const run = new Run(makeRunArgs({ hasProviderSession: true }), makeCollaborators());
    const picker = new RunnerPicker(baseDeps());
    const runner = picker.pick(makeCtx({ run, handler: providerHandler() }));
    expect(runner).toBeInstanceOf(ResumeRunner);
  });

  it('returns NewSessionRunner for provider_session when the Run has no session', () => {
    const run = new Run(makeRunArgs({ hasProviderSession: false }), makeCollaborators());
    const picker = new RunnerPicker(baseDeps());
    const runner = picker.pick(makeCtx({ run, handler: providerHandler() }));
    expect(runner).toBeInstanceOf(NewSessionRunner);
  });

  it('selects the deterministic runner only when the composition root provides a scenario owner', () => {
    const run = new Run(makeRunArgs({ hasProviderSession: false }), makeCollaborators());
    const picker = new RunnerPicker(
      baseDeps({
        deterministicE2EScenarioRegistry: {} as never,
      }),
    );
    expect(picker.pick(makeCtx({ run, handler: providerHandler() }))).toBeInstanceOf(
      DeterministicE2ERunner,
    );
  });

  it('throws when handler.runnerKind="subagent" but subagentConfig is missing', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const handler = subagentHandler();
    delete handler.subagentConfig;

    const picker = new RunnerPicker(baseDeps());
    expect(() => picker.pick(makeCtx({ run, handler }))).toThrow(/no subagentConfig/);
  });

  it('throws on an unknown runnerKind', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const handler: PromptTypeHandler<unknown> = {
      id: 'bogus',
      promptType: 'bogus' as LocalPromptType,
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'galactic' as unknown as 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      buildPrompt: () => '',
    };

    const picker = new RunnerPicker(baseDeps());
    expect(() => picker.pick(makeCtx({ run, handler }))).toThrow(/unrecognized.*runnerKind/);
  });

  it('logs a decision line with reason for each picked runner', () => {
    const logger = makeLogger();
    const picker = new RunnerPicker(baseDeps({ logger }));
    const infoLog = logger.info as ReturnType<typeof vi.fn>;

    const subagentRun = new Run(makeRunArgs(), makeCollaborators());
    picker.pick(makeCtx({ run: subagentRun, handler: subagentHandler() }));
    expect(infoLog).toHaveBeenLastCalledWith(
      'runtime.pick_runner.decision',
      expect.objectContaining({
        runId: 'run-1',
        promptType: 'commit',
        runnerKind: 'subagent',
        reason: 'subagent-config',
      }),
    );

    const resumeRun = new Run(makeRunArgs({ hasProviderSession: true }), makeCollaborators());
    picker.pick(makeCtx({ run: resumeRun, handler: providerHandler() }));
    expect(infoLog).toHaveBeenLastCalledWith(
      'runtime.pick_runner.decision',
      expect.objectContaining({
        runnerKind: 'provider_session',
        reason: 'provider-session-resume',
      }),
    );

    const newRun = new Run(makeRunArgs({ hasProviderSession: false }), makeCollaborators());
    picker.pick(makeCtx({ run: newRun, handler: providerHandler() }));
    expect(infoLog).toHaveBeenLastCalledWith(
      'runtime.pick_runner.decision',
      expect.objectContaining({
        runnerKind: 'provider_session',
        reason: 'provider-session-new',
      }),
    );
  });

  it('logs the agent-transition reason when Run rotated provider-session ownership', () => {
    const logger = makeLogger();
    const picker = new RunnerPicker(baseDeps({ logger }));
    const run = new Run(makeRunArgs({ hasProviderSession: false }), makeCollaborators());
    const ctx = {
      ...makeCtx({ run, handler: providerHandler() }),
      providerSessionMintReason: 'agent-transition' as const,
    };
    const runner = picker.pick(ctx);
    expect(runner).toBeInstanceOf(NewSessionRunner);
    expect(logger.info as ReturnType<typeof vi.fn>).toHaveBeenLastCalledWith(
      'runtime.pick_runner.decision',
      expect.objectContaining({
        runnerKind: 'provider_session',
        reason: 'provider-session-agent-transition',
      }),
    );
  });
});
