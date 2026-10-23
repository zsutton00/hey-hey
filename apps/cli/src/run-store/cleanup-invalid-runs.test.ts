/** @vitest-environment node */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreateAgenticSessionInput } from '../session/types';
import { cleanupInvalidRuns } from './cleanup-invalid-runs';
import { RUN_SIDECAR_SUFFIXES, runFamilyFileNames } from './run-files';
import { RunIndexStore } from './run-index';
import { RunStore } from './run-store';
import type { RunStorePaths } from './types';

const tempDirectories: string[] = [];

const createPaths = (baseDir: string): RunStorePaths => ({
  baseDir,
  runsDir: path.join(baseDir, 'runs'),
  indexPath: path.join(baseDir, 'runs', 'run-index.json'),
  preferencesPath: path.join(baseDir, 'preferences.json'),
});

const createRunInput = (runId: string, agentSessionId: string): CreateAgenticSessionInput => ({
  entity: null,
  agentic_session_id: runId,
  services: [{ id: 'service-1', path: '/repo' }],
  launchServiceId: 'service-1',
  provider: 'codex',
  provider_session_id: `provider-${runId}`,
  provider_conversation_id: `conversation-${runId}`,
  conversationId: `platform-conversation-${runId}`,
  promptType: 'entity_conversation',
  contextMetadata: {
    capturedAt: '2026-07-20T00:00:00.000Z',
    organizationId: 'organization-1',
    projectId: 'project-1',
    agentSessionId,
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
});

const writeSidecars = async (runsDir: string, runId: string): Promise<void> => {
  await Promise.all(
    RUN_SIDECAR_SUFFIXES.map((suffix) =>
      fs.writeFile(path.join(runsDir, `${runId}${suffix}`), suffix, 'utf8'),
    ),
  );
};

const currentMetadataPath = async (runsDir: string, runId: string): Promise<string> => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(runsDir, `${runId}.family.json`), 'utf8'),
  ) as { members: { metadata: { relativePath: string } } };
  return path.join(runsDir, manifest.members.metadata.relativePath);
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('cleanupInvalidRuns', () => {
  it('preserves incompatible Run families while rebuilding the index from usable Runs', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-invalid-runs-'));
    tempDirectories.push(baseDir);
    const paths = createPaths(baseDir);
    const store = new RunStore({ paths });
    await store.initialize();

    const validRunId = '11111111-1111-4111-8111-111111111111';
    const invalidRunId = '22222222-2222-4222-8222-222222222222';
    const validAgentSessionId = '33333333-3333-4333-8333-333333333333';
    const invalidAgentSessionId = '44444444-4444-4444-8444-444444444444';
    await store.createRun(createRunInput(validRunId, validAgentSessionId));
    await store.createRun(createRunInput(invalidRunId, invalidAgentSessionId));
    await writeSidecars(paths.runsDir, validRunId);
    await writeSidecars(paths.runsDir, invalidRunId);

    const invalidMetadataPath = await currentMetadataPath(paths.runsDir, invalidRunId);
    const invalidMetadata = JSON.parse(await fs.readFile(invalidMetadataPath, 'utf8')) as Record<
      string,
      unknown
    >;
    delete invalidMetadata['entity'];
    await fs.writeFile(invalidMetadataPath, JSON.stringify(invalidMetadata), 'utf8');

    const preview = await cleanupInvalidRuns({ baseDir });

    expect(preview).toMatchObject({
      applied: false,
      scannedMetadataCount: 2,
      validRunCount: 1,
      invalidRunCount: 0,
      incompatibleRunCount: 1,
      deletedFileCount: 0,
    });
    expect(preview.invalidRuns).toEqual([]);
    await expect(fs.access(invalidMetadataPath)).resolves.toBeUndefined();

    const applied = await cleanupInvalidRuns({ baseDir, apply: true });

    expect(applied.deletedFileCount).toBe(0);
    await expect(fs.access(invalidMetadataPath)).resolves.toBeUndefined();

    const indexManager = new RunIndexStore();
    const rebuiltIndex = await indexManager.load(paths.indexPath);
    expect(indexManager.lookupByAgentSessionId(rebuiltIndex, validAgentSessionId)).toBe(validRunId);
    expect(indexManager.lookupByAgentSessionId(rebuiltIndex, invalidAgentSessionId)).toBeNull();
    expect(indexManager.lookupByCanonicalRunId(rebuiltIndex, `conversation-${validRunId}`)).toBe(
      validRunId,
    );
    expect(
      indexManager.lookupByCanonicalRunId(rebuiltIndex, `conversation-${invalidRunId}`),
    ).toBeNull();
  });

  it('preserves malformed legacy metadata and its sidecars as incompatible source data', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-malformed-runs-'));
    tempDirectories.push(baseDir);
    const paths = createPaths(baseDir);
    await fs.mkdir(paths.runsDir, { recursive: true });
    await fs.writeFile(path.join(paths.runsDir, 'malformed-run.json'), '{', 'utf8');
    await fs.writeFile(path.join(paths.runsDir, 'malformed-run.tool-usage.json'), '[]', 'utf8');

    const result = await cleanupInvalidRuns({ baseDir, apply: true });

    expect(result).toMatchObject({
      scannedMetadataCount: 1,
      validRunCount: 0,
      invalidRunCount: 0,
      incompatibleRunCount: 1,
      deletedFileCount: 0,
    });
    await expect(
      fs.access(path.join(paths.runsDir, 'malformed-run.json')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(paths.runsDir, 'malformed-run.tool-usage.json')),
    ).resolves.toBeUndefined();
  });
});
