import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionCurrentState } from "../../../../api";
import { useTurnCompletionRevision } from "./useTurnCompletionRevision";

describe("useTurnCompletionRevision", () => {
  it("does not treat initial idle hydration as a completed Turn", () => {
    const onCompletion = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentState }) =>
        useTurnCompletionRevision(currentState, onCompletion),
      {
        initialProps: {
          currentState: undefined as AgentSessionCurrentState | undefined,
        },
      },
    );

    rerender({ currentState: AgentSessionCurrentState.Idle });
    expect(result.current).toBe(0);
    expect(onCompletion).not.toHaveBeenCalled();
  });

  it("increments and invokes the callback when an active Turn becomes idle", () => {
    const onCompletion = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentState }) =>
        useTurnCompletionRevision(currentState, onCompletion),
      {
        initialProps: {
          currentState: AgentSessionCurrentState.Thinking,
        },
      },
    );

    expect(result.current).toBe(0);
    rerender({ currentState: AgentSessionCurrentState.Idle });
    expect(result.current).toBe(1);
    expect(onCompletion).toHaveBeenCalledOnce();

    rerender({ currentState: AgentSessionCurrentState.Idle });
    expect(result.current).toBe(1);
    expect(onCompletion).toHaveBeenCalledOnce();
  });
});
