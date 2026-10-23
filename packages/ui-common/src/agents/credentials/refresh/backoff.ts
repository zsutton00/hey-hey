import { CredentialError } from "../errors";

export interface RetryBackoffOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitterRatio: number;
}

export const DEFAULT_RETRY_BACKOFF: RetryBackoffOptions = {
  maxAttempts: 4,
  initialDelayMs: 200,
  maxDelayMs: 4_000,
  multiplier: 2,
  jitterRatio: 0.15,
};

const wait = async (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

export const computeBackoffDelay = (
  attempt: number,
  options: RetryBackoffOptions
): number => {
  const exponential =
    options.initialDelayMs *
    Math.pow(options.multiplier, Math.max(0, attempt - 1));
  const capped = Math.min(exponential, options.maxDelayMs);
  const jitter = capped * options.jitterRatio;
  const lowerBound = Math.max(0, capped - jitter);
  const upperBound = capped + jitter;
  const randomized = lowerBound + Math.random() * (upperBound - lowerBound);
  return Math.round(randomized);
};

export interface RetryExecutionOptions {
  backoff?: Partial<RetryBackoffOptions>;
  shouldRetry?: (error: unknown) => boolean;
}

export const retryWithBackoff = async <T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryExecutionOptions = {}
): Promise<T> => {
  const backoff: RetryBackoffOptions = {
    ...DEFAULT_RETRY_BACKOFF,
    ...(options.backoff ?? {}),
  };

  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= backoff.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      const isRetryableError =
        error instanceof CredentialError ? error.retryable : shouldRetry(error);
      const hasAttemptsRemaining = attempt < backoff.maxAttempts;

      if (!isRetryableError || !hasAttemptsRemaining) {
        throw error;
      }

      const delayMs = computeBackoffDelay(attempt, backoff);
      await wait(delayMs);
    }
  }

  throw (
    lastError ?? new Error("Retry operation failed without an explicit error")
  );
};
