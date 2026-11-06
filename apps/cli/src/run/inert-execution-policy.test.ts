import { describe, expect, it } from 'vitest';
import { filterInertBuiltinTools } from './inert-execution-policy';

const REQUESTED = ['Read', 'Glob', 'Grep', 'ToolSearch', 'Bash', 'Edit', 'Write', 'WebFetch'];

describe('filterInertBuiltinTools', () => {
  it('gives an unbound inert Run read-only tools and no shell', () => {
    expect(filterInertBuiltinTools(REQUESTED).sort()).toEqual(
      ['Glob', 'Grep', 'Read', 'ToolSearch'].sort(),
    );
  });

  it('gives a workspace-bound inert Run a shell and file edits, and nothing else beyond reading', () => {
    expect(filterInertBuiltinTools(REQUESTED, { workspaceBound: true }).sort()).toEqual(
      [
        'Bash',
        'Edit',
        'Glob',
        'Grep',
        'MultiEdit',
        'NotebookEdit',
        'Read',
        'ToolSearch',
        'Write',
      ].sort(),
    );
  });
});
