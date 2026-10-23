import { describe, expect, it } from 'vitest';
import {
  ExtendedUIFieldType,
  SecondaryActionConfigPresentationEnum,
  SecondaryActionConfigTypeEnum,
  SecondaryActionHandler,
  SystemMessageDataTypeEnum,
  type UpdateMessageDto,
} from '../../shared/api/index';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import { FEATURE_SYNC_ACTIONS } from '../../agents/feature-sync/submission-tools';
import { addDataToMessage } from './feature-sync-affordances';

interface InspectedData {
  type?: string;
  response?: string;
  title?: string;
  uiElements?: Array<{ id?: string; type?: string; label?: string }>;
  secondaryActions?: Array<{
    id?: string;
    type?: string;
    presentation?: string;
    label?: string;
    fieldId?: string;
    handler?: string;
  }>;
}

const inspect = (dto: UpdateMessageDto): InspectedData => (dto.data ?? {}) as InspectedData;

const agentDto = (): UpdateMessageDto => ({
  data: {
    type: SystemMessageDataTypeEnum.Agent,
    response: 'All good.',
    detectedIntent: 'agent_response',
    intentConfidence: 1,
  },
});

describe('addDataToMessage', () => {
  it('does not attach when analyze ends with DISCREPANCY', () => {
    const result = addDataToMessage(agentDto(), {
      promptType: LocalPromptType.FeatureSyncAnalyze,
      lastSubmissionAction: {
        action: FEATURE_SYNC_ACTIONS.DISCREPANCY,
        payload: { discrepancies: [] },
      },
    });

    expect(inspect(result).secondaryActions).toBeUndefined();
  });

  it('does not attach for non-feature-sync prompt types', () => {
    const result = addDataToMessage(agentDto(), {
      promptType: 'final_assessment',
      lastSubmissionAction: { action: FEATURE_SYNC_ACTIONS.NO_DISCREPANCY },
    });

    expect(inspect(result).secondaryActions).toBeUndefined();
  });

  it('does not attach when lastSubmissionAction is null', () => {
    const result = addDataToMessage(agentDto(), {
      promptType: LocalPromptType.FeatureSyncAnalyze,
      lastSubmissionAction: null,
    });

    expect(inspect(result).secondaryActions).toBeUndefined();
  });

  it('returns the input unchanged when no data is present', () => {
    const dto: UpdateMessageDto = {};
    const result = addDataToMessage(dto, {
      promptType: LocalPromptType.FeatureSyncAnalyze,
      lastSubmissionAction: { action: FEATURE_SYNC_ACTIONS.NO_DISCREPANCY },
    });

    expect(result).toBe(dto);
  });

  describe('PlanShapingFeatureSyncIterate + REVISED', () => {
    const revisedDto = () =>
      addDataToMessage(agentDto(), {
        promptType: LocalPromptType.PlanShapingFeatureSyncIterate,
        lastSubmissionAction: {
          action: FEATURE_SYNC_ACTIONS.REVISED,
          payload: { discrepancies: [] },
        },
      });

    it('switches data type to Questions', () => {
      expect(inspect(revisedDto()).type).toBe(SystemMessageDataTypeEnum.Questions);
    });

    it('attaches a PlanShapingFeatureSyncReview ui element', () => {
      const elements = inspect(revisedDto()).uiElements ?? [];
      expect(elements).toHaveLength(1);
      expect(elements[0]?.type).toBe(ExtendedUIFieldType.PlanShapingFeatureSyncReview);
    });

    it('attaches Ignore and Keep-working secondary actions', () => {
      const actions = inspect(revisedDto()).secondaryActions ?? [];
      expect(actions).toHaveLength(2);
      expect(actions[0]?.handler).toBe(
        SecondaryActionHandler.PlanShapingFeatureSyncReviewRequestRevisions,
      );
      expect(actions[1]?.handler).toBe(SecondaryActionHandler.PlanShapingFeatureSyncReviewDone);
    });

    it('secondary actions reference the review element by fieldId', () => {
      const data = inspect(revisedDto());
      const elementId = data.uiElements?.[0]?.id;
      expect(elementId).toBeTruthy();
      expect(data.secondaryActions?.[0]?.fieldId).toBe(elementId);
      expect(data.secondaryActions?.[1]?.fieldId).toBe(elementId);
    });

    it('secondary actions have Button presentation', () => {
      const actions = inspect(revisedDto()).secondaryActions ?? [];
      expect(actions[0]?.presentation).toBe(SecondaryActionConfigPresentationEnum.Button);
      expect(actions[1]?.presentation).toBe(SecondaryActionConfigPresentationEnum.Button);
    });

    it('secondary actions have FieldAction type', () => {
      const actions = inspect(revisedDto()).secondaryActions ?? [];
      expect(actions[0]?.type).toBe(SecondaryActionConfigTypeEnum.FieldAction);
      expect(actions[1]?.type).toBe(SecondaryActionConfigTypeEnum.FieldAction);
    });
  });
});
