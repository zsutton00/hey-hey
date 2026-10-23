import { describe, expect, it } from 'vitest';

import { renderAsciiLogBox } from './ascii-log-box';

describe('renderAsciiLogBox', () => {
  it('frames a title and diagnostic lines with an ASCII border', () => {
    const rendered = renderAsciiLogBox('Append blocked', ['Wait for the active writer.']);
    const lines = rendered.split('\n');

    expect(lines[0]).toMatch(/^\+-+\+$/);
    expect(lines[1]).toContain('Append blocked');
    expect(lines[2]).toContain('Wait for the active writer.');
    expect(lines[3]).toBe(lines[0]);
    expect(new Set(lines.map((line) => line.length)).size).toBe(1);
  });
});
