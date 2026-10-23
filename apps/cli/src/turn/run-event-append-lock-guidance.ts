import path from 'node:path';

import { renderAsciiLogBox } from '../shared/logging/ascii-log-box';

export const getExistingRunEventAppendLockPath = (error: Error): string | null => {
  if (!('code' in error) || error.code !== 'EEXIST') return null;
  if (!('syscall' in error) || error.syscall !== 'mkdir') return null;
  if (!('path' in error) || typeof error.path !== 'string') return null;
  return path.basename(error.path) === 'events.data.append-lock' ? error.path : null;
};

export const formatRunEventAppendLockGuidance = (): string =>
  renderAsciiLogBox('Run event append is blocked', [
    'Another session or process may be writing to this event stream.',
    'Wait for active writers to finish before retrying the turn.',
    'If every writer has stopped, the lock may be stale.',
    'Confirm no writer is active before removing the lock.',
  ]);
