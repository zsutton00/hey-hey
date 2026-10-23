import { describe, it, expect } from "vitest";
import {
  classifySessionError,
  NO_CLI_CONNECTION_CODE,
} from "../classifySessionError";

describe("classifySessionError", () => {
  it("surfaces NO_CLI_CONNECTION as an actionable, non-error state keyed off the code", () => {
    const result = classifySessionError(
      "Conversation owner has no active CLI websocket connection",
      NO_CLI_CONNECTION_CODE
    );
    expect(result.severity).toBe("info");
    expect(result.title).toBe("Your coding agent isn't connected");
    expect(result.description).toMatch(/start your agent cli/i);
    expect(result.retryable).toBe(true);
  });

  it("ignores the NO_CLI_CONNECTION message text when no code is provided", () => {
    const result = classifySessionError(
      "Conversation owner has no active CLI websocket connection"
    );
    expect(result.severity).toBe("error");
    expect(result.title).toBe("Something went wrong");
  });

  it("classifies fetch failed with RETRYABLE type", () => {
    const result = classifySessionError(
      "Agent execution failed: fetch failed (Type: RETRYABLE)"
    );
    expect(result.severity).toBe("warning");
    expect(result.title).toBe("Connection to the agent failed");
    expect(result.retryable).toBe(true);
    expect(result.raw).toBe(
      "Agent execution failed: fetch failed (Type: RETRYABLE)"
    );
  });

  it("classifies rate limited errors", () => {
    const result = classifySessionError(
      "Agent execution failed: rate limited (Type: RATE_LIMITED)"
    );
    expect(result.severity).toBe("warning");
    expect(result.title).toBe("Rate limit reached");
    expect(result.retryable).toBe(true);
  });

  it("classifies timeout errors", () => {
    const result = classifySessionError(
      "Agent execution failed: operation timed out (Type: TIMEOUT)"
    );
    expect(result.severity).toBe("warning");
    expect(result.title).toBe("Agent timed out");
    expect(result.retryable).toBe(true);
  });

  it("classifies generic retryable errors", () => {
    const result = classifySessionError(
      "Agent execution failed: transient error (Type: RETRYABLE)"
    );
    expect(result.severity).toBe("warning");
    expect(result.title).toBe("Something went wrong");
    expect(result.retryable).toBe(true);
    expect(result.description).toContain("transient error");
  });

  it("classifies non-retryable agent execution failures", () => {
    const result = classifySessionError(
      "Agent execution failed: invalid configuration"
    );
    expect(result.severity).toBe("error");
    expect(result.title).toBe("Agent execution failed");
    expect(result.description).toBe("invalid configuration");
    expect(result.retryable).toBe(false);
  });

  it("classifies unknown errors", () => {
    const result = classifySessionError(
      "Repository mapping is required for this service."
    );
    expect(result.severity).toBe("error");
    expect(result.title).toBe("Something went wrong");
    expect(result.description).toBe(
      "Repository mapping is required for this service."
    );
    expect(result.retryable).toBe(false);
  });

  it("preserves raw error string", () => {
    const raw = "Agent execution failed: fetch failed (Type: RETRYABLE)";
    const result = classifySessionError(raw);
    expect(result.raw).toBe(raw);
  });
});
