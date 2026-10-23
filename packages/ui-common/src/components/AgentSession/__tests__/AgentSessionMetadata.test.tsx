import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionMetadata,
  type AgentSessionMetadataPlacement,
} from "../AgentSessionMetadata";

const originalMatchMedia = window.matchMedia;
const originalClipboard = navigator.clipboard;

const setViewport = (mobile: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(navigator, "clipboard", {
    value: originalClipboard,
    configurable: true,
  });
});

const renderMetadata = (
  placement: AgentSessionMetadataPlacement,
  effort?: "low" | "medium" | "high" | "xhigh" | "max",
  fastMode?: boolean,
  worktree?: string
) =>
  render(
    <AgentSessionMetadata
      placement={placement}
      provider="codex"
      model="claude-opus-4-7"
      serviceNames={["API", "Web UI"]}
      {...(effort ? { effort } : {})}
      {...(fastMode !== undefined ? { fastMode } : {})}
      {...(worktree ? { worktree } : {})}
    />
  );

describe("AgentSessionMetadata", () => {
  it.each(["below-composer", "below-conversation"] as const)(
    "supports the %s placement",
    (placement) => {
      setViewport(false);

      renderMetadata(placement, "high", true, "feature/current-worktree");

      expect(
        screen.getAllByTestId("agent-session-metadata-service")
          .map((node) => node.textContent)
      ).toEqual(["API", "Web UI"]);
      expect(
        screen.queryByTestId("agent-session-metadata-mobile-toggle")
      ).not.toBeInTheDocument();
      const root = screen.getByTestId("agent-session-metadata");
      expect(root).toHaveAttribute("data-placement", placement);
      expect(
        screen.getByTestId("agent-session-metadata-provider")
      ).toHaveTextContent("codex");
      expect(
        screen.getByTestId("agent-session-metadata-model")
      ).toHaveTextContent("claude-opus-4-7");
      expect(
        screen.getByTestId("agent-session-metadata-effort")
      ).toHaveTextContent("high");
      expect(screen.getByTestId("agent-session-metadata-fast")).toHaveTextContent(
        "fast"
      );
      expect(
        screen.getByTestId("agent-session-metadata-worktree")
      ).toHaveTextContent("feature/current-worktree");
    }
  );

  it("omits unset effort and does not render a placeholder", () => {
    setViewport(false);

    renderMetadata("below-conversation");

    expect(
      screen.getByTestId("agent-session-metadata-provider")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-metadata-model")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-metadata-effort")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-metadata-fast")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/unknown|not set|default/i)
    ).not.toBeInTheDocument();
  });

  it("uses an info-icon popover disclosure at a 375px mobile width", () => {
    setViewport(true);

    renderMetadata("below-composer", "high", true);

    const toggle = screen.getByTestId("agent-session-metadata-mobile-toggle");
    const root = screen.getByTestId("agent-session-metadata");
    expect(toggle).toHaveAttribute("aria-label", "Show more details");
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("agent-session-metadata-mobile-details")
    ).not.toBeInTheDocument();
    expect(getComputedStyle(root).overflow).toBe("hidden");

    fireEvent.click(toggle);

    expect(
      screen.getAllByTestId("agent-session-metadata-service")
        .map((node) => node.textContent)
    ).toEqual(["ServiceAPI", "ServiceWeb UI"]);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-label", "Hide more details");
    expect(
      screen.getByTestId("agent-session-metadata-mobile-details")
    ).toHaveTextContent("Modelclaude-opus-4-7");
    expect(
      screen.getByTestId("agent-session-metadata-mobile-details")
    ).toHaveTextContent("Providercodex");
    expect(
      screen.getByTestId("agent-session-metadata-mobile-details")
    ).toHaveTextContent("Reasoning efforthigh");
    expect(
      screen.getByTestId("agent-session-metadata-mobile-details")
    ).toHaveTextContent("Fast modefast");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("includes the worktree in mobile metadata details", () => {
    setViewport(true);

    renderMetadata(
      "below-conversation",
      "high",
      undefined,
      "feature/current-worktree"
    );

    fireEvent.click(screen.getByTestId("agent-session-metadata-mobile-toggle"));

    expect(
      screen.getByTestId("agent-session-metadata-worktree")
    ).toHaveTextContent("feature/current-worktree");
  });

  it("copies the worktree from the chip copy button", async () => {
    setViewport(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderMetadata(
      "below-conversation",
      undefined,
      undefined,
      "feature/current-worktree"
    );

    fireEvent.click(screen.getByTestId("agent-session-metadata-worktree-copy"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("feature/current-worktree");
    });
  });
});
