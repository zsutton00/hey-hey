/** @vitest-environment node */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgenticSession } from '../../session/types';
import { NOOP_LOGGER } from '../../server/logger';
import { ProjectModeBundleMaterializer } from './project-mode-bundle-materializer';
import { hasCapturedProjectModeConfig } from './project-mode-snapshot';
import {
  ProjectModeBundleRestorationError,
  ProjectModeBundleRestorer,
} from './project-mode-bundle-restorer';

const temporaryDirectories: string[] = [];

const capturedConfig = {
  type: 'CODING_SESSION',
  version: 'v2',
  model: 'gpt-5',
  projectModeSelection: {
    schemaVersion: 'project-mode-selection.v1',
    modeId: '11111111-1111-4111-8111-111111111111',
  },
  projectModeSnapshot: {
    schemaVersion: 'project-mode-snapshot.v1',
    modeId: '11111111-1111-4111-8111-111111111111',
    catalogDescription: 'Captured mode',
    applicableWorkItemTypeKeys: ['STANDARD'],
    files: {
      schemaVersion: 'project-mode-files.v1',
      files: {
        'MODE.md': 'Use the original captured mode.',
        'references/checklist.md': 'Verify the original checklist.',
      },
    },
    snapshotHash: 'a'.repeat(64),
  },
};

const sessionWithConfig = (config: object = capturedConfig): AgenticSession =>
  ({
    agentic_session_id: 'restored-run',
    config,
  }) as AgenticSession;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('hasCapturedProjectModeConfig', () => {
  it('recognizes coding-session configs carrying a mode selection or snapshot', () => {
    expect(hasCapturedProjectModeConfig(capturedConfig as never)).toBe(true);
    const { projectModeSnapshot: _snapshot, ...selectionOnly } = capturedConfig;
    expect(hasCapturedProjectModeConfig(selectionOnly as never)).toBe(true);
    const { projectModeSelection: _selection, ...plain } = selectionOnly;
    expect(hasCapturedProjectModeConfig(plain as never)).toBe(false);
    expect(hasCapturedProjectModeConfig(null)).toBe(false);
    expect(hasCapturedProjectModeConfig(undefined)).toBe(false);
  });
});

describe('ProjectModeBundleRestorer', () => {
  it('reuses a valid bundle and rematerializes the captured files when it disappears', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-mode-restorer-'));
    temporaryDirectories.push(root);
    const materializer = new ProjectModeBundleMaterializer({
      runtimeRoot: path.join(root, 'bundles'),
    });
    const restorer = new ProjectModeBundleRestorer(materializer, NOOP_LOGGER);
    const session = sessionWithConfig();

    await restorer.restore(session);
    const bundleDirectory = await materializer.materialize(
      session.agentic_session_id,
      capturedConfig.projectModeSnapshot as never,
    );
    const originalModeStat = await fs.stat(path.join(bundleDirectory, 'MODE.md'));

    await restorer.restore(session);
    expect((await fs.stat(path.join(bundleDirectory, 'MODE.md'))).ino).toBe(originalModeStat.ino);

    await fs.writeFile(path.join(bundleDirectory, 'MODE.md'), 'Tampered contents.');
    await restorer.restore(session);
    await expect(fs.readFile(path.join(bundleDirectory, 'MODE.md'), 'utf8')).resolves.toBe(
      'Use the original captured mode.',
    );

    await fs.rm(bundleDirectory, { recursive: true });
    await restorer.restore(
      sessionWithConfig({
        ...capturedConfig,
        canonicalModeContents: 'A later canonical MODE edit must be ignored.',
      }),
    );

    await expect(fs.readFile(path.join(bundleDirectory, 'MODE.md'), 'utf8')).resolves.toBe(
      'Use the original captured mode.',
    );
    await expect(
      fs.readFile(path.join(bundleDirectory, 'references/checklist.md'), 'utf8'),
    ).resolves.toBe('Verify the original checklist.');
  });

  it('rejects an invalid captured snapshot before materialization', async () => {
    const materializer = new ProjectModeBundleMaterializer();
    const materialize = vi.spyOn(materializer, 'materialize');
    const restorer = new ProjectModeBundleRestorer(materializer, NOOP_LOGGER);

    await expect(
      restorer.restore(
        sessionWithConfig({
          ...capturedConfig,
          projectModeSnapshot: {
            ...capturedConfig.projectModeSnapshot,
            files: { schemaVersion: 'project-mode-files.v1', files: {} },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ProjectModeBundleRestorationError);
    expect(materialize).not.toHaveBeenCalled();
  });
});
