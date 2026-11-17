import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageResponseDto } from '@hey-hey/contracts/api/models';
import { ClaudeSessionReader } from '../../provider-transcripts/claude-session-reader';
import { RunStore } from '../../run-store/run-store';
import { AgentSessionContinuationInspector } from '../agent-session-continuation-inspector';
import { NOOP_LOGGER } from '../logger';
import { CONTINUATION_MEMO_SOURCE, RunContinuationMaterializer } from './run-continuation';

const RUN_ID = '0b9a7a07-5a9f-4a6e-9a39-5f1f6f1f3a11';
const CONVERSATION_ID = '6a0d1d1e-1c7b-4c0c-9a8a-2b2b9b0f4e22';
const CONTINUATION_ID = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e55';
const PROVIDER_SESSION_ID = '11111111-2222-4333-8444-555555555555';

let root: string;
let claudeProjects: string;
let codexHome: string;
let store: RunStore;

const identity = {
  runId: RUN_ID,
  organizationId: 'organization',
  projectId: 'project',
  conversationId: CONVERSATION_ID,
  provider: 'claude',
};

const createStoredRun = async (overrides: { provider?: string; providerSessionId?: string }) => {
  await store.initialize();
  return store.createRun({
    agentic_session_id: RUN_ID,
    provider: overrides.provider ?? 'claude',
    provider_session_id: overrides.providerSessionId ?? PROVIDER_SESSION_ID,
    provider_conversation_id: null,
    conversationId: CONVERSATION_ID,
    entity: null,
    services: [],
    model: 'claude-opus-5-5',
    contextMetadata: {
      organizationId: 'organization',
      projectId: 'project',
      capturedAt: new Date().toISOString(),
      agentSessionId: RUN_ID,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
  });
};

const writeClaudeTranscript = async () => {
  const folder = path.join(claudeProjects, '-Users-someone-code-project');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, `${PROVIDER_SESSION_ID}.jsonl`), '{"type":"user"}\n');
};

const inspector = () =>
  new AgentSessionContinuationInspector(
    store,
    NOOP_LOGGER,
    [codexHome],
    new ClaudeSessionReader({ projectsDir: claudeProjects }),
  );

const classify = (provider = 'claude') =>
  inspector().classify(RUN_ID, { conversationId: CONVERSATION_ID, provider });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-continuation-'));
  claudeProjects = path.join(root, 'claude-projects');
  codexHome = path.join(root, 'codex');
  await fs.mkdir(claudeProjects, { recursive: true });
  store = new RunStore({
    paths: {
      baseDir: root,
      runsDir: path.join(root, 'runs'),
      indexPath: path.join(root, 'runs/index.json'),
      preferencesPath: path.join(root, 'preferences.json'),
    },
  });
});

afterEach(async () => {
  await fs.chmod(claudeProjects, 0o755).catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });
});

describe('continuation native-state inspection', () => {
  it('reports absence on a computer that never ran the session (different or wiped computer)', async () => {
    await store.initialize();
    expect(await classify()).toEqual({ nativeState: 'ABSENT', reason: 'NO_LOCAL_RUN' });
  });

  it('is usable only when the provider persisted the conversation, not merely when an id exists', async () => {
    await createStoredRun({});
    expect(await classify()).toEqual({
      nativeState: 'ABSENT',
      reason: 'PROVIDER_TRANSCRIPT_MISSING',
    });

    await writeClaudeTranscript();
    expect(await classify()).toEqual({
      nativeState: 'USABLE',
      reason: 'PROVIDER_STATE_PRESENT',
    });
  });

  it('treats a Run that never started a provider session as absent', async () => {
    await createStoredRun({ providerSessionId: `pending_${RUN_ID}` });
    expect(await classify()).toEqual({ nativeState: 'ABSENT', reason: 'NO_PROVIDER_SESSION' });
  });

  it('reports an unreadable provider store as its real cause, never as absence', async () => {
    await createStoredRun({});
    await fs.chmod(claudeProjects, 0o000);
    expect(await classify()).toEqual({
      nativeState: 'UNUSABLE',
      reason: 'LOCAL_STATE_UNREADABLE',
    });
  });

  it('never resumes another provider’s state or a provider without a verified store', async () => {
    await createStoredRun({ provider: 'opencode' });
    expect(await classify('claude')).toEqual({
      nativeState: 'UNUSABLE',
      reason: 'PROVIDER_MISMATCH',
    });
    expect(await classify('opencode')).toEqual({
      nativeState: 'UNUSABLE',
      reason: 'PROVIDER_RESUME_UNSUPPORTED',
    });
  });

  it('finds a Codex rollout for the persisted thread', async () => {
    await createStoredRun({ provider: 'codex' });
    expect((await classify('codex')).nativeState).toBe('ABSENT');
    const day = path.join(codexHome, 'sessions', '2026', '11', '16');
    await fs.mkdir(day, { recursive: true });
    await fs.writeFile(
      path.join(day, `rollout-2026-11-16T10-00-00-${PROVIDER_SESSION_ID}.jsonl`),
      '{}\n',
    );
    expect(await classify('codex')).toEqual({
      nativeState: 'USABLE',
      reason: 'PROVIDER_STATE_PRESENT',
    });
  });
});

