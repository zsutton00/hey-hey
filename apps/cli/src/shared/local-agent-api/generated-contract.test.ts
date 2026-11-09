import { describe, expect, it } from 'vitest';
import { LocalRepositoryBindingErrorCode } from '@hey-hey/contracts/local/models';
import { RepositoryBindingsApiAxiosParamCreator } from '@hey-hey/contracts/local';

describe('browser-local generated contract', () => {
  it('builds repository-binding requests and preserves the closed typed failures', async () => {
    const request = await RepositoryBindingsApiAxiosParamCreator().listLocalRepoBindings();
    expect(request.url).toBe('/repos');
    expect(request.options.method).toBe('GET');
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
