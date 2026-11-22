import {
  getConversationMessageHistorySnapshot,
  loadOlderConversationMessageHistory,
  resetConversationMessageHistoryStateForTests,
} from "../conversationMessageHistoryState";

describe("conversationMessageHistoryState", () => {
  const key = "org:project:conversation";

  beforeEach(() => resetConversationMessageHistoryStateForTests());

  it("coalesces concurrent older-page loads into one", async () => {
    let finish: (() => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const first = loadOlderConversationMessageHistory(key, load);
    const second = loadOlderConversationMessageHistory(key, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(getConversationMessageHistorySnapshot(key).isLoadingOlder).toBe(
      true,
    );

    finish?.();
    await Promise.all([first, second]);
    expect(getConversationMessageHistorySnapshot(key)).toEqual({
      isLoadingOlder: false,
      error: null,
    });
  });

  it("reports a failed load and lets the user retry", async () => {
    const failure = new Error("network failed");

    await expect(
      loadOlderConversationMessageHistory(key, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(getConversationMessageHistorySnapshot(key)).toEqual({
      isLoadingOlder: false,
      error: failure,
    });

    await loadOlderConversationMessageHistory(key, async () => undefined);
    expect(getConversationMessageHistorySnapshot(key).error).toBeNull();
  });
});
