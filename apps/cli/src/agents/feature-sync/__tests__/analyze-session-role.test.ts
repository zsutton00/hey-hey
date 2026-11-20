import { SessionRole } from '@hey-hey/contracts/agent-bridge';
import { describe, expect, it } from 'vitest';

import { featureSyncAnalyzeHandler } from '../analyze.handler';

describe('Feature Sync analyze session role', () => {
  it('receives sync-role guidance, not research or planning', () => {
    expect(featureSyncAnalyzeHandler.sessionRole).toBe(SessionRole.Sync);
  });
});
