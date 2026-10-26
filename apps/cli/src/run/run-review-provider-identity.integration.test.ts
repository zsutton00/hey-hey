import { CreateReportTool } from '../agents/submission-tools/create-report-tool';
import { makeCreateReportProxy } from '../agents/submission-tools/create-report-proxy.test-support';
import { reportChangedFilesTool } from '../agents/submission-tools/report-changed-files-tool';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';
import {
  createOnCompleteTestDeps,
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../agents/prompt-type-handler.test-support';
import type { AgentRunResult } from '../agents/providers/session-runner';
import { RunStore } from '../run-store/run-store';
import { LocalAgentEndpoint } from '../server/local-base-url';
import { NOOP_LOGGER } from '../server/logger';
import {
  toRunPromptRequest,
  validateConversationTrigger,
} from '../server/trigger-verification/dispatch';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import { ChildAgentLauncher } from './child-agent-launcher';
import { MessagePoster } from './message-poster';
import { Run, type RunCollaborators } from './run';
import { RunnerPicker } from './runners/pick-runner';
import {
  createRunTestOAuthClient,
  createTestRepoMappingStore,
  createTestRunChangedFilesReader,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestSessionRunnerFacade,
} from './run.test-support';

/**
 * Review pressed after free-form coding must post its messages under the
 * reviewer's own provider session, while the Run keeps the implementer's. The
 * reviewer's session joins the Run's history under the Review handler.
 *
 * Real path: the platform `user_message` trigger body the Review button sends
 * → `buildConversationRequest` → `Run.handleMessage` → real registry
 * `code_review` handler → `RunnerPicker` → `SubagentRunner` →
 * `ChildAgentLauncher` → `SubAgent` → Run event ingress → dispatcher →
 * `MessagePoster` → platform message HTTP calls.
 *
 * Faked boundaries only: the provider (a scripted Claude SDK client for the
 * reviewer and a scripted session runner for the implementer), the platform
 * message HTTP client, and the platform MCP / session-start reads.
 *
 * These are controlled-provider assertions. They prove which identity the CLI
 * attributes and persists; they do not inspect a native Claude transcript.
 */

const IMPLEMENTER_SESSION = 'implementer-provider-session';
const REVIEWER_SESSION = 'reviewer-provider-session';
const RUN_ID = 'run-review-identity';

const reviewerSdk = vi.hoisted(() => ({
  startSessionConfigs: [] as Array<Record<string, unknown>>,
  codexStartSessionConfigs: [] as Array<Record<string, unknown>>,
  permission: null as
    | null
    | ((tool: string, input: Record<string, unknown>) => Promise<{ behavior: string }>),
  script: null as null | ((emit: (event: Record<string, unknown>) => void) => void | Promise<void>),
}));

vi.mock('../agent-runtime/index', async () => {
  const actual =
    await vi.importActual<typeof import('../agent-runtime/index')>('../agent-runtime/index');
  return {
    ...actual,
    ClaudeCodeSdkClient: class {
      private handler: ((event: Record<string, unknown>) => void) | null = null;
      onEvent(handler: ((event: Record<string, unknown>) => void) | null) {
        this.handler = handler;
      }
      onPermissionRequest(handler: typeof reviewerSdk.permission) {
        reviewerSdk.permission = handler;
      }
      startSession(config: Record<string, unknown>): Promise<void> {
        reviewerSdk.startSessionConfigs.push(config);
        const emit = (event: Record<string, unknown>) => this.handler?.(event);
        return Promise.resolve(reviewerSdk.script?.(emit));
      }
      disconnect = vi.fn().mockResolvedValue(undefined);
    },
    CodexSdkClient: class {
      private handler:
        | ((event: { method: string; params?: Record<string, unknown> }) => void)
        | null = null;
      onEvent(handler: typeof this.handler) {
        this.handler = handler;
      }
      onServerRequest = vi.fn();
      onTokenUsage = vi.fn();
      getSessionId = vi.fn().mockReturnValue(REVIEWER_SESSION);
      getContextUsage = vi.fn().mockResolvedValue(null);
      submitClientResponse = vi.fn();
      startSession(config: Record<string, unknown>): Promise<void> {
        reviewerSdk.codexStartSessionConfigs.push(config);
        this.handler?.({ method: 'thread/started', params: { thread: { id: REVIEWER_SESSION } } });
        this.handler?.({
          method: 'item/completed',
          params: { item: { id: 'item-1', type: 'agentMessage', text: 'Review complete.' } },
        });
        this.handler?.({
          method: 'turn/completed',
          params: { turn: { id: 'turn-1', status: 'completed' } },
        });
        return Promise.resolve();
      }
      disconnect = vi.fn().mockResolvedValue(undefined);
    },
  };
});

vi.mock('../agents/mcp-server-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agents/mcp-server-config')>()),
  buildMcpServerConfig: vi.fn().mockResolvedValue({ mcpServers: {}, allowedTools: [] }),
}));

