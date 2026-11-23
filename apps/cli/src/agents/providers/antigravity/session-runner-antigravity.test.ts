/** @vitest-environment node */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OAuthClient } from '../../../auth';
import { createTestRun, createTestRunStore } from '../../../run/run.test-support';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import { NOOP_LOGGER } from '../../../server/logger';
import { ProjectMaturity } from '../../../shared/api/index';
import { tryParsePermissionRequestResponse } from '../../message-mapping';
import { translatePermissionDecisionToDispatch } from '../../permission-response-routing';
import { RunWorkspaceWriteBoundary } from '../../workspace-write-boundary';
import { SubmissionToolRegistry } from '../../submission-tools/registry';
import { antigravityModelsFromSession } from '../../../server/model-catalog/antigravity-models';
import { acpResultSchemas } from './acp-schemas';
import { AntigravityAgentSessionRunner } from './session-runner-antigravity';

vi.mock(import('node:child_process'), async (original) => ({
  ...(await original()),
  spawn: vi.fn(),
}));
vi.mock('../../prompts/session-start-context', () => ({
  readSessionStartContext: async () => ({
    workItemTypeDefinitions: [],
    maturity: ProjectMaturity.Established,
    intentFirst: false,
    hintsEnabled: false,
    productDevelopment: false,
  }),
}));

interface ConfigOption {
  id: string;
  currentValue?: string | undefined;
}
interface Frame {
  id: number;
  method?: string;
  params?: {
    sessionId?: string;
    configId?: string;
    value?: string;
    prompt?: unknown;
    update?: { sessionUpdate?: string };
  };
  result?: {
    sessionId?: string;
    configOptions?: ConfigOption[];
    models?: { currentModelId?: string; availableModels?: { modelId: string; name: string }[] };
  };
}

/** The session/new result and the commands agy advertised in the recorded `quick` run. */
const recorded = (() => {
  const frames: Frame[] = readFileSync(
    'src/agent-runtime/node/__fixtures__/antigravity/quick.ndjson',
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line).frame);
  const created = frames.find((frame) => frame.result?.sessionId)?.result;
  if (!created?.configOptions) {
    throw new Error('quick recording has no session/new result');
  }
  const commands = frames.find(
    (frame) => frame.params?.update?.sessionUpdate === 'available_commands_update',
  )?.params?.update;
  return { created, commands };
})();

/** Plays agy: answers from the recorded session and applies config changes like agy would. */
const COMPACT_USAGE = { inputTokens: 900, outputTokens: 100, totalTokens: 1000 };

const PERMISSION_ID_BASE = 1000;
interface PermissionAsk {
  toolCall: { toolCallId: string; kind?: string; rawInput?: Record<string, unknown> };
  options: { optionId: string; kind: string; name: string }[];
}
interface PermissionResponse {
  id: number;
  result?: { outcome: { outcome: string; optionId?: string } };
}

