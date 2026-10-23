import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateRunStore } from '../migrate-run-families';
import { RunStore } from '../run-store';
import { legacyRunFamilyMemberFileName, type RunFamilyMember } from '../run-files';
import type { RunStorePaths } from '../types';
import type { CreateAgenticSessionInput } from '../../session/types';

const createPaths = (root: string): RunStorePaths => ({
  baseDir: root,
  runsDir: path.join(root, 'runs'),
  indexPath: path.join(root, 'runs', 'run-index.json'),
  preferencesPath: path.join(root, 'preferences.json'),
});

const createInput = (runId: string): CreateAgenticSessionInput => ({
  agentic_session_id: runId,
  entity: null,
  services: [{ id: 'svc-1', path: '/tmp/repo' }],
  launchServiceId: 'svc-1',
  provider: 'claude',
  provider_session_id: `provider-${runId}`,
  provider_conversation_id: null,
  conversationId: `conversation-${runId}`,
  contextMetadata: {
    capturedAt: '2026-01-01T00:00:00.000Z',
    organizationId: 'org-1',
    projectId: 'project-1',
    task: {
      id: 'task-1',
      name: 'Test task',
      type: 'STANDARD',
      organizationId: 'org-1',
      projectId: 'project-1',
      initiativeId: 'initiative-1',
      status: 'ACTIVE',
      source: 'user',
    },
    agentSessionId: `agent-${runId}`,
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
});

const demoteCurrentFamilyToLegacy = async (root: string, runId: string): Promise<void> => {
  const runsDir = path.join(root, 'runs');
  const manifestPath = path.join(runsDir, `${runId}.family.json`);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
    members: Record<RunFamilyMember, { relativePath: string }>;
  };
  for (const [member, descriptor] of Object.entries(manifest.members) as Array<
    [RunFamilyMember, { relativePath: string }]
  >) {
    try {
      await fs.copyFile(
        path.join(runsDir, descriptor.relativePath),
        path.join(runsDir, legacyRunFamilyMemberFileName(runId, member)),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await fs.rm(manifestPath);
};

const writeLegacySession = async (root: string, runId: string): Promise<void> => {
  const sessionDir = path.join(root, 'sessions', 'legacy-cli');
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, 'session.json'),
    JSON.stringify({
      agenticSessions: [
        {
          ...createInput(runId),
          serviceId: 'svc-1',
          services: undefined,
          launchServiceId: undefined,
          events: [],
        },
      ],
    }),
    'utf8',
  );
};

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-run-families-test-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('migrateRunStore', () => {
  it('previews and then promotes every legacy Run family, preserving source files', async () => {
    const paths = createPaths(tempRoot);
    const store = new RunStore({ paths });
    await store.initialize();
    const run = await store.createRun(createInput('legacy-run'));
    await demoteCurrentFamilyToLegacy(tempRoot, run.agentic_session_id);
    const sourceMetadataPath = path.join(
      paths.runsDir,
      legacyRunFamilyMemberFileName(run.agentic_session_id, 'metadata'),
    );
    const sourceMetadata = await fs.readFile(sourceMetadataPath);

    const preview = await migrateRunStore({ baseDir: tempRoot });

    expect(preview.scannedRunCount).toBe(1);
    expect(preview.migratedRunCount).toBe(1);
    expect(preview.incompatibleRunCount).toBe(0);
    await expect(
      fs.access(path.join(paths.runsDir, `${run.agentic_session_id}.family.json`)),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.readFile(sourceMetadataPath)).resolves.toEqual(sourceMetadata);

    const applied = await migrateRunStore({ baseDir: tempRoot, apply: true });

    expect(applied.migratedRunCount).toBe(1);
    expect(applied.currentRunCount).toBe(0);
    await expect(
      fs.access(path.join(paths.runsDir, `${run.agentic_session_id}.family.json`)),
    ).resolves.toBeUndefined();
    await expect(fs.readFile(sourceMetadataPath)).resolves.toEqual(sourceMetadata);

    const rerun = await migrateRunStore({ baseDir: tempRoot, apply: true });
    expect(rerun.migratedRunCount).toBe(0);
    expect(rerun.currentRunCount).toBe(1);
  });

  it('continues past an incompatible family and preserves its source', async () => {
    const paths = createPaths(tempRoot);
    const store = new RunStore({ paths });
    await store.initialize();
    const compatible = await store.createRun(createInput('compatible-run'));
    const incompatible = await store.createRun(createInput('incompatible-run'));
    await demoteCurrentFamilyToLegacy(tempRoot, compatible.agentic_session_id);
    await demoteCurrentFamilyToLegacy(tempRoot, incompatible.agentic_session_id);

    const invalidSidecarPath = path.join(
      paths.runsDir,
      legacyRunFamilyMemberFileName(incompatible.agentic_session_id, 'toolUsage'),
    );
    const invalidSidecar = Buffer.from('{"invalid":true}');
    await fs.writeFile(invalidSidecarPath, invalidSidecar);

    const result = await migrateRunStore({ baseDir: tempRoot, apply: true });

    expect(result.migratedRunCount).toBe(1);
    expect(result.incompatibleRunCount).toBe(1);
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: compatible.agentic_session_id, status: 'migrated' }),
        expect.objectContaining({ runId: incompatible.agentic_session_id, status: 'incompatible' }),
      ]),
    );
    await expect(
      fs.access(path.join(paths.runsDir, `${compatible.agentic_session_id}.family.json`)),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(paths.runsDir, `${incompatible.agentic_session_id}.family.json`)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(invalidSidecarPath)).resolves.toEqual(invalidSidecar);
  });

  it('compacts oversized legacy tool output without making the output authoritative', async () => {
    const paths = createPaths(tempRoot);
    const store = new RunStore({ paths });
    await store.initialize();
    const run = await store.createRun(createInput('oversized-tool-output-run'));
    await demoteCurrentFamilyToLegacy(tempRoot, run.agentic_session_id);

    const legacyEventsPath = path.join(
      paths.runsDir,
      legacyRunFamilyMemberFileName(run.agentic_session_id, 'events'),
    );
    const oversizedContent = 'x'.repeat(128 * 1024 + 1);
    await fs.writeFile(
      legacyEventsPath,
      JSON.stringify({
        seq: 1,
        ts: '2026-09-03T00:00:00.000Z',
        app_session_id: run.agentic_session_id,
        run_id: run.agentic_session_id,
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
        payload: {
          messageType: 'provider_event',
          provider: 'claude',
          eventType: 'user',
          session_id: run.provider_session_id,
          agent_id: 'claude',
          raw_event: {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'toolu-large-output',
                  is_error: false,
                  content: oversizedContent,
                },
              ],
            },
          },
        },
      }) + '\n',
      'utf8',
    );

    const result = await migrateRunStore({ baseDir: tempRoot, apply: true });

    expect(result.migratedRunCount).toBe(1);
    const manifest = JSON.parse(
      await fs.readFile(path.join(paths.runsDir, `${run.agentic_session_id}.family.json`), 'utf8'),
    ) as { members: Record<RunFamilyMember, { relativePath: string }> };
    const events = JSON.parse(
      await fs.readFile(path.join(paths.runsDir, manifest.members.events.relativePath), 'utf8'),
    ) as {
      payload: {
        kind: string;
        results: Array<{ toolUseId: string; isError: boolean; content: string | null }>;
        raw_event?: unknown;
      };
    };
    expect(events.payload).toMatchObject({
      kind: 'tool_result',
      results: [
        {
          toolUseId: 'toolu-large-output',
          isError: false,
          content: null,
        },
      ],
    });
    expect(events.payload.raw_event).toBeUndefined();
  });

  it('previews and imports legacy sessions without writing during dry-run', async () => {
    const paths = createPaths(tempRoot);
    await writeLegacySession(tempRoot, 'legacy-session-run');

    const preview = await migrateRunStore({ baseDir: tempRoot });

    expect(preview.legacySessionsDetected).toBe(true);
    expect(preview.legacyMigration).toMatchObject({ migratedRunCount: 1 });
    expect(preview.scannedRunCount).toBe(0);
    await expect(
      fs.access(path.join(paths.runsDir, 'legacy-session-run.json')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const applied = await migrateRunStore({ baseDir: tempRoot, apply: true });

    expect(applied.legacyMigration).toMatchObject({ migratedRunCount: 1 });
    expect(applied.migratedRunCount).toBe(1);
    await expect(
      fs.access(path.join(paths.runsDir, 'legacy-session-run.family.json')),
    ).resolves.toBeUndefined();
  });
});