vi.mock('../agents/prompts/session-start-context', () => ({
  readSessionStartContext: vi.fn().mockResolvedValue({
    workItemTypeDefinitions: [],
    intentFirst: false,
    maturity: 'ESTABLISHED',
  }),
}));

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: vi.fn().mockResolvedValue(undefined),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  reviewerSdk.startSessionConfigs.length = 0;
  reviewerSdk.codexStartSessionConfigs.length = 0;
  reviewerSdk.script = null;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A reviewer that narrates once, then finishes, all under its own SDK session. */
const scriptReviewer = (repairPath?: string): void => {
  reviewerSdk.script = async (emit) => {
    emit({ type: 'system', subtype: 'init', session_id: REVIEWER_SESSION });
    if (repairPath) {
      const decision = await reviewerSdk.permission!('Write', {
        file_path: repairPath,
        content: 'required repair',
      });
      expect(decision.behavior).toBe('deny');
    }
    emit({
      type: 'assistant',
      session_id: REVIEWER_SESSION,
      message: { content: [{ type: 'text', text: 'Reading the changed files.' }] },
    });
    emit({
      type: 'assistant',
      session_id: REVIEWER_SESSION,
      message: {
        content: [
          {
            type: 'text',
            text: repairPath
              ? 'Assessment: requirements not fulfilled. Findings: High — persistence is lost on restart; add durable storage. Verification: confirmed by inspection; no repairs applied.'
              : 'Review complete: no issues found.',
          },
        ],
      },
    });
    emit({ type: 'result', subtype: 'success', session_id: REVIEWER_SESSION });
  };
};

interface PersistedWrite {
  kind: 'create' | 'update';
  data: Record<string, unknown>;
}

interface RunSettings {
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
}

