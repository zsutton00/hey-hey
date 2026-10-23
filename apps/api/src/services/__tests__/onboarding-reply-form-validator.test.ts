import { BadRequestException } from '@nestjs/common';
import { UIElement } from '../../generated';
import { OnboardingReplyFormValidator } from '../onboarding-reply-form-validator';

describe('OnboardingReplyFormValidator', () => {
  const validator = new OnboardingReplyFormValidator();
  const fields: UIElement[] = [
    { id: 'name', type: 'text_input', label: 'Name', required: true },
    {
      id: 'stage',
      type: 'select',
      label: 'Stage',
      required: true,
      options: [{ value: 'idea', label: 'Idea' }],
    },
  ];
  const reviewFields: UIElement[] = [
    {
      id: 'feature-list',
      type: 'feature_list',
      label: 'Features',
      required: true,
    },
    {
      id: 'onboarding_plan_candidate_proposals',
      type: 'plan_stage_proposal',
      label: 'Plans',
      required: true,
    },
  ];

  it('accepts complete answers matching the current form', () => {
    expect(() =>
      validator.assertCompleteAnswers(fields, {
        name: 'Hey Hey',
        stage: 'idea',
      }),
    ).not.toThrow();
  });

  it('accepts the exact option label emitted by existing DynamicForm clients', () => {
    expect(() =>
      validator.assertCompleteAnswers(fields, {
        name: 'Hey Hey',
        stage: 'Idea',
      }),
    ).not.toThrow();
  });

  it('accepts the typed repository-grounding intent object on its select presentation field', () => {
    const intentField: UIElement[] = [
      {
        id: 'repository_grounding_intent',
        type: 'select',
        label: 'Project setup approach',
        required: true,
        options: [
          { value: 'yes', label: 'Yes, import existing work' },
          { value: 'no', label: 'No, continue without it' },
        ],
      },
    ];

    expect(() =>
      validator.assertCompleteAnswers(intentField, {
        repository_grounding_intent: { choice: 'yes' },
      }),
    ).not.toThrow();

    expect(() =>
      validator.assertCompleteAnswers(intentField, {
        repository_grounding_intent: 'yes',
      }),
    ).not.toThrow();
  });

  it.each([
    ['missing required value', { name: 'Hey Hey' }],
    ['unknown field', { name: 'Hey Hey', stage: 'idea', extra: true }],
    ['invalid option', { name: 'Hey Hey', stage: 'other' }],
  ])('rejects %s', (_label, answers) => {
    expect(() => validator.assertCompleteAnswers(fields, answers)).toThrow(
      BadRequestException,
    );
  });

  it('accepts canonical onboarding review action/payload pairs', () => {
    expect(() =>
      validator.assertCompleteAnswers(reviewFields, {
        'feature-list': { action: 'APPROVED', payload: {} },
        onboarding_plan_candidate_proposals: {
          action: 'APPROVED',
          payload: {
            stageFeedback: [
              { sequenceOrder: 1, title: 'Plan A', action: 'accept' },
            ],
          },
        },
      }),
    ).not.toThrow();
  });

  it.each([
    {
      'feature-list': {
        type: 'FEATURE_LIST',
        nextAction: 'READY_FOR_NEXT_STEP',
        refinement: { sections: {}, overall: '' },
      },
      onboarding_plan_candidate_proposals: {
        action: 'APPROVED',
        payload: { stageFeedback: [] },
      },
    },
    {
      'feature-list': {
        action: 'APPROVED',
        payload: { feedback: 'must not be accepted' },
      },
      onboarding_plan_candidate_proposals: {
        action: 'APPROVED',
        payload: { stageFeedback: [] },
      },
    },
    {
      'feature-list': {
        action: 'REFINE',
        payload: { sections: {}, overall: '' },
      },
      onboarding_plan_candidate_proposals: {
        action: 'REFINE',
        payload: { stageFeedback: [] },
        legacyAction: 'CONTINUE_REVISING',
      },
    },
  ])(
    'rejects legacy or mismatched onboarding review submissions',
    (answers) => {
      expect(() =>
        validator.assertCompleteAnswers(reviewFields, answers),
      ).toThrow(BadRequestException);
    },
  );

  describe('repository placement fields', () => {
    const rootKey = '11111111-1111-4111-8111-111111111111';
    const childKey = '22222222-2222-4222-8222-222222222222';
    const featureId = '33333333-3333-4333-8333-333333333333';
    const root = {
      rootKey,
      name: 'Root',
      description: 'Root feature',
      tag: 'product' as const,
      children: [
        {
          childKey,
          name: 'Child',
          description: 'Child feature',
          tag: 'frontend' as const,
        },
      ],
    };

    it('accepts all three action-keyed placement strategies', () => {
      const field: UIElement[] = [
        {
          id: 'repository_placement_strategy',
          type: 'repository_placement_strategy',
          label: 'Placement',
          required: true,
          payload: { roots: [root] },
        },
      ];
      const values = [
        { action: 'ADD_AT_ROOT' },
        {
          action: 'ADD_TO_EXISTING',
          parent: { targetType: 'EXISTING_FEATURE', featureId },
        },
        {
          action: 'ADD_TO_EXISTING',
          parent: {
            targetType: 'PENDING_HOLDER',
            name: 'Imported capabilities',
            description: 'Groups imported capabilities.',
            tag: 'product',
          },
        },
        { action: 'INTELLIGENTLY_INTEGRATE' },
      ];

      for (const value of values) {
        expect(() =>
          validator.assertCompleteAnswers(field, {
            repository_placement_strategy: value,
          }),
        ).not.toThrow();
      }
    });

  });
});
