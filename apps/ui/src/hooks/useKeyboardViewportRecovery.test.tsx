import { act, cleanup, renderHook } from "@testing-library/react";
import { useKeyboardViewportRecovery } from "./useKeyboardViewportRecovery";

describe("useKeyboardViewportRecovery", () => {
  let viewport: EventTarget & { height: number; width: number; scale: number };
  let input: HTMLTextAreaElement;
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    viewport = Object.assign(new EventTarget(), {
      height: 800,
      width: 390,
      scale: 1,
    });
    vi.stubGlobal("visualViewport", viewport);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "iPhone AppleWebKit Safari",
    );
    scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    input = document.createElement("textarea");
    document.body.append(input);
  });

  afterEach(() => {
    cleanup();
    input.remove();
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const resize = (height: number) => {
    viewport.height = height;
    act(() => {
      viewport.dispatchEvent(new Event("resize"));
      vi.advanceTimersToNextFrame();
    });
  };

  it("recovers once after dismissal, preserving the owned conversation position and focus", () => {
    renderHook(() => useKeyboardViewportRecovery(true));
    const conversation = document.createElement("div");
    conversation.scrollTop = 420;
    document.body.append(conversation);
    input.focus();
    resize(450);
    document.documentElement.scrollTop = 160;
    resize(600);
    expect(scrollTo).not.toHaveBeenCalled();
    resize(800);
    expect(document.documentElement.scrollTop).toBe(0);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 0,
      left: window.scrollX,
      behavior: "instant",
    });
    expect(conversation.scrollTop).toBe(420);
    expect(document.activeElement).toBe(input);
    resize(800);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    conversation.remove();
  });

  it("recovers after the focused editor unmounts while the keyboard closes", () => {
    renderHook(() => useKeyboardViewportRecovery(true));
    input.focus();
    resize(450);
    input.remove();
    resize(800);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("recognizes the rich-text composer and supports repeated keyboard cycles", () => {
    const editor = document.createElement("div");
    editor.tabIndex = 0;
    // jsdom does not implement isContentEditable.
    Object.defineProperty(editor, "isContentEditable", { value: true });
    document.body.append(editor);
    renderHook(() => useKeyboardViewportRecovery(true));
    editor.focus();
    resize(450);
    resize(800);
    resize(450);
    resize(800);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    editor.remove();
  });

  it("does not treat toolbar resizing or ordinary scrolling as keyboard dismissal", () => {
    renderHook(() => useKeyboardViewportRecovery(true));
    resize(450);
    resize(800);
    input.focus();
    resize(750);
    resize(800);
    act(() => {
      viewport.dispatchEvent(new Event("scroll"));
      vi.advanceTimersToNextFrame();
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it.each(["zoom", "rotation"])("abandons recovery during %s", (change) => {
    renderHook(() => useKeyboardViewportRecovery(true));
    input.focus();
    resize(450);
    if (change === "zoom") viewport.scale = 2;
    else viewport.width = 844;
    resize(800);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it.each(["disabled", "other browser", "missing API"])(
    "does nothing for %s",
    (condition) => {
      if (condition === "other browser")
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
          "Android Chrome",
        );
      if (condition === "missing API")
        vi.stubGlobal("visualViewport", undefined);
      renderHook(() => useKeyboardViewportRecovery(condition !== "disabled"));
      input.focus();
      resize(450);
      resize(800);
      expect(scrollTo).not.toHaveBeenCalled();
    },
  );

  it("cancels pending recovery and removes listeners on unmount", () => {
    const { unmount } = renderHook(() => useKeyboardViewportRecovery(true));
    input.focus();
    resize(450);
    viewport.height = 800;
    viewport.dispatchEvent(new Event("resize"));
    unmount();
    act(() => vi.advanceTimersToNextFrame());
    resize(450);
    resize(800);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