const makeHarness = async (
  reportTool?: CreateReportTool,
  runSettings?: RunSettings,
  projectMode = false,
) => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-review-identity-'));
  tempDirs.push(baseDir);
  vi.spyOn(os, 'homedir').mockReturnValue(baseDir);
  const runsDir = path.join(baseDir, 'runs');
  const runStore = new RunStore({
    paths: {
      baseDir,
      runsDir,
      indexPath: path.join(runsDir, 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
  await runStore.initialize();
  const repoDir = path.join(baseDir, 'repo');
  await mkdir(repoDir);
  execFileSync('git', ['init', '--quiet'], { cwd: repoDir });
  // An existing free-form coding Run that already owns the implementer's
  // provider session.
  await runStore.createRun({
    entity: null,
    agentic_session_id: RUN_ID,
    services: [{ id: 'service-1', path: repoDir }],
    launchServiceId: 'service-1',
    provider: 'claude',
    provider_session_id: IMPLEMENTER_SESSION,
    provider_conversation_id: null,
    provider_session_agent_id: projectMode ? 'project_mode' : 'coding_freeform',
    ...(projectMode
      ? {
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            model: 'claude-opus',
            projectModeSelection: {
              schemaVersion: 'project-mode-selection.v1',
              modeId: '11111111-1111-4111-8111-111111111111',
            },
            projectModeSnapshot: {
              schemaVersion: 'project-mode-snapshot.v3',
              modeId: '11111111-1111-4111-8111-111111111111',
              catalogDescription: 'Captured mode',
              applicableWorkItemTypeKeys: ['STANDARD'],
              files: {
                schemaVersion: 'project-mode-files.v1',
                files: { 'MODE.md': 'Retain this mode.' },
              },
              snapshotHash: 'a'.repeat(64),
              projectAssistant: { enabled: false },
              sessionRole: 'implementation',
            },
          },
        }
      : {}),
    ...(runSettings
      ? { model: runSettings.model, reasoningEffort: runSettings.reasoningEffort }
      : {}),
    conversationId: 'conversation-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: RUN_ID,
    },
  } as never);
  await runStore.updateRunPromptType(RUN_ID, LocalPromptType.CodingFreeform);
  const session = await runStore.getRun(RUN_ID);
  if (!session) throw new Error('Expected the persisted Run.');

  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'];

  // Platform message HTTP boundary: every persisted create/update body.
  const writes: PersistedWrite[] = [];
  let nextMessageId = 0;
  const poster = new MessagePoster({
    apiClient: {
      postMessage: ({ createMessageDto }) => {
        writes.push({
          kind: 'create',
          data: (createMessageDto as { data?: Record<string, unknown> }).data ?? {},
        });
        nextMessageId += 1;
        return Promise.resolve({ data: { data: { id: `message-${String(nextMessageId)}` } } });
      },
      updateMessage: ({ updateMessageDto }) => {
        writes.push({
          kind: 'update',
          data: (updateMessageDto as { data?: Record<string, unknown> }).data ?? {},
        });
        return Promise.resolve({});
      },
    },
    logger: NOOP_LOGGER,
    dataDir: path.join(baseDir, 'message-poster'),
  });

  const promptTypes = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
  const ownership = createTestRunOwnership((promptType) => promptTypes.get(promptType));

  // The implementer resumes the Run's existing provider session.
  const implementerStarts: Array<'mint' | 'resume'> = [];
  const live: { run: Run | null } = { run: null };
  const implementerTurn = async (start: 'mint' | 'resume'): Promise<AgentRunResult> => {
    implementerStarts.push(start);
    if (!live.run) throw new Error('The Run is not constructed.');
    live.run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'system',
        timestamp: new Date().toISOString(),
        sessionId: IMPLEMENTER_SESSION,
        agentId: 'claude',
        payload: { messageType: 'provider_event' },
      },
    });
    if (live.run.activeTurn?.handler.requiresChangedFileReporting) {
      await reportChangedFilesTool.execute({
        runId: live.run.runId,
        run: live.run,
        args: {
          turnId: live.run.activeTurn.turnId,
          providerSessionId: live.run.providerSessionId,
          changedFiles: [],
        },
      });
    }
    live.run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'agent_output',
        timestamp: new Date().toISOString(),
        sessionId: IMPLEMENTER_SESSION,
        agentId: 'claude',
        payload: {
          messageType: 'assistant',
          taskComplete: true,
          summary: JSON.stringify({
            response: 'Implemented the change.',
            changedFiles: [],
          }),
        },
      },
    });
    return Promise.resolve({
      providerSessionId: IMPLEMENTER_SESSION,
      providerConversationId: null,
      errorCount: 0,
    });
  };
  const sessionRunnerFacade = createTestSessionRunnerFacade({
    runPrompt: vi.fn(() => implementerTurn('mint')),
    resumeSession: vi.fn(() => implementerTurn('resume')),
    discardSession: vi.fn().mockResolvedValue(undefined),
    promptOnce: vi.fn(),
    getContextUsage: vi.fn().mockResolvedValue({ totalTokens: 0, maxTokens: 0 }),
  });

  const platformFetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch;
  const oauthClient = createRunTestOAuthClient({ success: true, data: 'token' });
  const localAgentEndpoint = new LocalAgentEndpoint();
  localAgentEndpoint.set('http://127.0.0.1:9999');
  const runnerPicker = new RunnerPicker({
    sessionRunnerFacade,
    childAgentLauncher: new ChildAgentLauncher({
      promptTypeRegistry: ownership.promptTypeRegistry,
      repoStore: createTestRepoMappingStore(),
      oauthClient,
      submissionToolRegistry: ownership.submissionToolRegistry,
      localAgentEndpoint,
      logger,
    }),
    oauthClient,
    logger,
    runChangedFilesReader: createTestRunChangedFilesReader(),
    submissionToolRegistry: ownership.submissionToolRegistry,
    localAgentEndpoint,
  });

  const emitProviderIdentity = vi.fn();
  const run = new Run(
    {
      runId: RUN_ID,
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      provider: 'claude',
      session,
      hasProviderSession: true,
      skipProjectAssistant: true,
    },
    {
      runStore,
      repoStore: createTestRepoMappingStore(),
      poster,
      broadcaster: createTestRunEventPublisher({ emitProviderIdentity }),
      ...ownership,
      baseSubmissionTools: reportTool ? [reportTool] : [],
      handlerDeps: createPromptTypeHandlerTestDeps({
        auth: createPromptTypeHandlerTestAuth('review-identity-token'),
        apiBaseUrl: 'https://api.example.test/api/v1',
        fetchImpl: platformFetch,
        logger,
      }),
      onCompleteDeps: createOnCompleteTestDeps({
        fetchImpl: platformFetch,
        logger,
        poster,
        runStore,
      }),
      runnerPicker,
      logger,
    },
  );
  live.run = run;

  const code = async (userMessage: string): Promise<void> => {
    await run.handleMessage({
      promptType: LocalPromptType.CodingFreeform,
      payload: { promptType: LocalPromptType.CodingFreeform, userMessage },
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    });
    await run.awaitIdle();
  };

  /** Presses Review exactly as the platform delivers the Action Capsule trigger. */
  const pressReview = async (focus: string): Promise<void> => {
    const request = toRunPromptRequest(
      validateConversationTrigger(
        {
          promptType: 'user_message',
          triggerMessageId: 'trigger-review',
          sourceUserMessageId: 'source-review',
          payload: { handlerPromptType: 'code_review', userMessage: focus, attachments: [] },
        } as never,
        ownership.promptTypeRegistry,
      ),
    );
    expect(request.promptType).toBe(LocalPromptType.CodeReview);
    await run.handleMessage({ ...request, triggerContext: null });
    await run.awaitIdle();
  };

  /** A Commit or Review follow-up exactly as the platform delivers it, with the modal's selection. */
  const sendFollowUp = async (
    handlerPromptType: 'commit' | 'code_review',
    runtime?: Record<string, unknown>,
  ): Promise<void> => {
    const request = toRunPromptRequest(
      validateConversationTrigger(
        {
          promptType: 'user_message',
          triggerMessageId: 'trigger-follow-up',
          sourceUserMessageId: 'source-follow-up',
          payload: {
            handlerPromptType,
            userMessage: '',
            attachments: [],
            ...(runtime ? { runtime } : {}),
          },
        } as never,
        ownership.promptTypeRegistry,
      ),
    );
    await run.handleMessage({ ...request, triggerContext: null });
    await run.awaitIdle();
  };

  const writesBy = (promptHandler: string) =>
    writes.filter((write) => write.data['promptHandler'] === promptHandler);

  return {
    run,
    runStore,
    writes,
    writesBy,
    implementerStarts,
    emitProviderIdentity,
    code,
    pressReview,
    sendFollowUp,
    repoDir,
    submissionToolRegistry: ownership.submissionToolRegistry,
  };
};

