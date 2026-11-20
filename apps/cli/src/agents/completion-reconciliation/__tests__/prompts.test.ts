import { describe, expect, it } from 'vitest';
import {
  buildCompletionReconciliationPromptFor,
  changedFileReportingPrompt,
  featureSyncRan,
  verifyFeatureCompletionPrompt,
} from '../prompts/common';
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
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

  describe('session-matched completion duties', () => {
    const conversationAbout = (entityType: 'PROJECT' | 'TASK', taskType?: string): string =>
      buildEntityConversationPrompt({
        entity: {
          entityType,
          entityId: '3782302e-54ad-4908-b168-0b2260a89b3c',
          title: 'Focal item',
          ...(taskType ? { taskType } : {}),
        },
        userMessage: 'Discuss this.',
      });
    const taskJudgment = 'judge the completed work against the prepared canonical task context';

    it('gives a project-focused conversation only changed-file reporting', () => {
      const prompt = conversationAbout('PROJECT');
      expect(prompt).toContain(changedFileReportingPrompt);
      expect(prompt).not.toContain(taskJudgment);
    });
    it('keeps the task judgment for a task-focused conversation only', () => {
      expect(conversationAbout('TASK', 'STANDARD')).toContain(taskJudgment);
      expect(conversationAbout('TASK', 'FEATURE')).not.toContain(taskJudgment);
    });
    it('never claims the session holds Diagrams, Mockups or Project Assistant context', () => {
      // Those duties arrive through session-role guidance for the types actually in context.
      for (const startedPromptTypes of [
        new Set<string>(),
        new Set<string>([LocalPromptType.ProjectAssistant]),
      ]) {
        const prompt = buildCompletionReconciliationPromptFor({
          startedPromptTypes,
          focalTask: true,
        });
        expect(prompt).not.toContain('You hold');
        expect(prompt).not.toContain('Project Assistant');
      }
    });
  });

  describe('Feature Sync history', () => {
    const noFeatureSync = buildCompletionReconciliationPromptFor({
      startedPromptTypes: new Set(),
      focalTask: true,
    });
    const afterFeatureSync = buildCompletionReconciliationPromptFor({
      startedPromptTypes: new Set([LocalPromptType.PlanShapingFeatureSyncAnalyze]),
      focalTask: true,
    });

    it('holds back concerns Feature Sync already handled only when it ran on the Run', () => {
      expect(afterFeatureSync).toContain('Feature Sync ran in this session');
      expect(afterFeatureSync).toContain('suggest_feature_verification');
      expect(noFeatureSync).not.toContain('Feature Sync');
      expect(noFeatureSync).not.toContain('suggest_feature_verification');
    });
    it('treats only Feature Sync handlers as Feature Sync having run', () => {
      expect(featureSyncRan(new Set([LocalPromptType.FeatureSyncAnalyze]))).toBe(true);
      expect(featureSyncRan(new Set([LocalPromptType.FeatureSyncIterate]))).toBe(true);
      expect(featureSyncRan(new Set([LocalPromptType.PlanShapingFeatureSyncIterate]))).toBe(true);
      expect(featureSyncRan(new Set([LocalPromptType.ProjectAssistant, 'implement']))).toBe(false);
      expect(featureSyncRan(new Set())).toBe(false);
    });
    it('never mentions the tool to the mode that investigates a raised concern', () => {
      expect(verifyFeatureCompletionPrompt).not.toContain('suggest_feature_verification');
      expect(verifyFeatureCompletionPrompt).toBe(noFeatureSync);
    });
  });
});
