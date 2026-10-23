import { describe, expect, it } from 'vitest';

import {
  serializeProjectModeLaunchResumeOutcome,
  type ProjectModeLaunchResumeOutcome,
} from './probe-project-mode-launch-resume';

describe('project MODE probe output bound', () => {
  it('rejects JSON larger than the configured output limit', () => {
    const outcome = {
      summary: { provider: 'codex', padding: 'x'.repeat(512) },
    } as unknown as ProjectModeLaunchResumeOutcome;
    expect(() => serializeProjectModeLaunchResumeOutcome(outcome, 256)).toThrow(
      'exceeds --max-output-bytes',
    );
  });
});
