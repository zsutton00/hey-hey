import { reportChangedFilesTool } from '../agents/submission-tools/report-changed-files-tool';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';
import type {
  AgentStartupPromptInputResult,
  PromptTypeHandlerDeps,
} from '../agents/prompt-type-handler';
import {
  createOnCompleteTestDeps,
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../agents/prompt-type-handler.test-support';
import type { AgentRunResult, RunPromptArgs } from '../agents/providers/session-runner';
import { SubmissionToolsHttpController } from '../agents/submission-tools/http-mcp';
import { RunStore } from '../run-store/run-store';
import { LocalAgentEndpoint } from '../server/local-base-url';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import type { ImplementationReadinessDisposition } from '../shared/api/generated/api';
import { createReadinessSourceSnapshotFromStartupInput } from '../agents/implementation-readiness/source-snapshot';
import { Run, type RunCollaborators } from './run';
import { RunnerPicker } from './runners/pick-runner';
import {
  createRunTestOAuthClient,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunChangedFilesReader,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestRunRegistry,
  createTestSessionRunnerFacade,
} from './run.test-support';

/**
 * A free-form Run with no workflow whose launch readiness check saved
 * REVIEW_REQUIRED. The user's next composer reply must re-run that check:
 * the scripted model reads the canonical source binding out of the real
 * prompt, calls `submit_implementation_readiness` through the real MCP HTTP
 * controller, and ends the turn. Readiness is read back from a real RunStore
 * on disk.
 *
 * Faked boundaries only: the provider (the scripted model), the platform
 * (message poster, platform HTTP) and the entity-context fetch.
 */

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: vi.fn().mockResolvedValue(undefined),
}));

const RUN_ID = 'run-readiness-clarification';
const TASK_ID = '6b0f7a51-2c4e-4d3b-9a8e-1f2d3c4b5a60';
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const startupPromptInput: AgentStartupPromptInputResult = {
  startupInput: {
    task: {
      id: TASK_ID,
      title: 'Readiness-gated task',
      taskType: 'STANDARD',
      description: 'Store the signup copy somewhere.',
    },
    focalEntity: { entityType: 'TASK', entityId: TASK_ID },
    adjacentScopeTasks: [],
    evidenceItems: [],
  },
  renderedInput: 'CURRENT ENTITY CONTEXT',
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: TASK_ID },
    entity: {
      id: TASK_ID,
      title: 'Readiness-gated task',
      type: 'STANDARD',
      summary: 'Store the signup copy somewhere.',
      sections: [],
    } as never,
    context: {
      entityId: TASK_ID,
      entityType: 'TASK',
      displayName: 'Readiness-gated task',
      taskType: 'STANDARD',
      content: {
        sections: { description: 'Store the signup copy somewhere.' },
        status: 'ACTIVE',
        priority: 'MEDIUM',
        assigneeId: null,
        dueDate: null,
      },
      featureHierarchy: [],
      relatedEntities: [],
      planContext: null,
    } as never,
  },
  provenance: {
    templateKey: 'task',
    ownershipSource: { scope: 'CANONICAL' },
    revisionId: 'template-revision-1',
    revisionNumber: 1,
  },
  template: {
    templateKey: 'task',
    selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'STANDARD' },
    syntaxVersion: 'V1',
    content: 'CURRENT ENTITY CONTEXT',
    provenance: {
      templateKey: 'task',
      ownershipSource: { scope: 'CANONICAL' },
      revisionId: 'template-revision-1',
      revisionNumber: 1,
    },
  },
};

const makeFinding = (unresolvedDecision: string) => ({
  affectedSourceContext: 'The task description',
  unresolvedDecision,
  consequentialInventionRisk: 'Implementation could place durable state in the wrong service.',
  boundedEvidence: [
    {
      category: 'behavior' as const,
      statement: 'The task leaves the owning service open.',
      sourceRef: 'task.description',
    },
  ],
  answerKind: 'Name the authoritative service.',
});

const launchReviewRequired = (): ImplementationReadinessDisposition => {
  const sourceSnapshot = createReadinessSourceSnapshotFromStartupInput({
    runId: RUN_ID,
    startupPromptInput,
    capturedAt: '2026-10-05T04:40:00.000Z',
  });
  if (!sourceSnapshot) throw new Error('Expected a task source snapshot.');
  return {
    state: 'REVIEW_REQUIRED',
    sourceSnapshot,
    finding: makeFinding('Which service owns the write path?'),
    resolution: { kind: 'NONE' },
  };
};

/** Reads the canonical source binding the way the model must: from the prompt. */
const sourceBindingFromPrompt = (prompt: string) => {
  const read = (field: string): string => {
    const match = new RegExp(`- ${field}: \`([^\`]+)\``).exec(prompt);
    if (!match?.[1]) throw new Error(`Prompt carries no canonical ${field}.`);
    return match[1];
  };
  return {
    runId: read('runId'),
    focalEntityId: read('focalEntityId'),
    focalEntityType: read('focalEntityType'),
    sourceRevision: read('sourceRevision'),
    capturedAt: new Date().toISOString(),
  };
};

