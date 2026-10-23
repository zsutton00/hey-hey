import { FlowNodeErrorRecoveryService } from '../../../services/workflows/flow-node-error-recovery.service';
import { LLMApiError } from '../../../services/llm/llm-client.service';
import { LLMProviderName } from '../../../services/llm/llm-shared';

/**
 * Test the new service-compatible error recovery service
 */

describe('FlowNodeErrorRecoveryService', () => {
  let service: FlowNodeErrorRecoveryService;

  beforeEach(() => {
    service = new FlowNodeErrorRecoveryService();
  });

  describe('HTTP Status Code Error Handling', () => {
    it('should not retry 400 Bad Request errors', () => {
      const error = new LLMApiError(
        'OpenAI API error: 400 Bad Request - Invalid parameter',
        400,
        LLMProviderName.OPENAI,
      );

      const result = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );

      expect(result.shouldRetry).toBe(false);
      expect(result.errorMessage).toContain('Recovery failed after 0 attempts');
    });

    it('should retry 429 Rate Limited errors with extended delay', () => {
      const error = new LLMApiError(
        'OpenAI API error: 429 Too Many Requests',
        429,
        LLMProviderName.OPENAI,
      );

      const result = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );

      expect(result.shouldRetry).toBe(true);
      expect(result.delayMs).toBeGreaterThan(5000); // Minimum 5s for rate limits
    });

    it('should retry 500 Server errors', () => {
      const error = new LLMApiError(
        'OpenAI API error: 500 Internal Server Error',
        500,
        LLMProviderName.OPENAI,
      );

      const result = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );

      expect(result.shouldRetry).toBe(true);
      expect(result.delayMs).toBeGreaterThan(0);
    });

    it('should not retry 401 Unauthorized errors', () => {
      const error = new LLMApiError(
        'OpenAI API error: 401 Unauthorized',
        401,
        LLMProviderName.OPENAI,
      );

      const result = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );

      expect(result.shouldRetry).toBe(false);
    });
  });

  describe('Retry Count Management', () => {
    it('should not retry after max attempts are exceeded', () => {
      const error = new LLMApiError(
        'OpenAI API error: 500 Internal Server Error',
        500,
        LLMProviderName.OPENAI,
      );

      // First three attempts should be retryable
      let result = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );
      expect(result.shouldRetry).toBe(true);

      result = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );
      expect(result.shouldRetry).toBe(true);

      result = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );
      expect(result.shouldRetry).toBe(true);

      // Fourth attempt should not be retryable (max retries exceeded)
      result = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );
      expect(result.shouldRetry).toBe(false);
      expect(result.errorMessage).toContain('Recovery failed after 3 attempts');
    });

    it('should reset retry count on success', () => {
      const error = new LLMApiError(
        'OpenAI API error: 500 Internal Server Error',
        500,
        LLMProviderName.OPENAI,
      );

      // First attempt - should be retryable
      let result = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );
      expect(result.shouldRetry).toBe(true);

      // Reset on success
      service.resetErrorRecoveryState('test-node', 'test-org');

      // Next attempt should be retryable again (retry count reset)
      result = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );
      expect(result.shouldRetry).toBe(true);
    });
  });

  describe('Exponential Backoff', () => {
    it('should increase delay with each retry attempt', () => {
      const error = new Error('Network error');

      // First retry
      const result1 = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );
      expect(result1.shouldRetry).toBe(true);
      const delay1 = result1.delayMs;

      // Second retry should have longer delay
      const result2 = service.handleErrorRecovery(
        'test-node',
        'test-org',
        error,
        'test-context',
      );
      expect(result2.shouldRetry).toBe(true);
      const delay2 = result2.delayMs;

      if (delay1 === undefined || delay2 === undefined) {
        throw new Error('Expected delayMs to be set for retryable errors');
      }

      expect(delay2).toBeGreaterThan(delay1);
    });
  });
});
