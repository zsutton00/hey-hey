import { describe, expect, it } from 'vitest';

import {
  formatRunEventAppendLockGuidance,
  getExistingRunEventAppendLockPath,
} from './run-event-append-lock-guidance';

describe('run event append lock guidance', () => {
  it('recognizes an existing append lock directory', () => {
    const error = Object.assign(new Error('EEXIST'), {
      code: 'EEXIST',
      path: '/runs/run/member/events.data.append-lock',
      syscall: 'mkdir',
    });

    expect(getExistingRunEventAppendLockPath(error)).toBe(
      '/runs/run/member/events.data.append-lock',
    );
  });

  it('ignores unrelated existing directories', () => {
    const error = Object.assign(new Error('EEXIST'), {
      code: 'EEXIST',
      path: '/runs/run/member/other-lock',
      syscall: 'mkdir',
    });

    expect(getExistingRunEventAppendLockPath(error)).toBeNull();
  });

  it('formats actionable guidance as an ASCII box', () => {
    const rendered = formatRunEventAppendLockGuidance();
    const lines = rendered.split('\n');

    expect(lines[0]).toMatch(/^\+-+\+$/);
    expect(lines[1]).toContain('Run event append is blocked');
    expect(rendered).toContain('Another session or process may be writing');
    expect(rendered).toContain('Confirm no writer is active before removing the lock.');
    expect(lines.at(-1)).toBe(lines[0]);
    expect(new Set(lines.map((line) => line.length)).size).toBe(1);
  });
});
