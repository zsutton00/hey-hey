import { QuestionsSystemMessageData } from '../../generated';
import {
  extractRoundFromField,
  processUserResponsesWithQuestions,
} from '../response-question-matcher.util';

describe('response-question-matcher.util', () => {
  const mockSystemData: QuestionsSystemMessageData = {
    type: 'QUESTIONS',
    response: 'Great responses!',
    detectedIntent: '',
    intentConfidence: 0,
    uiElements: [
      {
        id: 'round1_project_concept',
        type: 'textarea',
        label: 'What is your project concept?',
        placeholder: 'Describe your project...',
        required: true,
        influences: [],
      },
      {
        id: 'round2_technical_approach',
        type: 'textarea',
        label: 'What is your technical approach?',
        required: true,
        influences: [],
      },
      {
        id: 'round2_target_users',
        type: 'select',
        label: 'Who are your target users?',
        required: false,
        options: [
          { value: 'small', label: 'Small teams' },
          { value: 'large', label: 'Large enterprises' },
          { value: 'individual', label: 'Individual users' },
        ],
        influences: [],
      },
    ],
  };

  describe('processUserResponsesWithQuestions', () => {
    it('should process valid user responses correctly', () => {
      const userResponses = {
        round1_project_concept:
          'AI-powered analytics dashboard for sales teams',
        round2_technical_approach:
          'React frontend with Node.js backend using PostgreSQL',
        round2_target_users: 'Small teams',
      };

      const result = processUserResponsesWithQuestions(
        userResponses,
        mockSystemData,
      );

      expect(result.validResponses).toHaveLength(3);
      expect(result.skippedResponses).toHaveLength(0);

      const firstResponse = result.validResponses[0];
      if (!firstResponse) {
        throw new Error('Expected a valid response');
      }
      expect(firstResponse.questionField).toBe('round1_project_concept');
      expect(firstResponse.answer).toBe(
        'AI-powered analytics dashboard for sales teams',
      );
      expect(firstResponse.question).toBe('What is your project concept?');
      expect(firstResponse.round).toBe(1);
      expect(firstResponse.artifactType).toBe('QA_PAIR');
      expect(firstResponse.uiElement).toEqual(
        mockSystemData.uiElements?.[0] || null,
      );
    });

    it('should skip empty responses', () => {
      const userResponses = {
        round1_project_concept: '',
        round2_technical_approach: null as any,
        round2_target_users: undefined as any,
      };

      const result = processUserResponsesWithQuestions(
        userResponses,
        mockSystemData,
      );

      expect(result.validResponses).toHaveLength(0);
      expect(result.skippedResponses).toHaveLength(3);
      expect(
        result.skippedResponses.every((skip) => skip.reason === 'empty'),
      ).toBe(true);
    });

    it('should skip non-string responses', () => {
      const userResponses = {
        round1_project_concept: 'Valid string response for the project concept',
        round2_technical_approach: 123, // Number instead of string
        round2_target_users: { invalid: 'object' }, // Object instead of string
      };

      const result = processUserResponsesWithQuestions(
        userResponses,
        mockSystemData,
      );

      expect(result.validResponses).toHaveLength(1);
      expect(result.skippedResponses).toHaveLength(2);
      expect(
        result.skippedResponses.every((skip) => skip.reason === 'invalid_type'),
      ).toBe(true);
    });

    it('should ignore non-text UI element responses', () => {
      const systemData: QuestionsSystemMessageData = {
        ...mockSystemData,
        uiElements: [
          ...(mockSystemData.uiElements ?? []),
          {
            id: 'step_proposal_view',
            type: 'plan_stage_proposal',
            label: 'Review the proposed execution steps',
            required: false,
            influences: [],
          },
        ],
      };
      const userResponses = {
        round1_project_concept: 'AI-powered analytics dashboard',
        step_proposal_view: {
          type: 'PLAN_STAGE_PROPOSAL',
          nextAction: 'READY_FOR_NEXT_STEP',
        },
      };

      const result = processUserResponsesWithQuestions(
        userResponses,
        systemData,
      );

      expect(result.validResponses).toHaveLength(1);
      expect(result.skippedResponses).toHaveLength(1);
      expect(result.skippedResponses[0]?.reason).toBe('invalid_type');
    });

    it('should accept task_generation responses as text', () => {
      const systemData: QuestionsSystemMessageData = {
        ...mockSystemData,
        uiElements: [
          {
            id: 'generate_tasks_button',
            type: 'task_generation',
            label: 'Generate Tasks',
            required: false,
            influences: [],
          },
        ],
      };
      const userResponses = {
        generate_tasks_button:
          'We need a plan UI for stages, steps, next steps.',
      };

      const result = processUserResponsesWithQuestions(
        userResponses,
        systemData,
      );

      expect(result.validResponses).toHaveLength(1);
      expect(result.skippedResponses).toHaveLength(0);
      expect(result.validResponses[0]?.questionField).toBe(
        'generate_tasks_button',
      );
    });

    it('should extract feedback from canonical onboarding review responses', () => {
      const systemData: QuestionsSystemMessageData = {
        ...mockSystemData,
        uiElements: [
          {
            id: 'feature_list_view',
            type: 'feature_list',
            label: 'Review the generated features',
            required: false,
            influences: [],
          },
          {
            id: 'plan_stage_view',
            type: 'plan_stage_proposal',
            label: 'Review the proposed plans',
            required: false,
            influences: [],
          },
        ],
      };
      const userResponses = {
        feature_list_view: {
          action: 'REFINE',
          payload: {
            sections: { 'Trip Itinerary': 'Add transport planning.' },
            overall: 'Keep the first release focused.',
          },
        },
        plan_stage_view: {
          action: 'REFINE',
          payload: {
            userMessage: 'Make the plans smaller.',
            stageFeedback: [
              {
                sequenceOrder: 1,
                title: 'Discovery',
                action: 'reject',
                comment: 'Split this into a separate proposal.',
              },
            ],
          },
        },
      };

      const result = processUserResponsesWithQuestions(
        userResponses,
        systemData,
      );

      expect(result.validResponses).toHaveLength(2);
      expect(result.validResponses[0]?.answer).toContain(
        'Keep the first release focused.',
      );
      expect(result.validResponses[0]?.answer).toContain(
        'Trip Itinerary: Add transport planning.',
      );
      expect(result.validResponses[1]?.answer).toContain(
        'Make the plans smaller.',
      );
      expect(result.validResponses[1]?.answer).toContain(
        'Stage 1 (Discovery) [reject]: Split this into a separate proposal.',
      );
    });

    it('should handle responses without matching questions', () => {
      const userResponses = {
        round1_project_concept: 'AI-powered analytics dashboard',
        unknown_field: 'Response to unknown question',
      };

      const result = processUserResponsesWithQuestions(
        userResponses,
        mockSystemData,
      );

      expect(result.validResponses).toHaveLength(2);

      const unknownFieldResponse = result.validResponses.find(
        (r) => r.questionField === 'unknown_field',
      );
      expect(unknownFieldResponse?.uiElement).toBeNull();
      expect(unknownFieldResponse?.question).toBe('User response');
    });
  });

  describe('extractRoundFromField', () => {
    it('should extract round numbers correctly', () => {
      expect(extractRoundFromField('round1_project_concept')).toBe(1);
      expect(extractRoundFromField('round2_technical_approach')).toBe(2);
      expect(extractRoundFromField('round10_advanced_feature')).toBe(10);
    });

    it('should default to 1 for fields without round prefix', () => {
      expect(extractRoundFromField('project_concept')).toBe(1);
      expect(extractRoundFromField('invalid_field')).toBe(1);
      expect(extractRoundFromField('')).toBe(1);
    });
  });
});
