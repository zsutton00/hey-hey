import type {
  AgentCredentialRecord,
  AgentType,
  CredentialRefreshResult,
} from "../types";
import { CredentialError, isCredentialError } from "../errors";
import {
  retryWithBackoff,
  type RetryBackoffOptions,
  type RetryExecutionOptions,
} from "./backoff";
import type { AgentCredentialRefresher } from "./providers";

export interface TokenRefreshServiceOptions {
  refreshers: Partial<Record<AgentType, AgentCredentialRefresher>>;
  timeoutMs?: number;
  retryBackoff?: Partial<RetryBackoffOptions>;
}

export class TokenRefreshService {
  private readonly refreshers: Partial<
    Record<AgentType, AgentCredentialRefresher>
  >;
  private readonly timeoutMs: number;
  private readonly retryOptions: RetryExecutionOptions;

  constructor(options: TokenRefreshServiceOptions) {
    this.refreshers = options.refreshers;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retryOptions = {
      backoff: options.retryBackoff,
      shouldRetry: (error: unknown) => {
        if (isCredentialError(error)) {
          return error.retryable;
        }
        return true;
      },
    };
  }

  async refreshCredential(
    credential: AgentCredentialRecord
  ): Promise<CredentialRefreshResult> {
    const refresher = this.refreshers[credential.agentType];

    if (!refresher) {
      throw new CredentialError(
        "REFRESH_FAILED",
        `No token refresher registered for ${credential.agentType}`
      );
    }

    return retryWithBackoff(async (attempt) => {
      try {
        return await this.refreshWithTimeout(refresher, credential);
      } catch (error) {
        if (isCredentialError(error)) {
          throw new CredentialError(error.code, error.message, {
            ...error.details,
            attempt,
          });
        }

        throw new CredentialError(
          "REFRESH_FAILED",
          error instanceof Error ? error.message : "Unknown refresh error",
          { attempt }
        );
      }
    }, this.retryOptions);
  }

  private async refreshWithTimeout(
    refresher: AgentCredentialRefresher,
    credential: AgentCredentialRecord
  ): Promise<CredentialRefreshResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      return await refresher.refresh(credential, {
        signal: controller.signal,
      });
    } catch (error) {
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" || controller.signal.aborted);
      if (isAbort) {
        throw new CredentialError(
          "REFRESH_FAILED",
          `Token refresh timed out after ${this.timeoutMs}ms`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