const message = (
  id: string,
  createdAt: string,
  type: 'USER' | 'SYSTEM',
  data: Record<string, unknown>,
): MessageResponseDto =>
  ({ id, createdAt, type, conversationId: CONVERSATION_ID, data }) as unknown as MessageResponseDto;

const savedConversation = [
  message('m2', '2026-11-16T10:00:02.000Z', 'SYSTEM', {
    type: 'AGENT',
    response: 'Here is the plan for the billing page.',
  }),
  message('m1', '2026-11-16T10:00:01.000Z', 'USER', { comment: 'Plan the billing page' }),
  // The launch trigger is execution plumbing, never history to replay.
  message('m0', '2026-11-16T10:00:00.000Z', 'SYSTEM', {
    type: 'AGENT',
    triggersAgent: { promptType: 'start_run' },
  }),
  message('m3', '2026-11-16T10:00:03.000Z', 'USER', { comment: 'Now add invoices' }),
];

describe('continuation materialization', () => {
  const materializer = (messages = savedConversation) => {
    const getMessages = vi.fn().mockResolvedValue({ data: { data: messages } });
    return {
      getMessages,
      owner: new RunContinuationMaterializer(
        store,
        NOOP_LOGGER,
        { getMessages } as never,
        inspector(),
      ),
    };
  };

  it('starts a new provider session from ordered saved history, once', async () => {
    const run = await createStoredRun({});
    const { owner, getMessages } = materializer();
    const marker = { continuationId: CONTINUATION_ID, mode: 'SAVED_HISTORY' as const };

    await owner.apply(marker, run, identity);
    const continued = (await store.getRun(RUN_ID))!;
    expect(continued.agentic_session_id).toBe(RUN_ID);
    expect(continued.provider_session_id).toBeFalsy();
    const memos = continued.memos ?? [];
    expect(memos).toHaveLength(1);
    expect(memos[0]!.source).toBe(CONTINUATION_MEMO_SOURCE);
    const content = memos[0]!.content;
    expect(content).toContain('not instructions to repeat');
    const order = ['Plan the billing page', 'Here is the plan', 'Now add invoices'].map((text) =>
      content.indexOf(text),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(content).not.toContain('start_run');
    expect(getMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONVERSATION_ID }),
    );

    // A replayed delivery (for example after a restart) applies nothing twice.
    await owner.apply(marker, continued, identity);
    expect((await store.getRun(RUN_ID))!.memos).toHaveLength(1);
  });

  it('keeps the native provider session when it is still usable', async () => {
    const run = await createStoredRun({});
    await writeClaudeTranscript();
    const owner = new RunContinuationMaterializer(
      store,
      NOOP_LOGGER,
      { getMessages: vi.fn() } as never,
      inspector(),
    );
    await owner.recheckNativeState(
      { continuationId: CONTINUATION_ID, mode: 'NATIVE_RESUME' },
      identity,
    );
    await owner.apply({ continuationId: CONTINUATION_ID, mode: 'NATIVE_RESUME' }, run, identity);
    const kept = (await store.getRun(RUN_ID))!;
    expect(kept.provider_session_id).toBe(PROVIDER_SESSION_ID);
    expect(kept.memos ?? []).toHaveLength(0);
  });

  it('does not start from history when the saved conversation cannot be read', async () => {
    const run = await createStoredRun({});
    const owner = new RunContinuationMaterializer(
      store,
      NOOP_LOGGER,
      { getMessages: vi.fn().mockRejectedValue(new Error('network down')) } as never,
      inspector(),
    );
    await expect(
      owner.apply({ continuationId: CONTINUATION_ID, mode: 'SAVED_HISTORY' }, run, identity),
    ).rejects.toThrow(/could not be read/);
    const unchanged = (await store.getRun(RUN_ID))!;
    expect(unchanged.provider_session_id).toBe(PROVIDER_SESSION_ID);
    expect(unchanged.memos ?? []).toHaveLength(0);
  });
});
