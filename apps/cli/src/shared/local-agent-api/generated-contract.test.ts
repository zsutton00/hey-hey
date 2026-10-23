import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalRepositoryBindingErrorCode } from './generated/api';

describe('browser-local generated contract', () => {
  it('contains only repository-binding operations and the closed typed failures', async () => {
    const generatedSource = await fs.readFile(path.join(__dirname, 'generated', 'api.ts'), 'utf8');

    expect(generatedSource).toContain('listLocalRepoBindings');
    expect(generatedSource).toContain('pickLocalRepoDirectory');
    expect(generatedSource).toContain('setLocalRepoBinding');
    expect(generatedSource).not.toMatch(
      /createRun|HealthApi|AuthApi|FilesApi|DebugApi|WorktreesApi|WebSocket/u,
    );
    expect(Object.values(LocalRepositoryBindingErrorCode)).toEqual([
      'ORIGIN_NOT_ALLOWED',
      'MACHINE_ID_UNAVAILABLE',
      'MACHINE_ID_REQUIRED',
      'MACHINE_MISMATCH',
      'INVALID_SERVICE_ID',
      'INVALID_REPOSITORY_PATH',
      'REPOSITORY_PATH_NOT_FOUND',
      'REPOSITORY_PATH_NOT_DIRECTORY',
      'REPOSITORY_PATH_NOT_READABLE',
      'BINDING_READ_FAILED',
      'BINDING_WRITE_FAILED',
      'DIRECTORY_PICKER_UNAVAILABLE',
      'DIRECTORY_PICKER_FAILED',
    ]);
  });
});
