import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveMachineStateStorePath } from './machine-state-store-path';

describe('resolveMachineStateStorePath', () => {
  it('isolates machine snapshots by platform endpoint', () => {
    const dataDir = path.join('home', 'heyhey');
    const localPath = resolveMachineStateStorePath(dataDir, 'http://localhost:3000/api/v1');
    const stagingPath = resolveMachineStateStorePath(dataDir, 'https://staging.heyhey.dev/api/v1');

    expect(localPath).not.toBe(stagingPath);
    expect(localPath).not.toBe(path.join(dataDir, 'state-machines', 'snapshots.json'));
    expect(localPath).toMatch(/state-machines\/[a-f0-9]{64}\/snapshots\.json$/u);
  });

  it('returns the same path for the same normalized endpoint', () => {
    expect(resolveMachineStateStorePath('/data', 'https://heyhey.dev/api/v1')).toBe(
      resolveMachineStateStorePath('/data', 'https://heyhey.dev/api/v1'),
    );
  });
});
