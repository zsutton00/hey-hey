import { describe, expect, it } from 'vitest';
import { codingFreeformHandler } from '../coding-conversation';
import { makeTestRun, makeTestTurn } from '../../run/handlers/__test-utils';
import { SubmissionToolCorrectableError } from './types';
import { suggestFeatureVerificationTool } from './suggest-feature-verification-tool';

const FEATURE_ID = '33333333-3333-4333-8333-333333333333';

const textOf = (result: { content: ReadonlyArray<{ text?: unknown }> }) =>
  String(result.content[0]?.text);

const call = (args: Record<string, unknown>, turn = makeTestTurn(codingFreeformHandler)) => {
  const run = makeTestRun({ activeTurn: turn });
  return {
    turn,
    result: suggestFeatureVerificationTool.execute({ runId: run.runId, args, run }),
  };
};

describe('suggest_feature_verification', () => {
  it('records the feature, the observed discrepancy and the starting points on the active Turn', () => {
    const impactedEntities = [
      { entityType: 'MOCKUP', entityId: '44444444-4444-4444-8444-444444444444' },
      { entityType: 'DECISION', entityId: '55555555-5555-4555-8555-555555555555' },
    ];
    const { turn, result } = call({
      featureId: FEATURE_ID,
      discrepancy: 'The Mockup shows a Retry button; the dialog has none.',
      impactedEntities,
    });

    expect(textOf(result)).toContain('Recorded');
    expect(turn.featureVerificationSuggestion).toEqual({
      feature: { entityType: 'FEATURE', entityId: FEATURE_ID },
      explanation: 'The Mockup shows a Retry button; the dialog has none.',
      impactedEntities,
    });
  });

  it('keeps the first concern when the Turn calls the tool again', () => {
    const turn = makeTestTurn(codingFreeformHandler);
    call({ featureId: FEATURE_ID, discrepancy: 'First.', impactedEntities: [] }, turn);
    const second = call(
      { featureId: FEATURE_ID, discrepancy: 'Second.', impactedEntities: [] },
      turn,
    ).result;

    expect(textOf(second)).toContain('Already recorded');
    expect(turn.featureVerificationSuggestion?.explanation).toBe('First.');
  });

  it.each([
    [
      'a non-UUID feature id',
      { featureId: 'feature-1', discrepancy: 'Differs.', impactedEntities: [] },
    ],
    ['a blank discrepancy', { featureId: FEATURE_ID, discrepancy: '  ', impactedEntities: [] }],
    ['a missing impacted-entity list', { featureId: FEATURE_ID, discrepancy: 'Differs.' }],
    [
      'a non-UUID impacted entity id',
      {
        featureId: FEATURE_ID,
        discrepancy: 'Differs.',
        impactedEntities: [{ entityType: 'TASK', entityId: 'task-1' }],
      },
    ],
    [
      'an impacted entity with extra fields',
      {
        featureId: FEATURE_ID,
        discrepancy: 'Differs.',
        impactedEntities: [{ entityType: 'TASK', entityId: FEATURE_ID, title: 'x' }],
      },
    ],
  ])('returns a correctable rejection for %s and records nothing', (_label, args) => {
    const turn = makeTestTurn(codingFreeformHandler);

    expect(() => call(args, turn).result).toThrow(SubmissionToolCorrectableError);
    expect(turn.featureVerificationSuggestion).toBeNull();
  });

  it('does not record once the reply has already been published', () => {
    const turn = makeTestTurn(codingFreeformHandler);
    turn.recordCompletedAssistantMessage('message-1');

    const { result } = call(
      { featureId: FEATURE_ID, discrepancy: 'Late.', impactedEntities: [] },
      turn,
    );

    expect(textOf(result)).toContain('Not recorded');
    expect(turn.featureVerificationSuggestion).toBeNull();
  });
});
