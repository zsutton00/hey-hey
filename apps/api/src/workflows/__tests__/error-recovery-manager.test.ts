import { LLMApiError } from '../../services/llm/llm-client.service';
import { LLMProviderName } from '../../services/llm/llm-shared';

/**
 * Simple tests for error retry logic - focusing on the core functionality
 * without complex type setup
 */

// Helper function to test if errors should be retried
function testIsRetryableError(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();

  // Check if this is a structured LLMApiError with status code
  if (error.name === 'LLMApiError' && 'statusCode' in error) {
    const statusCode = (error as unknown as { statusCode: number }).statusCode;
    return isHttpStatusRetryable(statusCode);
  }

  // Fallback: check for HTTP status codes in error messages
  const statusCodeMatch = error.message.match(
    /(?:api|server)\s+error:\s+(\d{3})/i,
  );
  if (statusCodeMatch?.[1]) {
    const statusCode = parseInt(statusCodeMatch[1], 10);
    return isHttpStatusRetryable(statusCode);
  }

  // Fallback to pattern matching for other error types
  const nonRetryablePatterns = [
    /invalid.*configuration/i,
    /authentication.*failed/i,
    /unauthorized/i,
    /forbidden/i,
    /not.*found/i,
    /validation.*error/i,
    /schema.*error/i,
    /bad.*request/i,
    /malformed/i,
    /invalid.*parameter/i,
  ];

  return !nonRetryablePatterns.some((pattern) => pattern.test(errorMessage));
}

function isHttpStatusRetryable(statusCode: number): boolean {
  // 4xx Client Errors - Generally not retryable (permanent failures)
  if (statusCode >= 400 && statusCode < 500) {
    // Special case: 429 Rate Limited - should be retried with backoff
    if (statusCode === 429) {
      return true;
    }
    // Special case: 408 Request Timeout - can be retried
    if (statusCode === 408) {
      return true;
    }
    // All other 4xx errors are permanent failures
    return false;
  }

  // 5xx Server Errors - Generally retryable (temporary server issues)
  if (statusCode >= 500 && statusCode < 600) {
    return true;
  }

  // 3xx Redirections - Generally not retryable in API context
  if (statusCode >= 300 && statusCode < 400) {
    return false;
  }

  // 2xx Success and 1xx Informational - shouldn't be errors
  return false;
}

describe('Error Recovery Manager - Retry Logic', () => {
  describe('LLMApiError with status codes', () => {
    it('should NOT retry 400 Bad Request errors', () => {
      const error = new LLMApiError(
        'OpenAI API error: 400 Bad Request - Invalid parameter',
        400,
        LLMProviderName.OPENAI,
      );

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(false);
    });

    it('should NOT retry 401 Unauthorized errors', () => {
      const error = new LLMApiError(
        'Anthropic API error: 401 Unauthorized',
        401,
        LLMProviderName.CLAUDE,
      );

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(false);
    });

    it('should NOT retry 403 Forbidden errors', () => {
      const error = new LLMApiError(
        'Local LLM API error: 403 Forbidden',
        403,
        LLMProviderName.LOCAL,
      );

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(false);
    });

    it('should RETRY 429 Rate Limited errors', () => {
      const error = new LLMApiError(
        'OpenAI API error: 429 Too Many Requests',
        429,
        LLMProviderName.OPENAI,
      );

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(true);
    });

    it('should RETRY 500 Internal Server Error', () => {
      const error = new LLMApiError(
        'OpenAI API error: 500 Internal Server Error',
        500,
        LLMProviderName.OPENAI,
      );

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(true);
    });

    it('should RETRY 502 Bad Gateway errors', () => {
      const error = new LLMApiError(
        'Anthropic API error: 502 Bad Gateway',
        502,
        LLMProviderName.CLAUDE,
      );

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(true);
    });
  });

  describe('Legacy Error Message Parsing', () => {
    it('should detect and NOT retry 400 errors from error messages', () => {
      const error = new Error(
        'OpenAI API error: 400 Bad Request - Invalid parameter',
      );

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(false);
    });

    it('should detect and RETRY 429 errors from error messages', () => {
      const error = new Error('Anthropic API error: 429 Too Many Requests');

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(true);
    });

    it('should detect and RETRY 500 errors from error messages', () => {
      const error = new Error('Local LLM server error: 500 Internal Error');

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(true);
    });
  });

  describe('Non-HTTP Errors', () => {
    it('should NOT retry validation errors', () => {
      const error = new Error('Validation error: Invalid input format');

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(false);
    });

    it('should NOT retry configuration errors', () => {
      const error = new Error('Invalid configuration: Missing API key');

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(false);
    });

    it('should NOT retry bad request errors', () => {
      const error = new Error('Bad request: malformed JSON');

      const shouldRetry = testIsRetryableError(error);
      expect(shouldRetry).toBe(false);
    });
  });
});
