import {
  useAcknowledgeAgentSessionOutputAttention,
  useAgentSessionOutputAttentions,
} from "@hey-hey/ui-common/data";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAcknowledgeAgentSessionOutputAttentionOnOpen } from "./useAcknowledgeAgentSessionOutputAttentionOnOpen";

vi.mock("@hey-hey/ui-common/data", () => ({
  useAcknowledgeAgentSessionOutputAttention: vi.fn(),
  useAgentSessionOutputAttentions: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn() },
}));

const useAcknowledgeMock = vi.mocked(useAcknowledgeAgentSessionOutputAttention);
const useOutputAttentionsMock = vi.mocked(useAgentSessionOutputAttentions);

const setVisibility = (visibilityState: DocumentVisibilityState): void => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
};

const renderAttentionHook = () =>
  renderHook(() =>
    useAcknowledgeAgentSessionOutputAttentionOnOpen({
      organizationId: "organization-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      enabled: true,
    }),
  );

describe("useAcknowledgeAgentSessionOutputAttentionOnOpen", () => {
  const acknowledge = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    vi.clearAllMocks();
    acknowledge.mockResolvedValue(undefined);
    useAcknowledgeMock.mockReturnValue(acknowledge);
    useOutputAttentionsMock.mockReturnValue({});
    setVisibility("visible");
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("acknowledges the initial canonical open even when hidden and unfocused", async () => {
    setVisibility("hidden");
    const hasFocus = vi.mocked(document.hasFocus);
    hasFocus.mockReturnValue(false);

    renderAttentionHook();

    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
    expect(useAcknowledgeMock).toHaveBeenCalledWith(
      "organization-1",
      "project-1",
      "session-1",
    );
  });

  it("keeps the subscribed session ID array stable across renders", async () => {
    const { rerender } = renderAttentionHook();

    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
    const firstIds = useOutputAttentionsMock.mock.calls.at(-1)?.[2];
    rerender();
    const secondIds = useOutputAttentionsMock.mock.calls.at(-1)?.[2];

    expect(secondIds).toBe(firstIds);
  });

  it("defers later MESSAGE_READY acknowledgment until the document is visible", async () => {
    useOutputAttentionsMock.mockReturnValue({
      "session-1": {
        state: "NONE",
        revision: 1,
        changedAt: "2026-08-14T20:00:00.000Z",
      },
    });
    const { rerender } = renderAttentionHook();
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));

    setVisibility("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    useOutputAttentionsMock.mockReturnValue({
      "session-1": {
        state: "MESSAGE_READY",
        revision: 2,
        changedAt: "2026-08-14T20:01:00.000Z",
      },
    });
    rerender();
    expect(acknowledge).toHaveBeenCalledTimes(1);

    act(() => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
  });

  it("acknowledges later MESSAGE_READY while the visible window is unfocused", async () => {
    const hasFocus = vi.mocked(document.hasFocus);
    useOutputAttentionsMock.mockReturnValue({
      "session-1": {
        state: "NONE",
        revision: 1,
        changedAt: "2026-08-14T20:00:00.000Z",
      },
    });
    const { rerender } = renderAttentionHook();
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));

    act(() => {
      hasFocus.mockReturnValue(false);
      window.dispatchEvent(new Event("blur"));
    });
    useOutputAttentionsMock.mockReturnValue({
      "session-1": {
        state: "MESSAGE_READY",
        revision: 2,
        changedAt: "2026-08-14T20:01:00.000Z",
      },
    });
    rerender();

    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
  });

  it("queues a newer MESSAGE_READY revision behind an in-flight canonical open", async () => {
    let resolveInitial: (() => void) | undefined;
    acknowledge
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveInitial = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    useOutputAttentionsMock.mockReturnValue({});
    const { rerender } = renderAttentionHook();
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));

    useOutputAttentionsMock.mockReturnValue({
      "session-1": {
        state: "MESSAGE_READY",
        revision: 2,
        changedAt: "2026-08-14T20:01:00.000Z",
      },
    });
    rerender();
    expect(acknowledge).toHaveBeenCalledTimes(1);

    await act(async () => resolveInitial?.());

    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
  });

  it("acknowledges each newer MESSAGE_READY revision once", async () => {
    useOutputAttentionsMock.mockReturnValue({
      "session-1": {
        state: "NONE",
        revision: 1,
        changedAt: "2026-08-14T20:00:00.000Z",
      },
    });
    const { rerender } = renderAttentionHook();
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));

    useOutputAttentionsMock.mockReturnValue({
      "session-1": {
        state: "MESSAGE_READY",
        revision: 2,
        changedAt: "2026-08-14T20:01:00.000Z",
      },
      "session-2": {
        state: "MESSAGE_READY",
        revision: 9,
        changedAt: "2026-08-14T20:01:00.000Z",
      },
    });
    rerender();
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));

    rerender();
    await act(async () => undefined);
    expect(acknowledge).toHaveBeenCalledTimes(2);
  });

  it("does not acknowledge a preview surface", () => {
    renderHook(() =>
      useAcknowledgeAgentSessionOutputAttentionOnOpen({
        organizationId: "organization-1",
        projectId: "project-1",
        agentSessionId: "session-1",
        enabled: false,
      }),
    );

    expect(acknowledge).not.toHaveBeenCalled();
    expect(useOutputAttentionsMock).toHaveBeenCalledWith(
      "organization-1",
      "project-1",
      ["session-1"],
      { enabled: false },
    );
  });

  it("retries a transient acknowledgment failure", async () => {
    vi.useFakeTimers();
    acknowledge
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);

    renderAttentionHook();
    await vi.advanceTimersByTimeAsync(250);

    expect(acknowledge).toHaveBeenCalledTimes(2);
  });

  it("does not cancel a later acknowledgment retry when visibility changes", async () => {
    acknowledge
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    useOutputAttentionsMock.mockReturnValue({});
    const { rerender } = renderAttentionHook();
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    useOutputAttentionsMock.mockReturnValue({
      "session-1": {
        state: "MESSAGE_READY",
        revision: 2,
        changedAt: "2026-08-14T20:01:00.000Z",
      },
    });
    rerender();
    await act(async () => undefined);
    expect(acknowledge).toHaveBeenCalledTimes(2);

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(acknowledge).toHaveBeenCalledTimes(3);
  });
});
