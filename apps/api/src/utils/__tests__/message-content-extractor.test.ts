import { MessageContentExtractor } from '../message-content-extractor';
import { FlowUserMessage } from '../../types/flow-internal.types';
import { SystemMessageData, type MessageResponseDto } from '../../generated';
import * as TestUtils from '../testUtils';

describe('MessageContentExtractor', () => {
  const { testIds } = TestUtils;

  const createMockUserMessage = (
    messageData: unknown,
    parentSystemMessageData?: SystemMessageData,
  ): FlowUserMessage =>
    TestUtils.createMockFlowUserMessage({
      data: messageData as any,
      ...(parentSystemMessageData && {
        parentMessage: { data: parentSystemMessageData } as MessageResponseDto,
      }),
    });

  describe('extractMessageContent', () => {
    it('should extract direct string message', () => {
      const userMessage = createMockUserMessage('looks good');

      const result = MessageContentExtractor.extractMessageContent(userMessage);

      expect(result).toBe('looks good');
    });

    it('should extract UI element response', () => {
      const userMessage = createMockUserMessage({
        initiative_feedback: 'looks good to me',
      });

      const result = MessageContentExtractor.extractMessageContent(userMessage);

      expect(result).toBe('looks good to me');
    });

    it('should format multiple UI element responses', () => {
      const userMessage = createMockUserMessage({
        initiative_feedback: 'looks good',
        additional_comments: 'please add more details',
      });

      const result = MessageContentExtractor.extractMessageContent(userMessage);

      expect(result).toContain('initiative_feedback: looks good');
      expect(result).toContain('additional_comments: please add more details');
    });

    it('should format with context when parent system message provided', () => {
      const userMessage = createMockUserMessage({
        initiative_feedback: 'looks good',
      });

      const parentSystemMessage: SystemMessageData = {
        type: 'QUESTIONS',
        uiElements: [
          {
            id: 'initiative_feedback',
            type: 'textarea',
            label: 'What are your thoughts on this initiative?',
            required: true,
          },
        ],
      } as SystemMessageData;

      const result = MessageContentExtractor.extractMessageContent(
        userMessage,
        parentSystemMessage,
      );

      expect(result).toBe(
        'Q: What are your thoughts on this initiative?\nA: looks good',
      );
    });

    it('should handle empty message data', () => {
      const userMessage = createMockUserMessage({});

      const result = MessageContentExtractor.extractMessageContent(userMessage);

      expect(result).toBe('[No response provided]');
    });

    it('should properly correlate multiple questions with user answers using real data structure', () => {
      const parentSystemMessageData: SystemMessageData = {
        type: 'QUESTIONS',
        response:
          "Welcome! I'm here to help you set up your project and create a roadmap. Let's start with understanding what you're building and the context around it.",
        uiElements: [
          {
            id: 'project_concept',
            type: 'textarea',
            label: 'Project Concept',
            required: true,
            multiline: true,
            influences: [],
            placeholder: 'Tell me about your project idea...',
          },
          {
            id: 'project_maturity',
            type: 'select',
            label: 'How would you describe the current state of this project?',
            options: [
              {
                label: 'New/Greenfield - Starting from scratch',
                value: 'greenfield',
              },
              {
                label: 'Early - Some work complete',
                value: 'early',
              },
              {
                label: 'Existing/Mature - Already in development or production',
                value: 'mature',
              },
              {
                label:
                  'Legacy - No longer under active development. Maintenance only.',
                value: 'legacy',
              },
            ],
            required: true,
            influences: [],
          },
          {
            id: 'team_size',
            type: 'select',
            label: 'What is your team size for this project?',
            options: [
              {
                label: 'Solo (1 person)',
                value: 'solo',
              },
              {
                label: 'Small team (2-5 people)',
                value: 'small',
              },
              {
                label: 'Medium team (6-15 people)',
                value: 'medium',
              },
              {
                label: 'Large team (16+ people)',
                value: 'large',
              },
            ],
            required: true,
            influences: [],
          },
          {
            id: 'org_context',
            type: 'select',
            label: 'How does this project relate to your organization?',
            options: [
              {
                label: 'New company/startup',
                value: 'new_company',
              },
              {
                label: 'Part of existing organization',
                value: 'existing_org',
              },
            ],
            required: true,
            influences: [],
          },
        ],
        detectedIntent: '',
        intentConfidence: 0,
        initialUnderstanding: {
          keyTerms: [],
          complexity: 'moderate',
          projectType: 'unknown',
        },
      } as SystemMessageData;

      const userMessage = createMockUserMessage(
        {
          team_size: 'Solo (1 person)',
          org_context: 'New company/startup',
          project_concept:
            "I want to build a local first genai video management platform. It's principal goal is in the assistance of long form video but in particular it should help with the creation of key frames, merging short clips, normalizing colors and other functionality that is currently challenging with genai.",
          project_maturity: 'New/Greenfield - Starting from scratch',
        },
        parentSystemMessageData,
      );

      const result = MessageContentExtractor.extractMessageContent(userMessage);

      // Should correlate each question with its answer
      expect(result).toContain('Q: Project Concept');
      expect(result).toContain(
        'A: I want to build a local first genai video management platform',
      );
      expect(result).toContain(
        'Q: How would you describe the current state of this project?',
      );
      expect(result).toContain('A: New/Greenfield - Starting from scratch');
      expect(result).toContain('Q: What is your team size for this project?');
      expect(result).toContain('A: Solo (1 person)');
      expect(result).toContain(
        'Q: How does this project relate to your organization?',
      );
      expect(result).toContain('A: New company/startup');

      // Should separate Q&A pairs with double newlines
      expect(result.split('\n\n')).toHaveLength(4);
    });
  });
});