describe.each([
  ['with focus text', 'Did the test test the right thing?'],
  ['without focus text', ''],
])('Review after free-form coding (%s)', (_label, focus) => {
  it("persists Review output under the reviewer's provider session and keeps the Run's implementer session", async () => {
    const harness = await makeHarness();
    scriptReviewer();

    await harness.code('Implement the change.');
    await harness.pressReview(focus);

    // Implementation resumed the Run-owned session and was stamped with it.
    expect(harness.implementerStarts).toEqual(['resume']);
    const codingWrites = harness.writesBy(LocalPromptType.CodingFreeform);
    expect(codingWrites.length).toBeGreaterThan(0);
    for (const write of codingWrites) {
      expect(write.data['providerSessionId']).toBe(IMPLEMENTER_SESSION);
    }

    // Review started a fresh provider session: no resume of the implementer's.
    expect(reviewerSdk.startSessionConfigs).toHaveLength(1);
    const [reviewerStart = {}] = reviewerSdk.startSessionConfigs;
    expect(reviewerStart['resume']).toBeUndefined();
    expect(reviewerStart['resumeSessionId']).toBeUndefined();
    expect(JSON.stringify(reviewerStart)).not.toContain(IMPLEMENTER_SESSION);
    if (focus) expect(String(reviewerStart['prompt'])).toContain(focus);

    // Review narration (interstitial) and completion reached the platform.
    const reviewWrites = harness.writesBy(LocalPromptType.CodeReview);
    const responses = reviewWrites.map((write) => String(write.data['response']));
    expect(responses.some((text) => text.startsWith('Reading the changed files.'))).toBe(true);
    expect(responses).toContain('Review complete: no issues found.');

    // Every persisted Review write identifies the reviewer, not the implementer.
    expect(reviewWrites.map((write) => write.data['providerSessionId'])).toEqual(
      reviewWrites.map(() => REVIEWER_SESSION),
    );

    // The Run keeps the implementer's identity, stays resumable on it, and
    // announces only the implementer to the platform.
    expect(harness.run.providerSessionId).toBe(IMPLEMENTER_SESSION);
    expect(harness.run.hasProviderSession).toBe(true);
    expect(
      harness.emitProviderIdentity.mock.calls.map(
        ([identity]) => (identity as { providerSessionId: string }).providerSessionId,
      ),
    ).toEqual([IMPLEMENTER_SESSION]);

    // After a reload the reviewer is a history member under the Review
    // handler, so it can be opened, while the Run's own session is unchanged.
    const persisted = await harness.runStore.getRun(RUN_ID);
    expect(persisted?.provider_session_id).toBe(IMPLEMENTER_SESSION);
    expect(persisted?.provider_session_agent_id).toBe('coding_freeform');
    expect(
      (persisted?.provider_session_history ?? []).map(
        ({ providerSessionId, providerSessionAgentId }) => ({
          providerSessionId,
          providerSessionAgentId,
        }),
      ),
    ).toContainEqual({
      providerSessionId: REVIEWER_SESSION,
      providerSessionAgentId: 'code_review',
    });

    // The context gauge stays on the implementer after a one-off Review.
    expect(harness.run.contextProviderSessionId()).toBe(IMPLEMENTER_SESSION);
  });
});

