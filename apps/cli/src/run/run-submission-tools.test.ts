import { describe, expect, it, vi } from 'vitest';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestMonitorProjectContext,
  createTestRepoMappingStore,
  createTestRunRegistry,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { PromptTypeHandler } from '../agents/prompt-type-handler';
import type { PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { AgenticSession } from '../session/types';
import { RunStore } from '../run-store/run-store';
import type { RepoMappingStore } from '../repo/index';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';
import type {
  ActionSubmissionToolDeclaration,
  PassThroughSubmissionToolDeclaration,
} from '../agents/submission-tools/types';
import { TriggerFrameRouter, toRunPromptRequest } from '../server/trigger-verification/dispatch';
import { RunReadRestoreCoordinator } from '../server/restore-persisted-runs';
import type { StoredInput } from '../server/input-admission/input-admission-codec';
import { TriggerVerifier, type VerifiedTriggerFrame } from '../server/trigger-verification/verify';
import type { ServerLogger } from '../server/logger';
import type { PlatformWebSocketEvent } from '../server/platform-ws';
import type { LocalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import { MonitorProjectContext } from '../server/monitors/project-context';
import { createTestLocalAgentService } from '../server/local-agent-service.test-support';
import type { LocalAgentService } from '../server/local-agent-service';
import { createTestTaskMonitorStateMachineInputAdapter } from '../server/state-machine-input-adapter.test-support';
import type { HostActionAdmission } from '../server/controller-authorization/host-action-admission';
import { AdmittedHostAction } from '../server/controller-authorization/types';
import { IncludeExistingProposalsInCurrentMessageTool } from '../agents/submission-tools/include-existing-proposals-in-current-message-tool';
import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';

const promptTypeRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

class TestConversationCapability extends AdmittedHostAction {
  public constructor() {
    super('CONVERSATION_TRIGGER', 'test-authorization', 'test-nonce');
  }
}

const TEST_CONVERSATION_CAPABILITY = new TestConversationCapability();

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'sess-1',
    provider: 'claude',
    provider_session_id: 'prov-1',
    provider_conversation_id: null,
    status: 'idle',
    serviceId: 'svc-1',
    conversationId: 'c0000000-0000-4000-8000-000000000001',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    events: [],
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    ...overrides,
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'sess-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'c0000000-0000-4000-8000-000000000001',
  provider: 'claude',
  session: makeSession(),
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const makeCollaborators = (): RunCollaborators => {
  const runStore = createTestRunStore();
  vi.spyOn(runStore, 'updateRunTriggerContext').mockResolvedValue(makeSession());
  return {
    runStore,
    repoStore: createTestRepoMappingStore(),
    poster: makePoster(),
    broadcaster: makeBroadcaster(),
    ...createTestRunOwnership(),
    handlerDeps: {} as unknown as PromptTypeHandlerDeps,
    runnerPicker: createTestRunnerPicker(() => ({ run: async () => {} })),
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as RunCollaborators['logger'],
  };
};

const makeRunHarness = (
  collaboratorOverrides?: Partial<RunCollaborators>,
): { run: Run; submissionToolRegistry: RunCollaborators['submissionToolRegistry'] } => {
  const collaborators = { ...makeCollaborators(), ...collaboratorOverrides };
  return {
    run: new Run(makeRunArgs(), collaborators),
    submissionToolRegistry: collaborators.submissionToolRegistry,
  };
};

const PASS_THROUGH_TOOL: PassThroughSubmissionToolDeclaration = {
  kind: 'pass_through',
  name: 'create_report',
  description: 'pass-through',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: () => ({ content: [{ type: 'text', text: 'ok' }] }),
};

const ACTION_TOOL: ActionSubmissionToolDeclaration = {
  name: 'submit_no_discrepancy',
  description: 'action',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: () => ({ action: 'NO_DISCREPANCY' }),
};

const INCLUDE_EXISTING_PROPOSALS_TOOL = new IncludeExistingProposalsInCurrentMessageTool();

interface PrivateRunFns {
  registerSubmissionTools(
    handler: PromptTypeHandler<unknown>,
    turnId: string,
    awaitingUserReview: boolean,
  ): void;
}

const callRegister = (
  run: Run,
  handler: PromptTypeHandler<unknown>,
  turnId: string = 'turn-1',
  awaitingUserReview: boolean = false,
): void => {
  (run as unknown as PrivateRunFns).registerSubmissionTools(handler, turnId, awaitingUserReview);
};

describe('Run.registerSubmissionTools', () => {
  it('registers a pass-through-only handler even when EXTERNAL_AGENT context is missing', () => {
    const { run, submissionToolRegistry } = makeRunHarness();
    expect(run.getTriggerContext()).toBeNull();

    const handler: PromptTypeHandler<unknown> = {
      id: 'startup_session',
      promptType: 'startup_session',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'gated',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [PASS_THROUGH_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler);

    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg).not.toBeNull();
    expect(reg?.tools).toHaveLength(1);
    expect(reg?.tools[0]?.name).toBe('create_report');
    expect(reg?.externalAgentNodeId).toBeNull();
    expect(reg?.triggerMessageId).toBeNull();
  });

  it('leaves out base tools the handler excludes, and stops treating them as callable', () => {
    const { run, submissionToolRegistry } = makeRunHarness();
    const handler: PromptTypeHandler<unknown> = {
      id: 'startup_session',
      promptType: 'startup_session',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'gated',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      excludedBaseSubmissionTools: ['create_report'],
      submissionTools: [ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler);

    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg?.tools.map((t) => t.name)).toEqual(['submit_no_discrepancy']);
    expect(reg?.activeToolNames).toEqual(['submit_no_discrepancy']);
  });

  it('registers ALL declared tools — including action tools — even when EXTERNAL_AGENT context is missing; the action-post path enforces the contract at call time', () => {
    const { run, submissionToolRegistry } = makeRunHarness();

    const handler: PromptTypeHandler<unknown> = {
      id: 'feature_sync_analyze',
      promptType: 'feature_sync_analyze',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [PASS_THROUGH_TOOL, ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler);

    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg?.tools.map((t) => t.name).sort()).toEqual([
      'create_report',
      'submit_no_discrepancy',
    ]);
    expect(reg?.externalAgentNodeId).toBeNull();
    expect(reg?.triggerMessageId).toBeNull();
  });

  it('registers an action-only handler with null context — the agent gets the tool and any submit will fail loudly at action-post time rather than the turn silently having no completion path', () => {
    const { run, submissionToolRegistry } = makeRunHarness();

    const handler: PromptTypeHandler<unknown> = {
      id: 'feature_sync_analyze',
      promptType: 'feature_sync_analyze',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler);

    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg?.tools.map((t) => t.name)).toEqual(['submit_no_discrepancy']);
    expect(reg?.externalAgentNodeId).toBeNull();
    expect(reg?.triggerMessageId).toBeNull();
  });

  it('gate-parked: filters action tools out and keeps only pass-through tools', () => {
    const { run, submissionToolRegistry } = makeRunHarness();
    run.setTriggerContext({ externalAgentNodeId: 'node-1', triggerMessageId: 'trigger-1' });

    const handler: PromptTypeHandler<unknown> = {
      id: 'feature_sync_analyze',
      promptType: 'feature_sync_analyze',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [PASS_THROUGH_TOOL, ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler, 'turn-1', /* awaitingUserReview */ true);

    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg?.tools.map((t) => t.name)).toEqual(['create_report']);
    expect(reg?.tools.every((t) => t.kind === 'pass_through')).toBe(true);
  });

  it('gate-parked: action-only handler with no prior registration leaves the registry empty', () => {
    const { run, submissionToolRegistry } = makeRunHarness();

    const handler: PromptTypeHandler<unknown> = {
      id: 'feature_sync_analyze',
      promptType: 'feature_sync_analyze',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler, 'turn-1', /* awaitingUserReview */ true);

    expect(submissionToolRegistry.getByRunId('sess-1')).toBeNull();
  });

  it('gate-parked: clears action tools from a prior registration when the new handler declares none', () => {
    const { run, submissionToolRegistry } = makeRunHarness();

    // Prior turn ran feature_sync_analyze and registered an action tool.
    const priorHandler: PromptTypeHandler<unknown> = {
      id: 'feature_sync_analyze',
      promptType: 'feature_sync_analyze',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [PASS_THROUGH_TOOL, ACTION_TOOL],
      buildPrompt: () => '',
    };
    callRegister(run, priorHandler, 'turn-1');
    expect(submissionToolRegistry.getByRunId('sess-1')?.tools).toHaveLength(2);

    // Workflow is now gate-parked; the routed handler (coding_freeform-like)
    // declares no submission tools. The prior action tool must be stripped
    // so the registry cannot advertise it on this turn.
    const awaitingReviewHandler: PromptTypeHandler<unknown> = {
      id: 'coding_freeform',
      promptType: 'coding_freeform',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'gated_and_clarifiable',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => '',
    };
    callRegister(run, awaitingReviewHandler, 'turn-2', /* awaitingUserReview */ true);

    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg?.tools).toEqual([]);
  });

  it('resolver-cleared turn (terminal verdict) registers with null completion context', () => {
    const { run, submissionToolRegistry } = makeRunHarness();
    // Simulate a prior agent-pending turn that stamped the pair.
    run.setTriggerContext({ externalAgentNodeId: 'node-1', triggerMessageId: 'trigger-1' });
    // Simulate the resolver clearing the pair on a terminal verdict.
    run.setTriggerContext(null);

    const handler: PromptTypeHandler<unknown> = {
      id: 'coding_freeform',
      promptType: 'coding_freeform',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'gated_and_clarifiable',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [PASS_THROUGH_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler);

    expect(run.getTriggerContext()).toBeNull();
    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg).not.toBeNull();
    expect(reg?.externalAgentNodeId).toBeNull();
    expect(reg?.triggerMessageId).toBeNull();
  });

  it('subsequent agent-pending verdict restores the pair atomically after a resolver clear', () => {
    const { run, submissionToolRegistry } = makeRunHarness();
    // Simulate a prior terminal verdict that cleared the pair.
    run.setTriggerContext(null);
    // Simulate a new agent-pending verdict arriving with a fresh pair.
    run.setTriggerContext({ externalAgentNodeId: 'node-2', triggerMessageId: 'trigger-2' });

    const handler: PromptTypeHandler<unknown> = {
      id: 'feature_sync_analyze',
      promptType: 'feature_sync_analyze',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [PASS_THROUGH_TOOL, ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler);

    expect(run.getTriggerContext()).toEqual({
      externalAgentNodeId: 'node-2',
      triggerMessageId: 'trigger-2',
    });
    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg?.externalAgentNodeId).toBe('node-2');
    expect(reg?.triggerMessageId).toBe('trigger-2');
  });

  it('keeps both tool kinds when EXTERNAL_AGENT context is present', () => {
    const { run, submissionToolRegistry } = makeRunHarness();
    run.setTriggerContext({ externalAgentNodeId: 'node-1', triggerMessageId: 'trigger-1' });

    const handler: PromptTypeHandler<unknown> = {
      id: 'feature_sync_analyze',
      promptType: 'feature_sync_analyze',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [PASS_THROUGH_TOOL, ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler);

    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg?.tools.map((t) => t.name).sort()).toEqual([
      'create_report',
      'submit_no_discrepancy',
    ]);
    expect(reg?.activeToolNames ? [...reg.activeToolNames].sort() : null).toEqual([
      'create_report',
      'submit_no_discrepancy',
    ]);
    expect(reg?.externalAgentNodeId).toBe('node-1');
    expect(reg?.triggerMessageId).toBe('trigger-1');
  });

  it('registers the base create_report wrapper for a non-startup report-producing handler before handler tools', () => {
    const BASE_TOOL: PassThroughSubmissionToolDeclaration = {
      kind: 'pass_through',
      name: 'create_report',
      description: 'universal create_report wrapper',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };

    const { run, submissionToolRegistry } = makeRunHarness({
      baseSubmissionTools: [BASE_TOOL],
    });

    const handler: PromptTypeHandler<unknown> = {
      id: 'feature_sync_analyze',
      promptType: 'feature_sync_analyze',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler);

    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg?.tools.map((t) => t.name).sort()).toEqual([
      'create_report',
      'submit_no_discrepancy',
    ]);
    // Base tool appears first.
    expect(reg?.tools[0]?.name).toBe('create_report');
  });

  it('mounts Proposal inclusion only for the visual-preview handler', () => {
    const { run, submissionToolRegistry } = makeRunHarness({
      baseSubmissionTools: [PASS_THROUGH_TOOL],
    });

    const nonVisualHandler: PromptTypeHandler<unknown> = {
      id: 'plan_shaping_finalize',
      promptType: 'plan_shaping_finalize',
      service: 'optional',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, nonVisualHandler);

    expect(submissionToolRegistry.getByRunId('sess-1')?.tools.map((tool) => tool.name)).toEqual([
      'create_report',
      'submit_no_discrepancy',
    ]);
    expect(
      submissionToolRegistry
        .getByRunId('sess-1')
        ?.tools.some((tool) => tool.name === INCLUDE_EXISTING_PROPOSALS_TOOL.name),
    ).toBe(false);

    const visualHandler: PromptTypeHandler<unknown> = {
      id: 'plan_shaping_visual_preview',
      promptType: 'plan_shaping_visual_preview',
      service: 'optional',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [INCLUDE_EXISTING_PROPOSALS_TOOL, ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, visualHandler, 'turn-2');

    expect(submissionToolRegistry.getByRunId('sess-1')?.tools.map((tool) => tool.name)).toEqual([
      'create_report',
      INCLUDE_EXISTING_PROPOSALS_TOOL.name,
      'submit_no_discrepancy',
    ]);
  });

  it('base pass-through tools survive the awaitingUserReview filter while action handler tools are stripped', () => {
    const BASE_TOOL: PassThroughSubmissionToolDeclaration = {
      kind: 'pass_through',
      name: 'create_report',
      description: 'universal create_report wrapper',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };

    const { run, submissionToolRegistry } = makeRunHarness({
      baseSubmissionTools: [BASE_TOOL],
    });

    const handler: PromptTypeHandler<unknown> = {
      id: 'feature_sync_analyze',
      promptType: 'feature_sync_analyze',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      submissionTools: [ACTION_TOOL],
      buildPrompt: () => '',
    };

    callRegister(run, handler, 'turn-1', /* awaitingUserReview */ true);

    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg?.tools.map((t) => t.name)).toEqual(['create_report']);
    expect(reg?.tools[0]?.kind).toBe('pass_through');
  });
});

