import {
  CodingPlanReviewAnswerPayloadSchema,
  OnboardingFeatureListReviewUserSubmissionSchema,
  OnboardingPlanStageProposalReviewUserSubmissionSchema,
  PlanShapingFeatureSyncReviewDismissedAnswerPayloadSchema,
  PlanShapingFeatureSyncReviewRefineAnswerPayloadSchema,
  QuestionsApprovedPayloadSchema,
  QuestionsFeedbackPayloadSchema,
} from 'src/generated/workflow-review.schemas';
import type { PlanShapingProposedStagesCompletionPayload } from 'src/generated';
import { z } from 'zod';
import {
  planShapingProposedStagesCompletionPayloadSchema,
  planShapingProposedStagesFeedbackActions,
  planShapingVisualPreviewFeedbackActions,
} from 'src/flows/nodes/plan-shaping/schemas';

type ProposedStagesCompletionPayload = z.infer<
  typeof planShapingProposedStagesCompletionPayloadSchema
>;
const assertProposedStagesCompletionPayloadContract = (
  value: ProposedStagesCompletionPayload,
): PlanShapingProposedStagesCompletionPayload => value;
void assertProposedStagesCompletionPayloadContract;

const codingPlanPayload = {
  responseType: 'startup_plan_v1',
  sessionTitle: 'Contract-owned workflow review',
  requiredServiceIds: ['service-1'],
  primaryImplementations: [
    {
      title: 'Generated validator',
      content: 'Read the runtime payload constraints from OpenAPI.',
      rationale: 'The contract must have one source of truth.',
      openApiPermittedExtension: 'preserved',
    },
  ],
  executionPlan: [],
  discrepancies: [],
  clarificationQuestions: [],
  openApiPermittedExtension: { retained: true },
};

describe('generated workflow-review payload schemas', () => {
  it('keeps proposed-stage completion validation aligned with the generated contract', () => {
    expect(
      planShapingProposedStagesCompletionPayloadSchema.safeParse({
        expectedStageCount: 0,
      }).success,
    ).toBe(true);
    expect(
      planShapingProposedStagesCompletionPayloadSchema.safeParse({
        revisionId: 'removed-stage-count-identity',
        expectedStageCount: 0,
      }).success,
    ).toBe(false);
  });
  it('preserves additional properties wherever OpenAPI leaves the object open', () => {
    expect(
      CodingPlanReviewAnswerPayloadSchema.parse(codingPlanPayload),
    ).toEqual(codingPlanPayload);
  });

  it('rejects additional properties on the OpenAPI-closed refine payload', () => {
    expect(
      PlanShapingFeatureSyncReviewRefineAnswerPayloadSchema.safeParse({
        feedback: 'Keep refining.',
        legacyEnvelope: true,
      }).success,
    ).toBe(false);
  });

  it('accepts only the empty OpenAPI-closed dismissed payload', () => {
    expect(
      PlanShapingFeatureSyncReviewDismissedAnswerPayloadSchema.safeParse({})
        .success,
    ).toBe(true);
    expect(
      PlanShapingFeatureSyncReviewDismissedAnswerPayloadSchema.safeParse({
        feedback: 'must not be carried',
      }).success,
    ).toBe(false);
  });

  it('enforces action-specific plan-review payload shapes', () => {
    expect(
      QuestionsFeedbackPayloadSchema.safeParse({ feedback: 'Revise it.' })
        .success,
    ).toBe(true);
    expect(QuestionsApprovedPayloadSchema.safeParse({}).success).toBe(true);
    expect(
      QuestionsApprovedPayloadSchema.safeParse({ feedback: '' }).success,
    ).toBe(false);
    expect(
      QuestionsFeedbackPayloadSchema.safeParse({
        feedback: 'Revise it.',
        legacyEnvelope: true,
      }).success,
    ).toBe(false);
  });

  it('enforces canonical onboarding feature-list and plan-review unions', () => {
    expect(
      OnboardingFeatureListReviewUserSubmissionSchema.safeParse({
        action: 'APPROVED',
        payload: {},
      }).success,
    ).toBe(true);
    expect(
      OnboardingFeatureListReviewUserSubmissionSchema.safeParse({
        action: 'APPROVED',
        payload: { feedback: 'legacy payload' },
      }).success,
    ).toBe(false);
    expect(
      OnboardingFeatureListReviewUserSubmissionSchema.safeParse({
        action: 'REFINE',
        payload: { sections: {}, overall: 'Rebucket these.' },
      }).success,
    ).toBe(true);
    expect(
      OnboardingFeatureListReviewUserSubmissionSchema.safeParse({
        nextAction: 'READY_FOR_NEXT_STEP',
        type: 'FEATURE_LIST',
        refinement: { sections: {}, overall: '' },
      }).success,
    ).toBe(false);

    expect(
      OnboardingPlanStageProposalReviewUserSubmissionSchema.safeParse({
        action: 'APPROVED',
        payload: {
          stageFeedback: [
            { sequenceOrder: 1, title: 'Plan A', action: 'accept' },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      OnboardingPlanStageProposalReviewUserSubmissionSchema.safeParse({
        action: 'APPROVED',
        payload: { stageFeedback: [], legacyAction: 'READY_FOR_NEXT_STEP' },
      }).success,
    ).toBe(false);
  });

  it.each([
    planShapingProposedStagesFeedbackActions,
    planShapingVisualPreviewFeedbackActions,
  ])('hard-cuts every review gate over to canonical actions', (actions) => {
    expect(Object.keys(actions).sort()).toEqual(['APPROVED', 'REFINE']);
    expect(actions).not.toHaveProperty('continue_revising');
    expect(actions).not.toHaveProperty('approve_all');
    expect(actions).not.toHaveProperty('approve');
  });
});