describe.each(['human', 'automation'])('Review non-editing authority (%s)', (launch) => {
  it('denies a noncanonical in-scope edit through the shared Review handler', async () => {
    const harness = await makeHarness();
    const repair = path.join(harness.repoDir, 'required-regression.ts');
    expect(harness.run.getFileChangeProjection()).toEqual([]);
    scriptReviewer(repair);
    if (launch === 'human') await harness.pressReview('Repair the session defect.');
    else {
      await harness.run.handleMessage({
        promptType: LocalPromptType.CodeReview,
        payload: {},
        references: { resolved: [], unresolved: [] },
        triggerContext: null,
      });
      await harness.run.awaitIdle();
    }
    expect(existsSync(repair)).toBe(false);
    expect(
      harness.writesBy(LocalPromptType.CodeReview).map((write) => String(write.data['response'])),
    ).toContain(
      'Assessment: requirements not fulfilled. Findings: High — persistence is lost on restart; add durable storage. Verification: confirmed by inspection; no repairs applied.',
    );
    const config = reviewerSdk.startSessionConfigs[0];
    expect(config?.['builtinTools']).toEqual(['Read', 'Bash', 'Glob', 'Grep']);
    expect(config?.['workspaceContainment']).toMatchObject({
      settings: {
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          allowUnsandboxedCommands: false,
          filesystem: { allowWrite: [], denyWrite: [realpathSync(harness.repoDir)] },
        },
      },
    });
    expect(reviewerSdk.startSessionConfigs).toHaveLength(1);
    expect(String(reviewerSdk.startSessionConfigs[0]?.['prompt'])).toContain(
      'Severity determines prominence and urgency; it never authorizes edits',
    );
    expect(JSON.stringify(reviewerSdk.startSessionConfigs)).not.toContain(
      'request_review_file_scope',
    );
    expect(harness.run.session.reviewFileScopeRequestPresentations).toBeUndefined();
    expect(harness.run.providerSessionId).toBe(IMPLEMENTER_SESSION);
    expect(harness.run.getFileChangeProjection()).toEqual([]);
  });
});