const startFakeAgy = (
  options: {
    keepOption?: string;
    omitModelOption?: boolean;
    compactUsage?: boolean;
    permissionRequests?: PermissionAsk[];
    /** Updates agy streams for a prompt before it returns. */
    promptUpdates?: Record<string, unknown>[];
    /** agy prints this on stderr and exits instead of answering `initialize`. */
    failStartWith?: string;
  } = {},
) => {
  const requests: Frame[] = [];
  const permissionResponses: PermissionResponse[] = [];
  const options_: ConfigOption[] = structuredClone(recorded.created.configOptions ?? []).filter(
    (option) => !(options.omitModelOption && option.id === 'model'),
  );
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    const reply = (id: number, result: unknown) =>
      child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
    const asks = options.permissionRequests ?? [];
    let promptId: number | undefined;
    child.stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        handle(JSON.parse(line));
      }
    });
    const handle = (request: Frame & PermissionResponse) => {
      if (request.id >= PERMISSION_ID_BASE) {
        permissionResponses.push(request);
        if (permissionResponses.length === asks.length && promptId !== undefined) {
          reply(promptId, { stopReason: 'end_turn' });
        }
        return;
      }
      requests.push(request);
      switch (request.method) {
        case 'initialize':
          if (options.failStartWith) {
            child.stderr.write(options.failStartWith);
            setTimeout(() => child.emit('exit', 1, null), 10);
            break;
          }
          reply(request.id, { protocolVersion: 1 });
          break;
        case 'session/new':
          reply(request.id, { ...recorded.created, configOptions: options_ });
          child.stdout.write(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'session/update',
              params: { sessionId: recorded.created.sessionId, update: recorded.commands },
            }) + '\n',
          );
          break;
        case 'session/set_config_option': {
          const { configId, value } = request.params ?? {};
          if (configId !== options.keepOption) {
            const option = options_.find((entry) => entry.id === configId);
            if (option) {
              option.currentValue = value;
            }
          }
          reply(request.id, { configOptions: options_ });
          break;
        }
        case 'session/set_mode':
          reply(request.id, {});
          break;
        case 'session/prompt':
          if (asks.length > 0 && !JSON.stringify(request.params?.prompt).includes('/compact')) {
            promptId = request.id;
            asks.forEach((ask, index) =>
              child.stdout.write(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: PERMISSION_ID_BASE + index,
                  method: 'session/request_permission',
                  params: { sessionId: recorded.created.sessionId, ...ask },
                }) + '\n',
              ),
            );
            break;
          }
          for (const update of options.promptUpdates ?? []) {
            child.stdout.write(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'session/update',
                params: { sessionId: recorded.created.sessionId, update },
              }) + '\n',
            );
          }
          reply(request.id, {
            stopReason: 'end_turn',
            ...(options.compactUsage && JSON.stringify(request.params?.prompt).includes('/compact')
              ? { usage: COMPACT_USAGE }
              : {}),
          });
          break;
      }
    };
    return child as unknown as ReturnType<typeof spawn>;
  });
  return Object.assign(requests, { permissionResponses });
};

const makeRunner = () => {
  const run = createTestRun({ provider: 'antigravity' });
  const runStore = createTestRunStore();
  const recordTokens = vi
    .spyOn(runStore, 'updateRunTokenUsage')
    .mockImplementation(() => Promise.resolve(run.session));
  const agentOutput = vi.spyOn(run, 'onAgentOutput').mockImplementation(() => {});
  const runner = new AntigravityAgentSessionRunner({
    agentOutputOwner: run,
    runStore,
    submissionToolRegistry: new SubmissionToolRegistry(),
    oauthClient: new OAuthClient(),
    localAgentEndpoint: new LocalAgentEndpoint(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      child: () => NOOP_LOGGER,
    },
  });
  const { launchServiceId: _launch, ...baseSession } = run.session;
  const session = { ...baseSession, provider: 'antigravity' as const, services: [] };
  return { runner, session, recordTokens, agentOutput };
};

describe('Antigravity streamed replies', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  const chunk = (text: string) => ({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text },
  });

  it('shows each passage once, whole, and keeps passages split by a tool call apart', async () => {
    startFakeAgy({
      promptUpdates: [
        chunk('Looking at @[task:2d5158b4-f564-'),
        chunk('4891-a9ea-4134ebd2ea72|Fix login]'),
        chunk(' first.'),
        { sessionUpdate: 'tool_call', toolCallId: 'read-1', name: 'read', status: 'pending' },
        chunk('Done, '),
        chunk('the fix is in.'),
      ],
    });
    const { runner, session, agentOutput } = makeRunner();

    await runner.runPrompt({ session, prompt: 'hello' });

    const replies = agentOutput.mock.calls
      .map(([{ event }]) => event.payload)
      .filter((payload) => payload['messageType'] === 'assistant');
    expect(replies).toEqual([
      {
        messageType: 'assistant',
        summary: 'Looking at @[task:2d5158b4-f564-4891-a9ea-4134ebd2ea72|Fix login] first.',
      },
      { messageType: 'assistant', summary: 'Done, the fix is in.', taskComplete: true },
    ]);
    // Each passage closes its own activity entry, so the reply after the tool
    // call cannot overwrite the passage before it.
    const narration = agentOutput.mock.calls
      .map(([{ event }]) => event.providerFacts?.narration)
      .filter((fact) => fact != null);
    expect(narration.map((fact) => fact?.isFinal)).toEqual([true, true]);
    await runner.dispose();
  });
});

