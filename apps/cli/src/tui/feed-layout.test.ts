import { describe, expect, it, vi } from 'vitest';
import { layoutFeed, maxFeedOffset } from './feed-layout';
import { formatDuration, row, rowText, sanitize, wrapText } from './text';
import { conversationWebHandoff } from './web-handoff';

const items = Array.from({ length: 10 }, (_, index) => index);
const twoRows = (item: number) => [row(`${String(item)}a`), row(`${String(item)}b`)];

describe('layoutFeed', () => {
  it('shows the newest rows when following live', () => {
    const window = layoutFeed(items, twoRows, 3, 0);
    expect(window.rows.map(rowText)).toEqual(['8b', '9a', '9b']);
    expect(window.moreAbove).toBe(true);
    expect(window.moreBelow).toBe(false);
  });

  it('wraps only the items the window needs', () => {
    const toRows = vi.fn(twoRows);
    layoutFeed(items, toRows, 4, 0);
    expect(toRows).toHaveBeenCalledTimes(2);
  });

  it('applies an offset and clamps it to the content', () => {
    expect(layoutFeed(items, twoRows, 2, 2).rows.map(rowText)).toEqual(['8a', '8b']);
    const clamped = layoutFeed(items, twoRows, 4, 1_000);
    expect(clamped.offset).toBe(16);
    expect(clamped.rows.map(rowText)).toEqual(['0a', '0b', '1a', '1b']);
    expect(clamped.moreAbove).toBe(false);
    expect(maxFeedOffset(items, twoRows, 4)).toBe(16);
  });
});

describe('text helpers', () => {
  it('strips escape sequences and control characters from untrusted output', () => {
    expect(sanitize('\u001B[31mred\u001B[0m\r\nnext\tcol\u0007')).toBe('red\nnext  col');
  });

  it('wraps by columns and keeps empty lines', () => {
    expect(wrapText('abcdef\n\nxy', 4)).toEqual(['abcd', 'ef', '', 'xy']);
  });

  it('formats durations', () => {
    expect(formatDuration(4_200)).toBe('4s');
    expect(formatDuration(134_000)).toBe('2m 14s');
    expect(formatDuration(3_720_000)).toBe('1h 2m');
  });
});

describe('conversationWebHandoff', () => {
  it('uses the configured origin and the canonical conversation identity', () => {
    expect(
      conversationWebHandoff('http://localhost:5173', {
        projectId: 'project 1',
        conversationId: 'conversation-1',
      }),
    ).toEqual({
      available: true,
      url: 'http://localhost:5173/projects/project%201/resolve-agent-session/conversation-1',
    });
  });

  it('is unavailable without the route data', () => {
    expect(
      conversationWebHandoff('https://heyhey.dev', { projectId: 'project-1', conversationId: '' }),
    ).toEqual({ available: false, reason: 'This session has no web conversation yet.' });
  });
});