describe.each(['saved', 'unavailable'] as const)('Review walkthrough persistence: %s', (saving) => {
  it('keeps the universal submission tool callable and completes with findings regardless of saving', async () => {
    const proxy = makeCreateReportProxy();
    if (saving === 'saved')
      vi.mocked(proxy.create).mockResolvedValue({ content: [], reportId: 'walkthrough-result' });
    else vi.mocked(proxy.create).mockRejectedValue(new Error('Saving unavailable'));
    const tool = new CreateReportTool(proxy);
    const harness = await makeHarness(tool);
    reviewerSdk.script = async (emit) => {
      emit({ type: 'system', subtype: 'init', session_id: REVIEWER_SESSION });
      expect(reviewerSdk.startSessionConfigs.at(-1)?.['allowedTools']).toContain(
        'mcp__heyhey-submission-tools__create_report',
      );
      expect(
        harness.submissionToolRegistry
          .getByRunId(harness.run.runId)
          ?.tools.some((declaration) => declaration.name === 'create_report'),
      ).toBe(true);
      try {
        await tool.execute({
          runId: harness.run.runId,
          run: harness.run,
          args: {
            reportType: 'CHANGE_WALKTHROUGH',
            audience: 'PROJECT_VISIBLE',
            payload: {
              reportType: 'CHANGE_WALKTHROUGH',
              summary: 'Behavior explained',
              targetRunId: '11111111-1111-4111-8111-111111111111',
              groups: [],
            },
          },
        });
      } catch (error) {
        expect(saving).toBe('unavailable');
        expect(String(error)).toContain('Saving unavailable');
      }
      emit({
        type: 'assistant',
        session_id: REVIEWER_SESSION,
        message: {
          content: [
            {
              type: 'text',
              text: 'Overall: no issues. Change explanation: access is denied by default.',
            },
          ],
        },
      });
      emit({ type: 'result', subtype: 'success', session_id: REVIEWER_SESSION });
    };
    await harness.pressReview('');
    expect(proxy.create).toHaveBeenCalledOnce();
    expect(
      harness.writesBy(LocalPromptType.CodeReview).map((write) => String(write.data['response'])),
    ).toContain('Overall: no issues. Change explanation: access is denied by default.');
    expect(harness.run.activeTurn).toBeNull();
  });
});