describe('Antigravity launch selection and compaction', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('runs the model and thinking level the launch selected before the first prompt', async () => {
    const requests = startFakeAgy();
    const { runner, session } = makeRunner();

    await runner.runPrompt({
      session,
      prompt: 'hello',
      model: 'claude-sonnet-5-5',
      reasoningEffort: 'low',
    });

    const methods = requests.map(({ method }) => method);
    expect(
      requests
        .filter(({ method }) => method === 'session/set_config_option')
        .map(({ params }) => [params?.configId, params?.value]),
    ).toEqual([
      ['model', 'claude-sonnet-5-5'],
      ['thought_level', 'low'],
    ]);
    expect(methods.lastIndexOf('session/set_config_option')).toBeLessThan(
      methods.indexOf('session/prompt'),
    );
    await runner.dispose();
  });

  it('keeps the session default when the launch names no model', async () => {
    const requests = startFakeAgy();
    const { runner, session } = makeRunner();

    await runner.runPrompt({ session, prompt: 'hello' });

    expect(requests.some(({ method }) => method === 'session/set_config_option')).toBe(false);
    await runner.dispose();
  });

  it('fails the launch when agy would run a different model than the one selected', async () => {
    const requests = startFakeAgy({ keepOption: 'model' });
    const { runner, session } = makeRunner();

    await expect(
      runner.runPrompt({ session, prompt: 'hello', model: 'claude-sonnet-5-5' }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });
    expect(requests.some(({ method }) => method === 'session/prompt')).toBe(false);
    await runner.dispose();
  });

  it('fails the launch for a model agy does not list', async () => {
    startFakeAgy();
    const { runner, session } = makeRunner();

    await expect(
      runner.runPrompt({ session, prompt: 'hello', model: 'not-a-model' }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });
    await runner.dispose();
  });

  it('compacts through the /compact command agy advertises', async () => {
    const requests = startFakeAgy();
    const { runner, session } = makeRunner();
    await runner.runPrompt({ session, prompt: 'hello' });

    await runner.compact();

    const prompts = requests.filter(({ method }) => method === 'session/prompt');
    expect(prompts.at(-1)?.params?.prompt).toEqual([{ type: 'text', text: '/compact' }]);
    await runner.dispose();
  });

  it('reports compaction as unsupported when there is no live session', async () => {
    const { runner } = makeRunner();

    await expect(runner.compact()).rejects.toMatchObject({ code: 'NO_ACTIVE_SESSION' });
  });

  it('counts the tokens a compaction reply reports against the run', async () => {
    startFakeAgy({ compactUsage: true });
    const { runner, session, recordTokens } = makeRunner();
    await runner.runPrompt({ session, prompt: 'hello' });

    await runner.compact();

    expect(recordTokens).toHaveBeenCalledTimes(1);
    expect(recordTokens).toHaveBeenCalledWith(session.agentic_session_id, {
      inputTokens: COMPACT_USAGE.inputTokens,
      outputTokens: COMPACT_USAGE.outputTokens,
    });
    await runner.dispose();
  });

  it('leaves tokens unavailable when a compaction reply reports none', async () => {
    startFakeAgy();
    const { runner, session, recordTokens } = makeRunner();
    await runner.runPrompt({ session, prompt: 'hello' });

    await runner.compact();

    expect(recordTokens).not.toHaveBeenCalled();
    await runner.dispose();
  });

  describe('when agy reports models but offers no model choice', () => {
    const sessionResult = () =>
      acpResultSchemas['session/new'].parse({
        ...recorded.created,
        configOptions: (recorded.created.configOptions ?? []).filter(
          (option) => option.id !== 'model',
        ),
      });

    it('launches every model the catalog lists from that same response', async () => {
      const { models } = antigravityModelsFromSession(sessionResult());
      expect(models.length).toBeGreaterThan(0);

      for (const model of models) {
        startFakeAgy({ omitModelOption: true });
        const { runner, session } = makeRunner();
        await expect(
          runner.runPrompt({ session, prompt: 'hello', model: model.id }),
        ).resolves.toBeDefined();
        await runner.dispose();
      }
    });

    it('does not list a model it would refuse to launch', async () => {
      const { models } = antigravityModelsFromSession(sessionResult());
      const otherModel = recorded.created.models?.availableModels?.find(
        (model) => model.modelId !== recorded.created.models?.currentModelId,
      );
      if (!otherModel) {
        throw new Error('quick recording lists only one model');
      }
      expect(models.map((model) => model.id)).not.toContain(otherModel.modelId);

      startFakeAgy({ omitModelOption: true });
      const { runner, session } = makeRunner();
      await expect(
        runner.runPrompt({ session, prompt: 'hello', model: otherModel.modelId }),
      ).rejects.toMatchObject({ code: 'RUN_FAILED' });
      await runner.dispose();
    });
  });
});

