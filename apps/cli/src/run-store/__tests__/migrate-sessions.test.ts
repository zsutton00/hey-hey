import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasLegacySessions, migrateSessionsToRuns } from '../migrate-sessions';
import { RunStore } from '../run-store';
import type { RunStorePaths } from '../types';
import { normalizeProviderEventPayload } from '../../agents/providers/provider-event-normalization';

const createPaths = (root: string): RunStorePaths => ({
  baseDir: root,
  runsDir: path.join(root, 'runs'),
  indexPath: path.join(root, 'runs', 'run-index.json'),
  preferencesPath: path.join(root, 'preferences.json'),
});

const writeSessionJson = async (
  sessionsDir: string,
  cliSessionId: string,
  agenticSessions: Record<string, unknown>[],
): Promise<void> => {
  const sessionDir = path.join(sessionsDir, cliSessionId);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, 'session.json'),
    JSON.stringify({
      state_version: 1,
      cliSessionId,
      workspaceRoot: '/tmp',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      navigationState: {
        route: { view: 'projects' },
        breadcrumbTrail: [],
        taskViewState: { selectedActionIndex: 0, expandedSectionKeys: [] },
        taskSessionServicePreferences: [],
        taskSessionProviderPreference: null,
      },
      agenticSessions: agenticSessions,
    }),
    'utf8',
  );
};

const writeEventJsonl = async (
  sessionsDir: string,
  cliSessionId: string,
  agenticSessionId: string,
  events: Record<string, unknown>[],
): Promise<void> => {
  const eventsDir = path.join(sessionsDir, cliSessionId, 'events');
  await fs.mkdir(eventsDir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await fs.writeFile(path.join(eventsDir, `${agenticSessionId}.jsonl`), lines, 'utf8');
};

const createAgenticSession = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  agentic_session_id: 'run-1',
  entity: null,
  serviceId: 'svc-1',
  provider: 'claude',
  provider_session_id: 'prov-1',
  provider_conversation_id: null,
  status: 'idle',
  conversationId: 'conv-1',
  origin: { entityType: 'TASK', entityId: 'task-1' },
  contextMetadata: {
    capturedAt: '2026-01-01T00:00:00.000Z',
    organizationId: 'org-1',
    projectId: 'proj-1',
    task: {
      id: 'task-1',
      projectId: 'proj-1',
      name: 'Test',
      title: 'Test',
      description: '',
    },
    agentSessionId: 'coding-1',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  events: [],
  ...overrides,
});

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-test-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('hasLegacySessions', () => {
  it('returns false when no sessions dir exists', async () => {
    expect(await hasLegacySessions(tempRoot)).toBe(false);
  });

  it('returns true when session.json exists', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    await writeSessionJson(sessionsDir, 'cli-1', []);
    expect(await hasLegacySessions(tempRoot)).toBe(true);
  });

  it('returns false when sessions dir exists but has no session.json files', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    await fs.mkdir(path.join(sessionsDir, 'empty-dir'), { recursive: true });
    expect(await hasLegacySessions(tempRoot)).toBe(false);
  });
});

