import { describe, expect, it, vi } from "vitest";
import {
  navigateToConversationTarget,
  revealLatestConversationContent,
  waitForConversationTarget,
} from "../conversationScrollController";

describe("explicit conversation moves", () => {
  it("moves only the declared owner and accounts for its border", () => {
    const outer = document.createElement("div");
    const owner = document.createElement("div");
    const target = document.createElement("div");
    outer.append(owner);
    owner.append(target);
    const outerScroll = vi.fn();
    outer.scrollTo = outerScroll;
    owner.scrollTo = vi.fn();
    owner.scrollTop = 100;
    Object.defineProperties(owner, {
      clientTop: { value: 2 },
      scrollHeight: { value: 1800 },
    });
    vi.spyOn(owner, "getBoundingClientRect").mockReturnValue({
      top: 30,
    } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 280,
    } as DOMRect);
    navigateToConversationTarget(owner, target);
    expect(owner.scrollTo).toHaveBeenCalledWith({
      top: 348,
      behavior: "smooth",
    });
    revealLatestConversationContent(owner);
    expect(owner.scrollTo).toHaveBeenLastCalledWith({
      top: 1800,
      behavior: "instant",
    });
    expect(outerScroll).not.toHaveBeenCalled();
    expect(owner.style.overflowAnchor).toBe("");
    navigateToConversationTarget(owner, outer);
    expect(owner.scrollTo).toHaveBeenCalledTimes(2);
  });

  it("waits for one mount and stops observing after the explicit move", async () => {
    const owner = document.createElement("div");
    const mounted = vi.fn();
    const stop = waitForConversationTarget(
      owner,
      () => owner.querySelector("article"),
      mounted
    );
    owner.append(document.createElement("article"));
    await Promise.resolve();
    expect(mounted).toHaveBeenCalledOnce();
    owner.append(document.createElement("p"));
    await Promise.resolve();
    expect(mounted).toHaveBeenCalledOnce();
    stop();
  });

  it("cancels a delayed move on cleanup", async () => {
    const owner = document.createElement("div");
    const mounted = vi.fn();
    waitForConversationTarget(
      owner,
      () => owner.querySelector("article"),
      mounted
    )();
    owner.append(document.createElement("article"));
    await Promise.resolve();
    expect(mounted).not.toHaveBeenCalled();
  });
});