describe('Antigravity repository-bound sessions', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('refuses a repository-bound session that has no write containment', async () => {
    startFakeAgy();
    const { runner, session } = makeRunner();

    await expect(
      runner.runPrompt({ session: { ...session, workspaceBound: true }, prompt: 'hello' }),
    ).rejects.toMatchObject({ code: 'ANTIGRAVITY_CONTAINMENT_REQUIRED' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports a sandbox that cannot start as a containment failure, not an org-policy denial or sign-in problem', async () => {
    startFakeAgy({
      failStartWith: 'sandbox-exec: sandbox_apply: Operation not permitted\n',
    });
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agy-no-sandbox-')));
    const service = path.join(base, 'service');
    await fs.mkdir(path.join(service, '.git'), { recursive: true });
    const boundary = await RunWorkspaceWriteBoundary.create(
      {
        ok: true,
        runMode: 'default',
        repositoryPathForRunStarted: service,
        cwd: service,
        allowedRepositoryRoots: [service],
        bindingRepositoryPath: service,
        workspaceRoot: null,
      },
      { runScopeId: 'agy-no-sandbox', providerStateRoot: path.join(base, 'state') },
    );
    const { runner, session } = makeRunner();
    try {
      const error = await runner
        .runPrompt({
          session: { ...session, workspaceBound: true },
          prompt: 'hello',
          workspaceWriteBoundary: boundary,
        })
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ code: 'ANTIGRAVITY_CONTAINMENT_REQUIRED' });
      expect((error as Error).message).toMatch(/Operation not permitted/);
      expect((error as Error).message).not.toMatch(/organization|sign in/i);
    } finally {
      await runner.dispose();
      await boundary.dispose();
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it('launches agy inside the Run sandbox with the real HOME and answers writes outside the roots with a rejection', async () => {
    startFakeAgy();
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agy-contained-')));
    const service = path.join(base, 'service');
    await fs.mkdir(path.join(service, '.git'), { recursive: true });
    const boundary = await RunWorkspaceWriteBoundary.create(
      {
        ok: true,
        runMode: 'default',
        repositoryPathForRunStarted: service,
        cwd: service,
        allowedRepositoryRoots: [service],
        bindingRepositoryPath: service,
        workspaceRoot: null,
      },
      { runScopeId: 'agy-contained', providerStateRoot: path.join(base, 'state') },
    );
    const { runner, session } = makeRunner();
    try {
      await runner.runPrompt({
        session: { ...session, workspaceBound: true },
        prompt: 'hello',
        workspaceWriteBoundary: boundary,
      });

      const [command, args, options] = vi.mocked(spawn).mock.calls[0]!;
      expect(command).toBe(process.execPath);
      expect(args).toEqual(expect.arrayContaining(['agy', 'acp']));
      expect((options as { env: Record<string, string> }).env['HOME']).toBe(process.env['HOME']);
      await expect(boundary.assertWriteTargets([path.join(base, 'elsewhere.txt')])).rejects.toThrow(
        /outside the Run workspace/,
      );
    } finally {
      await runner.dispose();
      await boundary.dispose();
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  describe('permission requests', () => {
    const OPTIONS = [
      { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'allow-always', kind: 'allow_always', name: 'Always allow' },
      { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' },
    ];
    const edit = (target: string, options = OPTIONS): PermissionAsk => ({
      toolCall: { toolCallId: target, kind: 'edit', rawInput: { path: target } },
      options,
    });

    it('routes manual decisions to the matching pending ACP calls', async () => {
      const requests = startFakeAgy({
        permissionRequests: [edit('first.txt'), edit('second.txt')],
      });
      const { runner, session, agentOutput } = makeRunner();
      const prompt = runner.runPrompt({ session, prompt: 'Edit both files' });

      const settledPrompt = Promise.allSettled([prompt]);

      try {
        const cards = await vi.waitFor(() => {
          const events = agentOutput.mock.calls
            .map(([output]) => output.event)
            .filter((event) => event.eventType === 'permission_request_detected');
          expect(events).toHaveLength(2);
          return events.map((event) =>
            tryParsePermissionRequestResponse(JSON.stringify(event.payload)),
          );
        });

        for (const [index, decision] of (['deny', 'approve'] as const).entries()) {
          const card = cards[1 - index];
          expect(card?.permissionRequest).toMatchObject({
            agentId: session.agentic_session_id,
            agentType: 'antigravity',
          });
          if (!card) {
            throw new Error('Expected an actionable Antigravity permission request');
          }
          const request = card.permissionRequest;
          const dispatch = translatePermissionDecisionToDispatch({
            runId: session.agentic_session_id,
            sessionId: request.sessionId,
            requestId: request.id,
            agentType: request.agentType,
            idempotencyToken: request.idempotencyToken,
            decision,
            reason: null,
          });
          expect(await runner.submitPermissionDecision({ session, dispatch })).toMatchObject({
            delivered: true,
          });
        }

        await prompt;
        expect(
          requests.permissionResponses.map(({ id, result }) => [id, result?.outcome.optionId]),
        ).toEqual([
          [PERMISSION_ID_BASE + 1, 'reject-once'],
          [PERMISSION_ID_BASE, 'allow-once'],
        ]);
      } finally {
        await runner.dispose();
        await settledPrompt;
      }
    });

    /** Runs one skip-permissions prompt in which agy asks about each write; returns agy's answers. */
    const answersTo = async (asks: (service: string, base: string) => PermissionAsk[]) => {
      const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agy-permission-')));
      const service = path.join(base, 'service');
      await fs.mkdir(path.join(service, '.git'), { recursive: true });
      const boundary = await RunWorkspaceWriteBoundary.create(
        {
          ok: true,
          runMode: 'default',
          repositoryPathForRunStarted: service,
          cwd: service,
          allowedRepositoryRoots: [service],
          bindingRepositoryPath: service,
          workspaceRoot: null,
        },
        { runScopeId: 'agy-permission', providerStateRoot: path.join(base, 'state') },
      );
      const requests = startFakeAgy({ permissionRequests: asks(service, base) });
      const { runner, session } = makeRunner();
      try {
        await runner.runPrompt({
          session: { ...session, workspaceBound: true },
          prompt: 'hello',
          skipPermissions: true,
          workspaceWriteBoundary: boundary,
        });
        return requests.permissionResponses
          .sort((a, b) => a.id - b.id)
          .map((response) => response.result?.outcome.optionId);
      } finally {
        await runner.dispose();
        await boundary.dispose();
        await fs.rm(base, { recursive: true, force: true });
      }
    };

    it('rejects a write outside the Run roots even when permissions are skipped', async () => {
      const answers = await answersTo((_service, base) => [edit(path.join(base, 'elsewhere.txt'))]);

      expect(answers).toEqual(['reject-once']);
    });

    it('does not let an allow-always option or a stored always-allow rule widen the roots', async () => {
      const alwaysOnly = OPTIONS.filter((option) => option.kind !== 'allow_once');
      const answers = await answersTo((_service, base) => [
        edit(path.join(base, 'a.txt'), alwaysOnly),
        edit(path.join(base, 'b.txt'), alwaysOnly),
      ]);

      expect(answers).toEqual(['reject-once', 'reject-once']);
    });

    it('lets a write inside the Run roots through the pre-check', async () => {
      const answers = await answersTo((service) => [edit(path.join(service, 'src', 'a.txt'))]);

      expect(answers).toEqual(['allow-once']);
    });

    it('resolves a relative path against the boundary cwd', async () => {
      const answers = await answersTo(() => [edit('src/inside.txt'), edit('../escape.txt')]);

      expect(answers).toEqual(['allow-once', 'reject-once']);
    });
  });
});
