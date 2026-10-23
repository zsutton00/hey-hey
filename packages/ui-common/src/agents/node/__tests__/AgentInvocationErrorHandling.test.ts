import { describe, expect, it } from "vitest";
import { CredentialError } from "../../credentials";
import type { AgentMessage } from "../../core";
import {
  classifyCredentialRefreshFailure,
  classifyAgentInvocationException,
  classifyAgentMessageError,
  toNormalizedAgentErrorEnvelope,
} from "../AgentInvocationErrorHandling";

const baseContext = {
  adapter: "codex",
  attempt: 1,
  maxAttempts: 3,
} as const;

const createErrorMessage = (
  subtype: string,
  payload: unknown
): AgentMessage => ({
  type: "error",
  subtype,
  sessionId: null,
  content: [{ kind: "error", payload }],
  timestamp: Date.now(),
});

describe("AgentInvocationErrorHandling", () => {
  it("classifies parser failures into parse_malformed", () => {
    const event = classifyAgentMessageError(
      createErrorMessage("parse_error", { message: "bad NDJSON" }),
      baseContext
    );

    expect(event).not.toBeNull();
    expect(event?.category).toBe("parse_malformed");
    expect(event?.reason).toBe("parse_error");
    expect(event?.retryable).toBe(false);
  });

  it("classifies timeout messages as retryable timeout failures", () => {
    const event = classifyAgentMessageError(
      createErrorMessage("timeout", { message: "operation timed out" }),
      baseContext
    );

    expect(event).not.toBeNull();
    expect(event?.category).toBe("timeout");
    expect(event?.reason).toBe("prompt_timeout");
    expect(event?.retryable).toBe(true);
    expect(event?.terminal).toBe(true);
  });

  it("classifies auth-like stderr as auth_failure", () => {
    const event = classifyAgentMessageError(
      createErrorMessage("stderr", { message: "401 unauthorized" }),
      baseContext
    );

    expect(event).not.toBeNull();
    expect(event?.category).toBe("auth_failure");
    expect(event?.reason).toBe("auth_invalid");
    expect(event?.suggestedAction).toBe("refresh_credentials");
  });

  it("classifies rate-limit exceptions from credential errors", () => {
    const event = classifyAgentInvocationException(
      new CredentialError("RATE_LIMITED", "too many requests", {
        statusCode: 429,
      }),
      baseContext
    );

    expect(event.category).toBe("rate_limit");
    expect(event.reason).toBe("rate_limited");
    expect(event.retryable).toBe(true);
  });

  it("produces compact and detailed normalized envelopes", () => {
    const event = classifyAgentInvocationException(
      new Error("network connection refused"),
      baseContext
    );

    const compact = toNormalizedAgentErrorEnvelope(event, "compact");
    const detailed = toNormalizedAgentErrorEnvelope(event, "detailed");

    expect(compact.error_type).toBe("network");
    expect(compact.error_reason).toBe("network_unreachable");
    expect("raw_subtype" in compact).toBe(false);

    expect(detailed.error_type).toBe("network");
    expect(detailed.error_reason).toBe("network_unreachable");
    expect("raw_subtype" in detailed).toBe(true);
  });

  it("maps credential refresh failures to auth failure reason", () => {
    const event = classifyCredentialRefreshFailure(
      new Error("refresh service offline"),
      baseContext,
      null
    );

    expect(event.category).toBe("auth_failure");
    expect(event.reason).toBe("credential_refresh_failed");
    expect(event.retryable).toBe(false);
    expect(event.suggestedAction).toBe("refresh_credentials");
  });
});
