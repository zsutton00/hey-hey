import { describe, expect, it } from 'vitest';
import { completionResponseSchema } from '../schemas';

const legacyCheck = {
  feature: { entityType: 'FEATURE', entityId: '3782302e-54ad-4908-b168-0b2260a89b3c' },
  explanation: 'Behavior changed',
};

describe('completion response schema', () => {
  it.each([
    ['omitted', {}],
    ['null', { featureUpdateSyncCheck: null }],
    ['malformed', { featureUpdateSyncCheck: {} }],
    ['populated', { featureUpdateSyncCheck: legacyCheck }],
  ])('keeps only the response when legacy feature metadata is %s', (_label, extra) => {
    expect(completionResponseSchema.parse({ response: 'Done', ...extra })).toEqual({
      response: 'Done',
    });
  });
  it('rejects blank replies', () => {
    expect(completionResponseSchema.safeParse({ response: ' ' }).success).toBe(false);
  });
  it('ignores legacy completion-time file claims', () => {
    expect(
      completionResponseSchema.parse({
        response: 'Done',
        changedFiles: [{ serviceId: 'service', path: 'a.ts' }, null],
      }),
    ).toEqual({ response: 'Done' });
  });
});