const completionJson = (response: string): string => JSON.stringify({ response, changedFiles: [] });

interface ToolCallResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}

/** Whether the provider started a fresh session or resumed the Run's existing one. */
interface ProviderTurn {
  start: 'mint' | 'resume';
  prompt: string;
}

type ScriptedTurn = (turn: {
  prompt: string;
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolCallResult>;
}) => Promise<string>;

const makeHarness = async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-readiness-clarification-'));
  tempDirs.push(baseDir);
  // The Run's workspace write boundary keeps provider state under the user's
  // home directory; keep it inside this test's directory instead.
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
  await runStore.createRun({
    entity: { entityType: 'TASK', entityId: TASK_ID },
    agentic_session_id: RUN_ID,
    services: [{ id: 'service-1', path: repoDir }],
    launchServiceId: 'service-1',
    provider: 'claude',
    provider_session_id: 'provider-launch-session',
    provider_conversation_id: null,
    provider_session_agent_id: 'free_form',
    conversationId: 'conversation-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: RUN_ID,
    },
  } as never);
  await runStore.updateRunPromptType(RUN_ID, LocalPromptType.FreeForm);
  await runStore.updateRunImplementationReadiness(RUN_ID, launchReviewRequired());
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

  const promptTypes = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
  const ownership = createTestRunOwnership((promptType) => promptTypes.get(promptType));
  const poster = createTestMessagePoster();

  // The MCP controller and the scripted model reach the Run the way production
  // does, through the registry, so it is bound once constructed below.
  const live: { run: Run | null } = { run: null };
  const runRegistry = createTestRunRegistry(() => live.run);
  const mcp = new SubmissionToolsHttpController(
    ownership.submissionToolRegistry,
    runRegistry,
    poster,
    logger,
  );
  const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    const registration = ownership.submissionToolRegistry.getByRunId(RUN_ID);
    if (!registration) throw new Error('No submission tools are mounted for the Run.');
    let body: unknown;
    const res = {
      status() {
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    } as unknown as Response;
    await mcp.handle(
      {
        params: { token: registration.token },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      } as unknown as Request,
      res,
    );
    const rpc = body as { result?: ToolCallResult; error?: { message: string } };
    if (rpc.error) throw new Error(rpc.error.message);
    if (!rpc.result) throw new Error(`${name} returned no result.`);
    return rpc.result;
  };

  const script: ScriptedTurn[] = [];
  const turns: ProviderTurn[] = [];
  const runTurn = async (
    start: ProviderTurn['start'],
    args: RunPromptArgs,
  ): Promise<AgentRunResult> => {
    turns.push({ start, prompt: args.prompt });
    const next = script.shift();
    if (!next) throw new Error('The scripted model has no turn left.');
    const providerSessionId =
      start === 'mint'
        ? `provider-session-${String(turns.length)}`
        : (args.session.provider_session_id ?? `provider-session-${String(turns.length)}`);
    const summary = await next({ prompt: args.prompt, callTool });
    if (!live.run) throw new Error('The Run is not constructed.');
    live.run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'system',
        timestamp: new Date().toISOString(),
        sessionId: providerSessionId,
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
        sessionId: providerSessionId,
        agentId: 'claude',
        payload: { messageType: 'assistant', taskComplete: true, summary },
      },
    });
    return {
      providerSessionId,
      providerConversationId: null,
      errorCount: 0,
    };
  };
  const sessionRunnerFacade = createTestSessionRunnerFacade({
    runPrompt: vi.fn((args: RunPromptArgs) => runTurn('mint', args)),
    resumeSession: vi.fn((args: RunPromptArgs) => runTurn('resume', args)),
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
  const handlerDeps = createPromptTypeHandlerTestDeps({
    startupPromptInput: {
      resolve: vi.fn().mockResolvedValue(startupPromptInput),
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'],
    auth: createPromptTypeHandlerTestAuth('readiness-clarification-token'),
    apiBaseUrl: 'https://api.example.test/api/v1',
    fetchImpl: platformFetch,
    logger,
  });
  const runnerPicker = new RunnerPicker({
    sessionRunnerFacade,
    oauthClient: createRunTestOAuthClient(),
    logger,
    runChangedFilesReader: createTestRunChangedFilesReader(),
    submissionToolRegistry: ownership.submissionToolRegistry,
    localAgentEndpoint: new LocalAgentEndpoint(),
  });

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
      broadcaster: createTestRunEventPublisher(),
      ...ownership,
      handlerDeps,
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
  const submitExternalAgentCompletion = vi.spyOn(poster, 'submitExternalAgentCompletion');

  const reply = async (userMessage: string): Promise<void> => {
    await run.handleMessage({
      promptType: LocalPromptType.CodingFreeform,
      payload: { promptType: LocalPromptType.CodingFreeform, userMessage },
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    });
    await run.awaitIdle();
  };

  const persisted = async () => {
    const stored = await runStore.getRun(RUN_ID);
    return {
      readiness: await runStore.getRunImplementationReadiness(RUN_ID),
      promptType: stored?.promptType ?? null,
    };
  };

  const loggedInfo = (event: string) =>
    (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[0] === event);

  return { run, script, turns, reply, persisted, submitExternalAgentCompletion, loggedInfo };
};

describe('readiness clarification on a free-form Run with no workflow', () => {
  it('accepts a CLEAR from the clarification, resolves the gate and lets the next reply code', async () => {
    const harness = await makeHarness();
    let clearResult: ToolCallResult | undefined;
    harness.script.push(async ({ prompt, callTool }) => {
      clearResult = await callTool('submit_implementation_readiness', {
        disposition: {
          state: 'CLEAR',
          sourceSnapshot: sourceBindingFromPrompt(prompt),
          finding: null,
          resolution: { kind: 'NONE' },
        },
      });
      return completionJson('The API owns the write path; implemented it there.');
    });
    harness.script.push(() => Promise.resolve(completionJson('Added the test you asked for.')));

    await harness.reply('The API owns the write path.');

    // The clarification resumes the launch's provider session, so the prompt
    // the model sees must itself carry the finding and the source binding.
    const [clarification] = harness.turns;
    expect(clarification?.start).toBe('resume');
    expect(clarification?.prompt).toContain('## Readiness clarification');
    expect(clarification?.prompt).toContain('Which service owns the write path?');
    expect(clarification?.prompt).toContain('The API owns the write path.');
    expect(clearResult?.isError).not.toBe(true);
    expect(clearResult?.content[0]?.text).toContain('recorded as CLEAR');

    const afterClarification = await harness.persisted();
    expect(afterClarification.readiness?.state).toBe('CLEAR');
    expect(afterClarification.promptType).toBe(LocalPromptType.FreeForm);

    await harness.reply('Now add a test for it.');

    expect(harness.turns).toHaveLength(2);
    expect(harness.turns[1]?.prompt).not.toContain('## Readiness clarification');
    expect(harness.turns[1]?.prompt).toContain('Now add a test for it.');
    expect(
      harness.loggedInfo('local.run.implementation_readiness.clarification_routed'),
    ).toHaveLength(1);
    const final = await harness.persisted();
    expect(final.readiness?.state).toBe('CLEAR');
    expect(final.promptType).toBe(LocalPromptType.CodingFreeform);
    expect(harness.submitExternalAgentCompletion).not.toHaveBeenCalled();
  });

  it('keeps an unresolved reassessment reviewable and re-runs the check on the next reply', async () => {
    const harness = await makeHarness();
    const narrowed = makeFinding('Which API version owns the write path?');
    let validation: ToolCallResult | undefined;
    harness.script.push(async ({ prompt, callTool }) => {
      const disposition = {
        state: 'REVIEW_REQUIRED',
        sourceSnapshot: sourceBindingFromPrompt(prompt),
        finding: narrowed,
        resolution: { kind: 'NONE' },
      };
      validation = await callTool('submit_implementation_readiness', { disposition });
      return `\`\`\`json\n${JSON.stringify({
        responseType: 'implementation_readiness_v1',
        disposition,
      })}\n\`\`\``;
    });
    harness.script.push(() => Promise.resolve(completionJson('v2 it is; implemented there.')));

    await harness.reply('The API owns it.');

    expect(validation?.isError).not.toBe(true);
    const afterFirst = await harness.persisted();
    expect(afterFirst.readiness?.state).toBe('REVIEW_REQUIRED');
    expect(afterFirst.readiness?.finding?.unresolvedDecision).toBe(
      'Which API version owns the write path?',
    );
    expect(afterFirst.promptType).toBe(LocalPromptType.FreeForm);

    await harness.reply('v2.');

    expect(harness.turns).toHaveLength(2);
    expect(harness.turns[1]?.prompt).toContain('## Readiness clarification');
    expect(harness.turns[1]?.prompt).toContain('Which API version owns the write path?');
    expect((await harness.persisted()).promptType).toBe(LocalPromptType.FreeForm);
    expect(
      harness.loggedInfo('local.run.implementation_readiness.clarification_routed'),
    ).toHaveLength(2);
    expect(harness.submitExternalAgentCompletion).not.toHaveBeenCalled();
  });

  it('refuses to reopen a gate the clarification already resolved', async () => {
    const harness = await makeHarness();
    let reopen: ToolCallResult | undefined;
    harness.script.push(async ({ prompt, callTool }) => {
      const sourceSnapshot = sourceBindingFromPrompt(prompt);
      await callTool('submit_implementation_readiness', {
        disposition: {
          state: 'CLEAR',
          sourceSnapshot,
          finding: null,
          resolution: { kind: 'NONE' },
        },
      });
      reopen = await callTool('submit_implementation_readiness', {
        disposition: {
          state: 'REVIEW_REQUIRED',
          sourceSnapshot,
          finding: makeFinding('Should we reconsider?'),
          resolution: { kind: 'NONE' },
        },
      });
      return completionJson('Done.');
    });

    await harness.reply('The API owns the write path.');

    expect(reopen?.isError).toBe(true);
    expect(reopen?.content.map((block) => block.text).join('\n')).toContain('already complete');
    expect((await harness.persisted()).readiness?.state).toBe('CLEAR');
  });
});
