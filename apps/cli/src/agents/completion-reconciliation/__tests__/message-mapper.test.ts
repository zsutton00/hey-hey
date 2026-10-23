import { describe, expect, it } from 'vitest';
import { mapCompletionResponse, withFeatureVerificationSuggestion } from '../message-mapper';

const suggestion = {
  feature: { entityType: 'FEATURE' as const, entityId: '33333333-3333-4333-8333-333333333333' },
  explanation: 'The Mockup shows a Retry button; the dialog has none.',
  impactedEntities: [{ entityType: 'TASK', entityId: '44444444-4444-4444-8444-444444444444' }],
};

describe('persisted completion message', () => {
  it('maps the reply as plain text with no field', () => {
    expect(mapCompletionResponse({ response: 'Done' })).toEqual({
      data: {
        type: 'AGENT',
        response: 'Done',
        detectedIntent: 'agent_response',
        intentConfidence: 1,
      },
    });
  });

  it('adds the Verify Feature action for a concern the agent raised through its tool', () => {
    const dto = withFeatureVerificationSuggestion(
      mapCompletionResponse({ response: 'Done' }),
      suggestion,
    );

    expect(dto.data).toMatchObject({
      response: 'Done',
      uiElements: [
        {
          id: 'verify-feature',
          type: 'verify_feature',
          payload: suggestion,
          secondaryAction: { handler: 'verify_feature', fieldId: 'verify-feature' },
        },
      ],
    });
  });

  it('leaves the reply untouched when no concern was raised', () => {
    const dto = mapCompletionResponse({ response: 'Done' });

    expect(withFeatureVerificationSuggestion(dto, null)).toBe(dto);
  });
});
