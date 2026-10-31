/** @vitest-environment node */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionTokenUsageReader } from './session-token-usage';
import { RunStore } from '../run-store/run-store';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(['claude', 'codex'] as const)(
  'looks up %s native records, ignoring contradictory Run telemetry',
  async (provider) => {
    const root = await mkdtemp(path.join(tmpdir(), 'native-session-usage-'));
    roots.push(root);
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const claude = path.join(root, 'claude');
    const codex = path.join(root, 'codex');
    vi.stubEnv('CLAUDE_CONFIG_DIR', claude);
    vi.stubEnv('CODEX_HOME', codex);
    await mkdir(path.join(claude, 'projects', 'fixture'), { recursive: true });
    await mkdir(path.join(codex, 'sessions'), { recursive: true });
    const timestamp = '2026-09-28T10:00:00Z';
    const claudeRecord = {
      timestamp,
      type: 'assistant',
      uuid: 'message-1',
      sessionId,
      requestId: 'request-1',
      isSidechain: false,
      parentUuid: null,
      message: {
        id: 'message-1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5-20250929',
        content: [],
        usage: {
          input_tokens: 120,
          output_tokens: 8,
          cache_read_input_tokens: 500000,
          cache_creation_input_tokens: 0,
        },
      },
    };
    await writeFile(
      path.join(claude, 'projects', 'fixture', `${sessionId}.jsonl`),
      JSON.stringify(claudeRecord),
    );
    await writeFile(
      path.join(codex, 'sessions', `rollout-${sessionId}.jsonl`),
      [
        { timestamp, type: 'session_meta', payload: { id: sessionId } },
        {
          timestamp,
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              model: 'gpt-5',
              last_token_usage: {
                input_tokens: 500120,
                cached_input_tokens: 500000,
                output_tokens: 8,
                reasoning_output_tokens: 0,
                total_tokens: 500128,
              },
            },
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join('\n'),
    );
    const store = new RunStore({
      paths: {
        baseDir: root,
        runsDir: path.join(root, 'runs'),
        indexPath: path.join(root, 'index.json'),
        preferencesPath: path.join(root, 'prefs.json'),
      },
    });
    await store.initialize();
    const run = await store.createRun({
      entity: null,
      services: [],
      provider,
      provider_session_id: sessionId,
      provider_conversation_id: null,
      conversationId: 'conversation',
      contextMetadata: {
        capturedAt: timestamp,
        organizationId: 'org',
        projectId: 'project',
        agentSessionId: 'run',
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
    });
    await store.setRunTokenUsage(run.agentic_session_id, {
      inputTokens: 14000,
      outputTokens: 400000,
    });
    await store.updateRunLatestTurn(run.agentic_session_id, {
      turnId: 'finished',
      state: 'settled',
      outcome: 'COMPLETED',
    });
    await store.updateRunProviderIdentity(run.agentic_session_id, {
      providerSessionId: null,
      providerSessionAgentId: null,
    });
    const usage = (await store.getRunResult(run.agentic_session_id))?.usage;
    expect(usage).toMatchObject({
      inputTokens: 120,
      outputTokens: 8,
      cacheReadInputTokens: 500000,
    });
    const reopened = new RunStore({
      paths: {
        baseDir: root,
        runsDir: path.join(root, 'runs'),
        indexPath: path.join(root, 'index.json'),
        preferencesPath: path.join(root, 'prefs.json'),
      },
    });
    expect((await reopened.getRunResult(run.agentic_session_id))?.usage).toEqual(usage);
    await rm(
      provider === 'claude'
        ? path.join(claude, 'projects', 'fixture', `${sessionId}.jsonl`)
        : path.join(codex, 'sessions', `rollout-${sessionId}.jsonl`),
    );
    await expect(reopened.getRunResult(run.agentic_session_id)).rejects.toThrow('unavailable');
  },
);

it('never substitutes absent native measurements', async () => {
  const missing = new SessionTokenUsageReader(() =>
    Promise.resolve(JSON.stringify({ sessions: [] })),
  );
  await expect(missing.read('claude', 'native-session')).rejects.toThrow('unavailable');
  const partial = new SessionTokenUsageReader(() =>
    Promise.resolve(
      JSON.stringify({ sessions: [{ sessionId: 'native-session', outputTokens: 8 }] }),
    ),
  );
  expect(await partial.read('codex', 'native-session')).toEqual({ outputTokens: 8 });
});

it('isolates malformed usage to the selected native session', async () => {
  const reader = new SessionTokenUsageReader(() =>
    Promise.resolve(
      JSON.stringify({
        sessions: [
          { sessionId: 'broken', inputTokens: -1, outputTokens: 8 },
          { sessionId: 'healthy', inputTokens: 120, outputTokens: 8 },
        ],
      }),
    ),
  );
  await expect(reader.read('claude', 'broken')).rejects.toThrow();
  expect(await reader.read('claude', 'healthy')).toEqual({ inputTokens: 120, outputTokens: 8 });
});
