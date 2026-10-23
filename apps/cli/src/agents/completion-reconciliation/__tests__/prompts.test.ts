import { describe, expect, it } from 'vitest';
import {
  buildCompletionReconciliationPromptFor,
  featureSyncRan,
  verifyFeatureCompletionPrompt,
} from '../prompts/common';
import { LocalPromptType } from '../../../shared/agent-bridge-contract/generated/api';
import { buildImplementPrompt } from '../../implement/prompts';
import { buildCodingConversationPrompt } from '../../prompts/coding-conversation';
import { buildEntityConversationPrompt } from '../../prompts/entity-conversation';

describe('shared completion prompt composition', () => {
  it('snapshots taskless Implement with approved-plan enrichment', () => {
    expect(
      buildImplementPrompt({ approvedPlan: 'Deliver the approved capability.' }),
    ).toMatchSnapshot();
  });
  it('snapshots taskless Open follow-up', () => {
    expect(
      buildCodingConversationPrompt(
        { userMessage: 'Discuss the design.' },
        { kind: 'follow_up', awaitingUserReview: false, taskId: null },
      ),
    ).toMatchSnapshot();
  });
  it('snapshots taskless Open launch', () => {
    expect(
      buildCodingConversationPrompt({ userMessage: 'Discuss the design.' }, { kind: 'launch' }),
    ).toMatchSnapshot();
  });
  it('snapshots Entity Conversation with explicit edit authorization preserved', () => {
    const prompt = buildEntityConversationPrompt({
      entity: {
        entityType: 'TASK',
        entityId: '3782302e-54ad-4908-b168-0b2260a89b3c',
        title: 'Example task',
      },
      userMessage: 'Discuss this task.',
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain('Do not reload that same focal entity by default');
    expect(prompt).toContain('user requests fresh state');
    expect(prompt).not.toContain('Before responding to the user, call get_context');
  });

  describe('Verify Feature suggestion', () => {
    const noFeatureSync = buildCompletionReconciliationPromptFor(new Set());
    const afterFeatureSync = buildCompletionReconciliationPromptFor(
      new Set([LocalPromptType.PlanShapingFeatureSyncAnalyze]),
    );

    it('tells the agent to raise a concern once, with the specific discrepancy', () => {
      for (const prompt of [noFeatureSync, afterFeatureSync]) {
        expect(prompt).toContain('suggest_feature_verification');
        expect(prompt).toContain('do not suggest it again');
        expect(prompt).not.toContain('featureUpdateSyncCheck');
      }
    });
    it('renders only the variant that matches whether Feature Sync ran on the Run', () => {
      expect(afterFeatureSync).toContain('Feature Sync ran in this session');
      expect(afterFeatureSync).not.toContain('Feature Sync did not run');
      expect(noFeatureSync).toContain('Feature Sync did not run in this session');
      expect(noFeatureSync).not.toContain('Feature Sync ran in this session');
    });
    it('treats only Feature Sync handlers as Feature Sync having run', () => {
      expect(featureSyncRan(new Set([LocalPromptType.FeatureSyncAnalyze]))).toBe(true);
      expect(featureSyncRan(new Set([LocalPromptType.FeatureSyncIterate]))).toBe(true);
      expect(featureSyncRan(new Set([LocalPromptType.PlanShapingFeatureSyncIterate]))).toBe(true);
      expect(featureSyncRan(new Set([LocalPromptType.ProjectAssistant, 'implement']))).toBe(false);
      expect(featureSyncRan(new Set())).toBe(false);
    });
    it('never offers the tool to the mode that investigates a raised concern', () => {
      expect(verifyFeatureCompletionPrompt).not.toContain('suggest_feature_verification');
      expect(noFeatureSync.startsWith(verifyFeatureCompletionPrompt.slice(0, 400))).toBe(true);
    });
  });
});
