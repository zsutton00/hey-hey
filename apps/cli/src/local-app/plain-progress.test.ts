import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalState } from './local-application';
import { startPlainProgress } from './plain-progress';

afterEach(() => vi.useRealTimers());

describe('plain progress output', () => {
  it('prints on every interval even when a transfer is stalled at the same byte count', () => {
    vi.useFakeTimers();
    let elapsedMs = 0;
    const state = (): LocalState => ({
      kind: 'progress',
      steps: [],
      current: 'Downloading matching application images',
      elapsedMs,
      detail: {
        kind: 'images',
        bytesDone: 5_000_000,
        bytesTotal: 10_000_000,
        percent: 50,
        layersDone: 1,
        layersTotal: 2,
      },
    });
    const lines: string[] = [];
    const stop = startPlainProgress(state, (line) => lines.push(line), 5000);

    for (let interval = 1; interval <= 3; interval++) {
      elapsedMs = interval * 5000;
      vi.advanceTimersByTime(5000);
    }
    stop();
    vi.advanceTimersByTime(10_000);

    expect(lines).toHaveLength(3);
    expect(new Set(lines).size).toBe(3);
  });
});
