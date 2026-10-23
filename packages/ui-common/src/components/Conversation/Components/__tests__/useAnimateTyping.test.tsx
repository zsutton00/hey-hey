import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAnimateTyping } from "../useAnimateTyping";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("useAnimateTyping", () => {
  it("renders full text immediately when typing animation is disabled", async () => {
    const { result } = renderHook(() =>
      useAnimateTyping({
        isThinking: false,
        text: "Hello world",
        enableTypingAnimation: false,
        type: "QUESTIONS",
      })
    );

    await waitFor(() => {
      expect(result.current.displayedText).toBe("Hello world");
    });
  });
});
