import { describe, expect, it } from 'vitest';
import { parseDeleteInvalidRunsArguments } from './delete-invalid-runs-args';

describe('parseDeleteInvalidRunsArguments', () => {
  it('accepts the package-script separator before apply flags', () => {
    expect(parseDeleteInvalidRunsArguments(['--', '--apply', '--verbose'])).toEqual({
      apply: true,
      verbose: true,
    });
  });

  it('rejects unsupported arguments after removing separators', () => {
    expect(() => parseDeleteInvalidRunsArguments(['--', '--delete-everything'])).toThrow(
      'Unsupported argument(s): --delete-everything',
    );
  });
});
