import {
  getConversationMessageHistorySnapshot,
  getPendingOlderConversationMessageCursor,
  loadOlderConversationMessageHistory,
  preserveConversationMessageHistoryOnRefresh,
  recordInitialConversationMessageHistoryPage,
  recordOlderConversationMessageHistoryPage,
  resetConversationMessageHistoryStateForTests,
} from "../conversationMessageHistoryState";

describe("conversationMessageHistoryState", () => {
  const key = "org:project:conversation";

  beforeEach(() => resetConversationMessageHistoryStateForTests());

  it("keeps the oldest continuation stable across recent-page refreshes", () => {
    recordInitialConversationMessageHistoryPage(key, "oldest-known");
    preserveConversationMessageHistoryOnRefresh(key, "recent-page-cursor");

    expect(getConversationMessageHistorySnapshot(key).nextCursor).toBe(
      "oldest-known"
    );
  });

  it("coalesces concurrent older-page loads and advances once", async () => {
    recordInitialConversationMessageHistoryPage(key, "page-2");
    let resolveLoad: (() => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        })
    );

    const first = loadOlderConversationMessageHistory(key, load);
    const second = loadOlderConversationMessageHistory(key, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(getPendingOlderConversationMessageCursor(key)).toBe("page-2");

    recordOlderConversationMessageHistoryPage(key, "page-3");
    resolveLoad?.();
    await Promise.all([first, second]);
    expect(getConversationMessageHistorySnapshot(key)).toEqual({
      nextCursor: "page-3",
      isLoadingOlder: false,
      error: null,
      initialized: true,
    });
  });

  it("retains the cursor after failure so the user can retry", async () => {
    recordInitialConversationMessageHistoryPage(key, "retry-cursor");
    const failure = new Error("network failed");

    await expect(
      loadOlderConversationMessageHistory(key, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(getConversationMessageHistorySnapshot(key)).toEqual({
      nextCursor: "retry-cursor",
      isLoadingOlder: false,
      error: failure,
      initialized: true,
    });

    await loadOlderConversationMessageHistory(key, async () => {
      recordOlderConversationMessageHistoryPage(key, undefined);
    });
    expect(getConversationMessageHistorySnapshot(key).nextCursor).toBeNull();
    expect(getConversationMessageHistorySnapshot(key).error).toBeNull();
  });
});