describe('verified trigger envelope → Run → submission-tool registry', () => {
  const noopSubmitPermissionDecision = () =>
    vi.fn().mockResolvedValue({ outcome: 'delivered', callbackType: 'claude_control_response' });

  const noopRouterLogger = (): ServerLogger => {
    const logger: ServerLogger = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      child: () => logger,
    };
    return logger;
  };

  const buildVerifiedConversation = (
    triggerMessageId: string,
    nonce: string,
  ): VerifiedTriggerFrame => ({
    kind: 'trigger.conversation',
    frame: {
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
    },
    envelope: {
      protocolVersion: 2,
      authorization: {
        kind: 'bounded_grant',
        grantId: '90000000-0000-4000-8000-000000000009',
      },
      machineId: 'm-1',
      userId: 'u-1',
      nonce,
      timestampMs: 0,
      signature: 'sig',
      event: {
        promptType: 'feature_sync_analyze',
        nodeId: 'node-1',
        triggerMessageId,
      } as unknown as never,
    } as never,
    body: {
      promptType: 'feature_sync_analyze',
      nodeId: 'node-1',
      triggerMessageId,
    } as never,
  });

  const conversationFrameEvent: PlatformWebSocketEvent = {
    type: 'trigger.conversation',
    timestamp: '2026-01-01T00:00:00Z',
    organizationId: 'org-1',
    conversationId: 'c0000000-0000-4000-8000-000000000001',
    envelope: {} as Record<string, unknown>,
  };

  /**
   * Wire the trigger-frame router's `sendMessage` callback into the slice of
   * Run that resolveTurnInputs touches when a request carries trigger context:
   * stamp the trigger ids onto the Run and register the handler's submission
   * tools. This is the same ordering Run.resolveTurnInputs performs (set ids
   * before registering tools) — the test bypasses the heavyweight turn-begin
   * machinery (poster, runner, prompt resolution) and asserts the load-bearing
   * threading.
   */
  const buildPipeline = (
    run: Run,
    verifiedFrames: VerifiedTriggerFrame[],
    handler: PromptTypeHandler<unknown>,
  ): { router: TriggerFrameRouter; calls: LocalRunPromptRequest[] } => {
    const calls: LocalRunPromptRequest[] = [];
    let index = 0;
    const verifier = new TriggerVerifier({
      serverSigningPublicKey: Buffer.alloc(32, 1),
      expectedMachineId: 'm-1',
      expectedUserId: 'user-1',
      logger: noopRouterLogger(),
    });
    vi.spyOn(verifier, 'verifyTriggerFrame').mockImplementation(() => {
      const verified = verifiedFrames[index++];
      if (!verified) throw new Error('no more verified frames staged');
      return { ok: true, verified };
    });
    vi.spyOn(verifier, 'reload').mockImplementation(() => undefined);
    const sendMessage = vi.fn(
      async (
        _capability: Parameters<LocalAgentService['sendMessage']>[0],
        _runId: string,
        request: LocalRunPromptRequest,
      ) => {
        calls.push(request);
        if (request.triggerContext != null) {
          run.setTriggerContext(request.triggerContext);
        }
        (run as unknown as PrivateRunFns).registerSubmissionTools(
          handler,
          `turn-${calls.length.toString()}`,
          request.awaitingUserReview === true,
        );
        return {} as never;
      },
    );
    const runStore = new RunStore();
    vi.spyOn(runStore, 'lookupByConversationId').mockReturnValue('sess-1');
    vi.spyOn(runStore, 'getRunMetadata').mockResolvedValue({
      contextMetadata: { agentSessionId: 'sess-1' },
    } as never);
    vi.spyOn(runStore, 'getRun').mockImplementation((runId) => runStore.getRunMetadata(runId));
    const runRegistry = createTestRunRegistry();
    vi.spyOn(runRegistry, 'submitPermissionDecision').mockImplementation(
      noopSubmitPermissionDecision(),
    );
    const projectContext = createTestMonitorProjectContext();
    projectContext.learn('proj-1');
    const agentService = createTestLocalAgentService({ runStore });
    const pending: Array<{ runId: string; stored: StoredInput }> = [];
    // Delivers from the stored frame exactly as the real lifecycle does.
    const advance = async () => {
      for (const { runId, stored } of pending.splice(0))
        if (stored.kind === 'trigger_frame' && stored.payload.event.promptType !== 'start_run')
          await sendMessage(
            TEST_CONVERSATION_CAPABILITY,
            runId,
            toRunPromptRequest(stored.payload.event),
          );
    };
    Object.defineProperty(agentService, 'inputAdmission', {
      value: {
        owner: { list: async () => [] },
        admitInput: async (identity: { runId: string }, stored: StoredInput) => {
          pending.push({ runId: identity.runId, stored });
          void advance();
          return { record: { admissionDisposition: 'immediate' }, replayed: false };
        },
        advance,
      },
    });

    vi.spyOn(agentService, 'sendMessage').mockImplementation(sendMessage);
    vi.spyOn(agentService, 'createRun').mockImplementation(vi.fn());
    vi.spyOn(agentService, 'stopRun').mockResolvedValue(undefined);
    vi.spyOn(agentService, 'compactRun').mockResolvedValue(undefined);
    const router = new TriggerFrameRouter({
      verifier,
      machinesApi: {
        listMachines: vi.fn().mockResolvedValue({ data: { data: { machines: [] } } }),
      } as never,
      keyPairStore: createTestKeyPairStore(),
      runStore,
      agentService,
      promptTypeRegistry,
      runRegistry,
      runRestoreCoordinator: new RunReadRestoreCoordinator({
        runStore,
        runRegistry,
        logger: noopRouterLogger(),
      }),
      permissionDecisionAuditFilePath:
        '/tmp/hey-hey-run-submission-tools-permission-decisions.audit.jsonl',
      taskMonitorStateMachineInputAdapter:
        createTestTaskMonitorStateMachineInputAdapter(noopRouterLogger()),
      hostActionAdmission: {
        admit: vi.fn().mockResolvedValue({
          admitted: true,
          authorizationId: 'test-authorization',
          capability: TEST_CONVERSATION_CAPABILITY,
        }),
      } as unknown as HostActionAdmission,
      dropSurfacing: {
        poster: createTestMessagePoster({
          createOutOfBand: vi.fn().mockResolvedValue('drop-message'),
        }),
        projectContext,
        initialMachineId: 'm-1',
      },
      logger: noopRouterLogger(),
    });
    return { router, calls };
  };

  const handler: PromptTypeHandler<unknown> = {
    id: 'feature_sync_analyze',
    promptType: 'feature_sync_analyze',
    service: 'required',
    launchEntity: 'required',
    implementationReadiness: 'none',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],
    submissionTools: [PASS_THROUGH_TOOL, ACTION_TOOL],
    buildPrompt: () => '',
  };

  it('stamps the envelope triggerMessageId onto the Run and propagates it into the submission-tool registry on first entry', async () => {
    const { run, submissionToolRegistry } = makeRunHarness();
    const { router } = buildPipeline(
      run,
      [buildVerifiedConversation('trigger-msg-first', 'n-1')],
      handler,
    );

    await router.handlePlatformEvent(conversationFrameEvent);

    expect(run.getTriggerContext()).toEqual({
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-msg-first',
    });

    const reg = submissionToolRegistry.getByRunId('sess-1');
    expect(reg?.triggerMessageId).toBe('trigger-msg-first');
    expect(reg?.externalAgentNodeId).toBe('node-1');
  });

  it('rotates the Run.triggerMessageId and registry entry on re-entry — mirrors an acceptsUserMessages node firing twice', async () => {
    const { run, submissionToolRegistry } = makeRunHarness();
    const { router } = buildPipeline(
      run,
      [
        buildVerifiedConversation('trigger-msg-first', 'n-1'),
        buildVerifiedConversation('trigger-msg-second', 'n-2'),
      ],
      handler,
    );

    await router.handlePlatformEvent(conversationFrameEvent);
    expect(run.getTriggerContext()?.triggerMessageId).toBe('trigger-msg-first');
    expect(submissionToolRegistry.getByRunId('sess-1')?.triggerMessageId).toBe('trigger-msg-first');

    await router.handlePlatformEvent(conversationFrameEvent);
    expect(run.getTriggerContext()?.triggerMessageId).toBe('trigger-msg-second');
    expect(submissionToolRegistry.getByRunId('sess-1')?.triggerMessageId).toBe(
      'trigger-msg-second',
    );
  });
});
