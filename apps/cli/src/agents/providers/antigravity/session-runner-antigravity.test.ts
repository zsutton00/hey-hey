/** @vitest-environment node */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OAuthClient } from '../../../auth';
import { createTestRun, createTestRunStore } from '../../../run/run.test-support';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import { NOOP_LOGGER } from '../../../server/logger';
import { ProjectMaturity } from '../../../shared/api/index';
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
    hintsProductDevelopment: false,
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

const startFakeAgy = (
  options: { keepOption?: string; omitModelOption?: boolean; compactUsage?: boolean } = {},
) => {
  const requests: Frame[] = [];
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
    child.stdin.on('data', (chunk: Buffer) => {
      const request: Frame = JSON.parse(chunk.toString());
      requests.push(request);
      switch (request.method) {
        case 'initialize':
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
          reply(request.id, {
            stopReason: 'end_turn',
            ...(options.compactUsage && JSON.stringify(request.params?.prompt).includes('/compact')
              ? { usage: COMPACT_USAGE }
              : {}),
          });
          break;
      }
    });
    return child as unknown as ReturnType<typeof spawn>;
  });
  return requests;
};

const makeRunner = () => {
  const run = createTestRun({ provider: 'antigravity' });
  const runStore = createTestRunStore();
  const recordTokens = vi.spyOn(runStore, 'updateRunTokenUsage').mockImplementation(() =>
    Promise.resolve(run.session),
  );
  vi.spyOn(run, 'onAgentOutput').mockImplementation(() => {});
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
  return { runner, session, recordTokens };
};

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