describe.each(['code_review', 'commit'] as const)(
  '%s follow-up with a runtime selection',
  (handlerPromptType) => {
    it('returns ordinary replies to the captured project-mode provider session', async () => {
      const harness = await makeHarness(undefined, undefined, true);
      scriptReviewer();
      await harness.code('Continue the captured work.');
      await harness.sendFollowUp(handlerPromptType);
      await harness.code('Continue after the sub-agent.');

      expect(reviewerSdk.startSessionConfigs).toHaveLength(1);
      expect(harness.implementerStarts).toEqual(['resume', 'resume']);
      const writes = harness.writesBy(LocalPromptType.ProjectMode);
      expect(writes.length).toBeGreaterThan(0);
      expect(writes.every((write) => write.data['providerSessionId'] === IMPLEMENTER_SESSION)).toBe(
        true,
      );
      expect(harness.writesBy(LocalPromptType.CodingFreeform)).toHaveLength(0);
      const persisted = await harness.runStore.getRun(RUN_ID);
      expect(persisted?.provider_session_agent_id).toBe('project_mode');
      expect(persisted?.provider_session_id).toBe(IMPLEMENTER_SESSION);
      expect(persisted?.provider_session_history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerSessionAgentId: handlerPromptType,
            providerSessionId: REVIEWER_SESSION,
          }),
        ]),
      );
    });
    const runSettings: RunSettings = { model: 'claude-sonnet-4-6', reasoningEffort: 'high' };

    it("runs the sub-agent on exactly the selection for that Turn and leaves the Run's runtime", async () => {
      const harness = await makeHarness(undefined, runSettings);
      scriptReviewer();

      await harness.sendFollowUp(handlerPromptType, {
        provider: 'claude',
        model: 'claude-haiku-4-5',
        reasoningEffort: 'low',
        fastMode: true,
      });

      expect(reviewerSdk.startSessionConfigs).toHaveLength(1);
      expect(reviewerSdk.startSessionConfigs[0]).toMatchObject({
        model: 'claude-haiku-4-5',
        reasoningEffort: 'low',
        fastMode: true,
      });
      const persisted = await harness.runStore.getRun(RUN_ID);
      expect(persisted).toMatchObject({
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        reasoningEffort: 'high',
      });
      expect(persisted?.fastMode).toBeUndefined();
      expect(harness.run.provider).toBe('claude');
    });

    it('does not fill a field the selection leaves out from the Run', async () => {
      const harness = await makeHarness(undefined, runSettings);
      scriptReviewer();

      await harness.sendFollowUp(handlerPromptType, {
        provider: 'claude',
        model: 'claude-haiku-4-5',
      });

      const [start = {}] = reviewerSdk.startSessionConfigs;
      expect(start['model']).toBe('claude-haiku-4-5');
      expect(start['reasoningEffort']).toBeUndefined();
      expect(start['fastMode']).toBe(false);
    });

    it("uses the Run's current settings when the user made no selection", async () => {
      const harness = await makeHarness(undefined, runSettings);
      scriptReviewer();

      await harness.sendFollowUp(handlerPromptType);

      expect(reviewerSdk.startSessionConfigs).toHaveLength(1);
      expect(reviewerSdk.startSessionConfigs[0]).toMatchObject({
        model: 'claude-sonnet-4-6',
        reasoningEffort: 'high',
        fastMode: false,
      });
    });

    it("runs on the selected provider when it differs from the Run's, never on the Run's", async () => {
      const harness = await makeHarness(undefined, runSettings);
      scriptReviewer();

      await harness.sendFollowUp(handlerPromptType, {
        provider: 'codex',
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
        fastMode: false,
      });

      expect(reviewerSdk.startSessionConfigs).toHaveLength(0);
      expect(reviewerSdk.codexStartSessionConfigs).toHaveLength(1);
      expect(reviewerSdk.codexStartSessionConfigs[0]).toMatchObject({
        model: 'gpt-5.5',
        effort: 'medium',
        serviceTier: 'default',
      });
      const persisted = await harness.runStore.getRun(RUN_ID);
      expect(persisted).toMatchObject({ provider: 'claude', model: 'claude-sonnet-4-6' });
      expect(harness.run.provider).toBe('claude');
    });
  },
);
