import { createHash } from 'node:crypto';
import path from 'node:path';

const platformScope = (apiBaseUrl: string): string =>
  createHash('sha256').update(apiBaseUrl).digest('hex');

/** Keeps platform-owned machine effects from crossing server boundaries. */
export const resolveMachineStateStorePath = (
  dataDir: string,
  apiBaseUrl: string,
  fileName = 'snapshots.json',
): string => path.join(dataDir, 'state-machines', platformScope(apiBaseUrl), fileName);
