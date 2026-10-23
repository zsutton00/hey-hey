import { describe, expect, it } from 'vitest';
import { NOOP_LOGGER } from '../server/logger';
import type { AssistantCompleteEvent } from '../run/types';
import { CompletionCorrection } from './completion-correction';

const event = (summary: string): AssistantCompleteEvent =>
  ({ kind: 'assistant_complete', summary }) as AssistantCompleteEvent;

describe('CompletionCorrection', () => {
  it('has nothing to correct or exhaust without a rejection', () => {
    const correction = new CompletionCorrection('turn-1', NOOP_LOGGER);

    expect(correction.beginCorrection()).toBeNull();
    expect(correction.exhaust()).toBeNull();
  });

  it('sends precise errors back to the agent', () => {
    const correction = new CompletionCorrection('turn-1', NOOP_LOGGER);
    correction.reject(event('bad'), {
      message: 'Identity mismatch.',
      issues: ['/provider: must equal claude'],
    });

    const prompt = correction.beginCorrection();

    expect(prompt).toContain('Identity mismatch.');
    expect(prompt).toContain('/provider: must equal claude');
    expect(correction.isCorrecting).toBe(true);
  });

  it('clears the rejection when a corrected answer is accepted', () => {
    const correction = new CompletionCorrection('turn-1', NOOP_LOGGER);
    correction.reject(event('bad'), { message: 'bad' });
    correction.beginCorrection();
    correction.accept();
    correction.endCorrection();

    expect(correction.beginCorrection()).toBeNull();
    expect(correction.exhaust()).toBeNull();
  });

  it('allows two attempts, then releases the last rejection exactly once', () => {
    const correction = new CompletionCorrection('turn-1', NOOP_LOGGER);
    correction.reject(event('first'), { message: 'bad' });
    expect(correction.beginCorrection()).not.toBeNull();
    correction.reject(event('second'), { message: 'bad' });
    correction.endCorrection();
    expect(correction.beginCorrection()).not.toBeNull();
    const last = event('third');
    correction.reject(last, { message: 'bad' });
    correction.endCorrection();

    expect(correction.beginCorrection()).toBeNull();
    expect(correction.exhaust()).toBe(last);
    expect(correction.isExhausted).toBe(true);
    expect(correction.exhaust()).toBeNull();
  });
});