describe('migrateSessionsToRuns', () => {
  it('does not manufacture entity scope for a legacy record that omits it', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);
    const legacyRecord = createAgenticSession();
    delete legacyRecord['entity'];

    await writeSessionJson(sessionsDir, 'cli-1', [legacyRecord]);

    const result = await migrateSessionsToRuns(sessionsDir, paths);

    expect(result.migratedRunCount).toBe(0);
    await expect(fs.access(path.join(paths.runsDir, 'run-1.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('migrates a single session with one run', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);

    await writeSessionJson(sessionsDir, 'cli-1', [createAgenticSession()]);

    const result = await migrateSessionsToRuns(sessionsDir, paths);

    expect(result.migratedRunCount).toBe(1);
    expect(result.skippedCorruptedSessions).toEqual([]);

    const runMetadata = await fs.readFile(path.join(paths.runsDir, 'run-1.json'), 'utf8');
    const parsed = JSON.parse(runMetadata);
    expect(parsed.agentic_session_id).toBe('run-1');
    expect(parsed.events).toBeUndefined();
  });

  it('migrates JSONL event files', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);

    await writeSessionJson(sessionsDir, 'cli-1', [createAgenticSession()]);
    await writeEventJsonl(sessionsDir, 'cli-1', 'run-1', [
      {
        seq: 1,
        ts: '2026-01-01T00:00:00.000Z',
        app_session_id: 'cli-1',
        run_id: 'run-1',
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
      },
    ]);

    const result = await migrateSessionsToRuns(sessionsDir, paths);

    expect(result.migratedEventFileCount).toBe(1);
    const eventText = await fs.readFile(path.join(paths.runsDir, 'run-1.events.jsonl'), 'utf8');
    const events = eventText
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('run_started');
  });

  it('migrates inline events when no JSONL exists', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);

    const inlineEvent = {
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
      app_session_id: 'cli-1',
      run_id: 'run-1',
      actor: 'app',
      event_type: 'run_started',
      state_version: 1,
    };

    await writeSessionJson(sessionsDir, 'cli-1', [createAgenticSession({ events: [inlineEvent] })]);

    const result = await migrateSessionsToRuns(sessionsDir, paths);

    expect(result.migratedEventFileCount).toBe(1);
    const eventText = await fs.readFile(path.join(paths.runsDir, 'run-1.events.jsonl'), 'utf8');
    const events = eventText
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
  });

  it('compacts legacy provider envelopes before making the new generation authoritative', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-1',
      eventType: 'assistant',
      timestamp: '2026-01-01T00:00:01.000Z',
      sessionId: 'provider-1',
      agentId: 'claude',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Write',
              input: { file_path: 'src/example.ts', content: 'export const value = 1;' },
            },
          ],
        },
      },
    });

    await writeSessionJson(sessionsDir, 'cli-1', [createAgenticSession()]);
    await writeEventJsonl(sessionsDir, 'cli-1', 'run-1', [
      {
        seq: 1,
        ts: '2026-01-01T00:00:00.000Z',
        app_session_id: 'cli-1',
        run_id: 'run-1',
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
        payload: {
          mode: 'prompt',
          prompt: 'Write the example',
          adapterId: 'claude',
          repositoryPath: '/tmp',
        },
      },
      {
        seq: 2,
        ts: '2026-01-01T00:00:01.000Z',
        app_session_id: 'cli-1',
        run_id: 'claude-provider-run-1',
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
        payload: normalized.payload,
      },
    ]);

    await migrateSessionsToRuns(sessionsDir, paths);
    const store = new RunStore({ paths });
    await store.initialize();
    const run = await store.getRunWithEvents('run-1');

    expect(
      run?.events.some(
        (event) =>
          event.payload !== undefined &&
          'messageType' in event.payload &&
          event.payload.messageType === 'canonical_event',
      ),
    ).toBe(true);
    const familyRoot = path.join(paths.runsDir, '.run-families', 'run-1');
    const generations = await fs.readdir(familyRoot);
    expect(generations).toHaveLength(1);
    const eventsPath = path.join(familyRoot, generations[0]!, 'events.data');
    const compactedText = await fs.readFile(eventsPath, 'utf8');
    expect(compactedText).not.toContain('raw_event');
    expect(compactedText).not.toContain('provider_metadata');
    expect(compactedText).not.toContain('all_tool_use_blocks');
    expect(compactedText).toContain('"provider":"claude"');
  });

  it('preserves legacy bytes when authoritative provider facts cannot be projected', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);

    await writeSessionJson(sessionsDir, 'cli-1', [createAgenticSession()]);
    await writeEventJsonl(sessionsDir, 'cli-1', 'run-1', [
      {
        seq: 1,
        ts: '2026-01-01T00:00:00.000Z',
        app_session_id: 'cli-1',
        run_id: 'run-1',
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
        payload: {
          messageType: 'provider_event',
          provider: 'claude',
          canonical_event_type: 'permission_request',
          permission_request: {
            id: 'permission-1',
            permission_type: 'workspace_write',
          },
        },
      },
    ]);

    await migrateSessionsToRuns(sessionsDir, paths);
    const sourcePath = path.join(paths.runsDir, 'run-1.events.jsonl');
    const sourceBytes = await fs.readFile(sourcePath);
    const store = new RunStore({ paths });
    await store.initialize();

    await expect(store.getRunWithEvents('run-1')).rejects.toMatchObject({
      diagnostic: { reason: 'migration_failed' },
    });
    await expect(fs.readFile(sourcePath)).resolves.toEqual(sourceBytes);
    await expect(fs.access(path.join(paths.runsDir, 'run-1.family.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('migrates multiple sessions with multiple runs', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);

    await writeSessionJson(sessionsDir, 'cli-1', [
      createAgenticSession({ agentic_session_id: 'run-1', provider_session_id: 'prov-1' }),
      createAgenticSession({
        agentic_session_id: 'run-2',
        provider_session_id: 'prov-2',
        contextMetadata: {
          capturedAt: '2026-01-01T00:00:00.000Z',
          task: { id: 'task-2', projectId: 'proj-1', title: 'Test 2', description: '' },
          agentSessionId: 'coding-2',
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
      }),
    ]);
    await writeSessionJson(sessionsDir, 'cli-2', [
      createAgenticSession({
        agentic_session_id: 'run-3',
        provider_session_id: 'prov-3',
        contextMetadata: {
          capturedAt: '2026-01-01T00:00:00.000Z',
          task: { id: 'task-3', projectId: 'proj-1', title: 'Test 3', description: '' },
          agentSessionId: 'coding-3',
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
      }),
    ]);

    const result = await migrateSessionsToRuns(sessionsDir, paths);
    expect(result.migratedRunCount).toBe(3);
  });

  it('builds index with agentSessionId mappings', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);

    await writeSessionJson(sessionsDir, 'cli-1', [createAgenticSession()]);
    await migrateSessionsToRuns(sessionsDir, paths);

    const indexText = await fs.readFile(paths.indexPath, 'utf8');
    const index = JSON.parse(indexText);
    expect(index.byAgentSessionId['coding-1']).toBe('run-1');
    expect(index.byProviderSessionId['prov-1']).toBe('run-1');
  });

  it('skips corrupted session files', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);

    const corruptedDir = path.join(sessionsDir, 'corrupted-cli');
    await fs.mkdir(corruptedDir, { recursive: true });
    await fs.writeFile(path.join(corruptedDir, 'session.json'), 'not json', 'utf8');

    await writeSessionJson(sessionsDir, 'good-cli', [createAgenticSession()]);

    const result = await migrateSessionsToRuns(sessionsDir, paths);
    expect(result.migratedRunCount).toBe(1);
    expect(result.skippedCorruptedSessions).toContain('corrupted-cli');
  });

  it('skips runs that already exist in target', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);

    await fs.mkdir(paths.runsDir, { recursive: true });
    await fs.writeFile(
      path.join(paths.runsDir, 'run-1.json'),
      JSON.stringify({ agentic_session_id: 'run-1' }),
      'utf8',
    );

    await writeSessionJson(sessionsDir, 'cli-1', [createAgenticSession()]);
    const result = await migrateSessionsToRuns(sessionsDir, paths);
    expect(result.migratedRunCount).toBe(0);
  });

  it('returns zero counts when sessions dir does not exist', async () => {
    const paths = createPaths(tempRoot);
    const result = await migrateSessionsToRuns(path.join(tempRoot, 'nonexistent'), paths);
    expect(result.migratedRunCount).toBe(0);
    expect(result.migratedEventFileCount).toBe(0);
  });
});

describe('RunStore integration with migration', () => {
  it('automatically migrates on first initialize when legacy sessions exist', async () => {
    const sessionsDir = path.join(tempRoot, 'sessions');
    const paths = createPaths(tempRoot);

    await writeSessionJson(sessionsDir, 'cli-1', [createAgenticSession()]);
    await writeEventJsonl(sessionsDir, 'cli-1', 'run-1', [
      {
        seq: 1,
        ts: '2026-01-01T00:00:00.000Z',
        app_session_id: 'cli-1',
        run_id: 'run-1',
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
      },
    ]);

    const store = new RunStore({ paths });
    const initResult = await store.initialize();

    expect(initResult.migrated).toBe(true);

    const run = await store.getRun('run-1');
    expect(run).not.toBeNull();
    expect(run!.agentic_session_id).toBe('run-1');
    expect(run!.events).toEqual([]);

    const runWithEvents = await store.getRunWithEvents('run-1');
    expect(runWithEvents!.events).toHaveLength(1);
  });
});
