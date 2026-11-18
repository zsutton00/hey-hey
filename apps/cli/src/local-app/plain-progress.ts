import type { LocalState } from './local-application';
import { progressLabel } from './LocalScreen';

/**
 * Without a terminal there is no in-place redraw, so print the current status on a fixed
 * interval. Every interval prints, even when nothing changed, so a stalled transfer is
 * visibly still being waited on. Returns a function that stops the printing.
 */
export function startPlainProgress(
  read: () => LocalState,
  write: (line: string) => void,
  intervalMs = 5000,
): () => void {
  const timer = setInterval(() => {
    const state = read();
    if (state.kind !== 'progress') {
      return;
    }
    const seconds = Math.floor((state.elapsedMs ?? 0) / 1000);
    const line = progressLabel(state.current, state.detail, state.elapsedMs);
    write(
      state.detail?.percent === null || state.detail === undefined
        ? line
        : `${line} · ${seconds}s elapsed`,
    );
  }, intervalMs);
  return () => clearInterval(timer);
}
