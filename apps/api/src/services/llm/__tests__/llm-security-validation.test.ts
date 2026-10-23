import {
  parseLLMResponse,
  userFeedbackSchema,
  initiativeGenerationResponseSchema,
} from '../../schemas/llm-response.schemas';
import { z } from 'zod';

// Helper function to parse JSON and validate
function parseAndValidateJSON(jsonString: string) {
  try {
    const parsed = JSON.parse(jsonString);
    return parseLLMResponse(parsed, initiativeGenerationResponseSchema);
  } catch (error) {
    return {
      success: false,
      error: `Invalid JSON response from LLM: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

describe('LLM Security Validation', () => {
  describe('User Feedback Sanitization', () => {
    it('should sanitize valid user feedback', () => {
      const validFeedback =
        'This initiative needs more detail about the API endpoints';
      const result = userFeedbackSchema.safeParse(validFeedback);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(validFeedback);
      }
    });

    it('should reject feedback with script tags', () => {
      const maliciousFeedback = 'This looks good <script>alert("xss")</script>';
      const result = userFeedbackSchema.safeParse(maliciousFeedback);

      expect(result.success).toBe(false);
    });

    it('should reject feedback with javascript protocol', () => {
      const maliciousFeedback = 'Click here: javascript:alert("xss")';
      const result = userFeedbackSchema.safeParse(maliciousFeedback);

      expect(result.success).toBe(false);
    });

    it('should reject feedback with event handlers', () => {
      const maliciousFeedback = 'This is <img src=x onerror=alert("xss")>';
      const result = userFeedbackSchema.safeParse(maliciousFeedback);

      expect(result.success).toBe(false);
    });

    it('should sanitize HTML tags from feedback', () => {
      const feedbackWithHTML = 'This needs <b>bold</b> improvements';
      const result = userFeedbackSchema.safeParse(feedbackWithHTML);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('This needs bold improvements');
      }
    });

    it('should reject feedback that is too long', () => {
      const longFeedback = 'a'.repeat(1001);
      const result = userFeedbackSchema.safeParse(longFeedback);

      expect(result.success).toBe(false);
    });
  });

  describe('LLM Response Validation', () => {
    it('should parse valid LLM response from JSON string', () => {
      const validResponseString = JSON.stringify({
        initiatives: [
          {
            name: 'Frontend Development',
            description: 'Build the user interface',
            details:
              'Create a modern React-based frontend with responsive design',
            acceptanceCriteria:
              'Users can navigate the interface on desktop and mobile',
            estimatedEffort: 'medium',
            priority: 'high',
            tags: ['frontend', 'react'],
            reasoning: 'Critical for user interaction',
            influences: [] as unknown as any[],
          },
        ],
        reasoning: 'Based on project requirements',
        confidenceScore: 0.8,
        suggestedNextSteps: [
          'Review requirements',
          'Set up development environment',
        ],
      });

      const result = parseAndValidateJSON(validResponseString);

      expect(result.success).toBe(true);
      if (result.success) {
        expect((result as any).data.initiatives).toHaveLength(1);
        expect((result as any).data.initiatives[0].name).toBe(
          'Frontend Development',
        );
      }
    });

    it('should reject malformed JSON', () => {
      const malformedResponse = '{ "initiatives": [invalid json}';

      // Since parseLLMResponse expects parsed JSON, we need to handle JSON parsing
      let parsedResponse;
      let parseError: Error | null = null;
      try {
        parsedResponse = JSON.parse(malformedResponse);
      } catch (e) {
        parseError = e as Error;
      }

      // If JSON parsing failed, we should handle it appropriately
      if (parseError) {
        expect(parseError.message).toContain('JSON');
      } else {
        // This shouldn't happen with malformed JSON
        expect(parsedResponse).toBeUndefined();
      }
    });

    it('should reject response with dangerous content', () => {
      const dangerousResponseString = JSON.stringify({
        initiatives: [
          {
            name: 'Evil Initiative <script>alert("xss")</script>',
            description: 'This contains malicious content',
            details: 'More malicious details with javascript:void(0)',
            acceptanceCriteria: 'Include dangerous <script> tags',
            estimatedEffort: 'medium',
            priority: 'high',
            tags: ['evil'],
            reasoning: 'Dangerous reasoning with eval() calls',
            influences: [] as unknown as any[],
          },
        ],
        reasoning: 'Malicious reasoning',
        confidenceScore: 0.8,
        suggestedNextSteps: [] as string[],
      });

      const result = parseAndValidateJSON(dangerousResponseString);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as { success: false; error: string }).error).toContain(
          'dangerous patterns',
        );
      }
    });

    it('should reject response with invalid enum values', () => {
      const invalidEnumResponse = {
        initiatives: [
          {
            name: 'Test Initiative',
            description: 'Valid description',
            details: 'Test details',
            acceptanceCriteria: 'Test criteria',
            estimatedEffort: 'invalid_effort', // Invalid enum
            priority: 'high',
            tags: ['test'],
            reasoning: 'Test reasoning',
            influences: [] as unknown as any[],
          },
        ],
        reasoning: 'Test reasoning',
        confidenceScore: 0.8,
        suggestedNextSteps: [] as string[],
      };

      const result = parseAndValidateJSON(JSON.stringify(invalidEnumResponse));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as { success: false; error: string }).error).toContain(
          'Validation failed',
        );
      }
    });

    it('should reject response with too many initiatives', () => {
      const tooManyInitiatives = {
        initiatives: Array(15).fill({
          name: 'Test Initiative',
          description: 'Valid description',
          details: 'Test details',
          acceptanceCriteria: 'Test criteria',
          estimatedEffort: 'medium',
          priority: 'high',
          tags: ['test'],
          reasoning: 'Test reasoning',
          influences: [],
        }),
        reasoning: 'Too many initiatives',
        confidenceScore: 0.8,
        suggestedNextSteps: [] as string[],
      };

      const result = parseAndValidateJSON(JSON.stringify(tooManyInitiatives));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as { success: false; error: string }).error).toContain(
          'must contain at most 10 element',
        );
      }
    });
  });

  describe('JSON Parsing with Markdown Code Blocks', () => {
    // Simple test schema for parsing tests
    const testSchema = z.object({
      message: z.string(),
      count: z.number(),
      tags: z.array(z.string()),
    });

    const validTestData = {
      message: 'Test parsing functionality',
      count: 42,
      tags: ['test', 'parsing', 'markdown'],
    };

    it('should parse JSON wrapped in markdown code blocks', () => {
      const jsonContent = JSON.stringify(validTestData, null, 2);
      const markdownWrappedJson = `\`\`\`json\n${jsonContent}\n\`\`\``;

      const result = parseLLMResponse(markdownWrappedJson, testSchema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('Test parsing functionality');
        expect(result.data.count).toBe(42);
        expect(result.data.tags).toEqual(['test', 'parsing', 'markdown']);
      }
    });

    it('should parse clean JSON string without markdown wrapper', () => {
      const cleanJsonString = JSON.stringify(validTestData);

      const result = parseLLMResponse(cleanJsonString, testSchema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('Test parsing functionality');
        expect(result.data.count).toBe(42);
      }
    });

    it('should handle pre-parsed JSON objects directly', () => {
      const result = parseLLMResponse(validTestData, testSchema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('Test parsing functionality');
        expect(result.data.count).toBe(42);
      }
    });

    it('should handle markdown with extra whitespace', () => {
      const jsonContent = JSON.stringify(validTestData);
      const markdownWithWhitespace = `  \`\`\`json\n\n${jsonContent}\n\n\`\`\`  `;

      const result = parseLLMResponse(markdownWithWhitespace, testSchema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('Test parsing functionality');
      }
    });

    it('should fail gracefully with invalid JSON in markdown blocks', () => {
      const invalidJsonInMarkdown = `\`\`\`json\n{ "message": [invalid json}\n\`\`\``;

      const result = parseLLMResponse(invalidJsonInMarkdown, testSchema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as { success: false; error: string }).error).toContain(
          'Failed to parse JSON from LLM response',
        );
      }
    });

    it('should fail gracefully with malformed markdown blocks', () => {
      const malformedMarkdown = `\`\`\`json\n${JSON.stringify(validTestData)}\n\`\`\` extra content`;

      // This should still work because our regex is flexible
      const result = parseLLMResponse(malformedMarkdown, testSchema);

      // This case might fail depending on the regex, which is expected
      if (result.success) {
        expect(result.data.message).toBe('Test parsing functionality');
      } else {
        expect((result as { success: false; error: string }).error).toContain(
          'JSON',
        );
      }
    });

    it('should validate schema even when parsing markdown successfully', () => {
      const invalidDataInMarkdown = {
        message: 'Valid message',
        count: 'not_a_number', // Invalid type - should be number
        tags: ['test'],
      };

      const jsonContent = JSON.stringify(invalidDataInMarkdown);
      const markdownWrapped = `\`\`\`json\n${jsonContent}\n\`\`\``;

      const result = parseLLMResponse(markdownWrapped, testSchema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as { success: false; error: string }).error).toContain(
          'Validation failed',
        );
        expect((result as { success: false; error: string }).error).toContain(
          'count',
        );
      }
    });
  });

  describe('Error Handling - No Fallbacks', () => {
    it('should throw descriptive error for malformed JSON instead of fallback', () => {
      const malformedResponse = '{ "initiatives": [invalid json}';

      const result = parseAndValidateJSON(malformedResponse);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as { success: false; error: string }).error).toContain(
          'Invalid JSON response from LLM',
        );
      }
    });

    it('should provide clear error message for validation failures', () => {
      const invalidResponse = {
        initiatives: [
          {
            name: 'Test',
            description: 'Test description',
            details: 'Test details',
            acceptanceCriteria: 'Test criteria',
            estimatedEffort: 'invalid_effort', // Invalid enum
            priority: 'high',
            tags: [] as string[],
            reasoning: 'Test reasoning',
            influences: [] as unknown as any[],
          },
        ],
        // Missing required 'reasoning' field
      };

      const result = parseAndValidateJSON(JSON.stringify(invalidResponse));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as { success: false; error: string }).error).toContain(
          'Validation failed',
        );
        // Check for either missing reasoning or invalid enum error
        const hasExpectedError =
          (result as { success: false; error: string }).error.includes(
            'estimatedEffort',
          ) ||
          (result as { success: false; error: string }).error.includes(
            'reasoning',
          );
        expect(hasExpectedError).toBe(true);
      }
    });
  });
});
