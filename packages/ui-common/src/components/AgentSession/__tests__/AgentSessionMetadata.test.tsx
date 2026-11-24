import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionMetadata,
  type AgentSessionMetadataPlacement,
  type AgentSessionServicePlaceEntry,
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

const mixedPlaces: AgentSessionServicePlaceEntry[] = [
  { serviceName: "hey-hey", place: { kind: "worktree", branch: "feature-x" } },
  { serviceName: "demos", place: { kind: "main-folder", branch: "dev" } },
  { serviceName: "docs", place: { kind: "main-folder", branch: null } },
  { serviceName: "infra", place: { kind: "not-recorded" } },
];

const renderMetadata = (
  placement: AgentSessionMetadataPlacement,
  effort?: "low" | "medium" | "high" | "xhigh" | "max",
  fastMode?: boolean,
  servicePlaces?: readonly AgentSessionServicePlaceEntry[],
) =>
  render(
    <AgentSessionMetadata
      placement={placement}
      provider="codex"
      model="claude-opus-4-7"
      {...(effort ? { effort } : {})}
      {...(fastMode !== undefined ? { fastMode } : {})}
      {...(servicePlaces ? { servicePlaces } : {})}
    />,
  );

describe("AgentSessionMetadata", () => {
  it.each(["below-composer", "below-conversation"] as const)(
    "supports the %s placement",
    (placement) => {
      setViewport(false);

      renderMetadata(placement, "high", true, mixedPlaces);

      expect(
        screen.queryByTestId("agent-session-metadata-mobile-toggle"),
      ).not.toBeInTheDocument();
      const root = screen.getByTestId("agent-session-metadata");
      expect(root).toHaveAttribute("data-placement", placement);
      expect(
        screen.getByTestId("agent-session-metadata-provider"),
      ).toHaveTextContent("codex");
      expect(
        screen.getByTestId("agent-session-metadata-model"),
      ).toHaveTextContent("claude-opus-4-7");
      expect(
        screen.getByTestId("agent-session-metadata-effort"),
      ).toHaveTextContent("high");
      expect(
        screen.getByTestId("agent-session-metadata-fast"),
      ).toHaveTextContent("fast");
      expect(
        screen.getByTestId("agent-session-metadata-place-worktree"),
      ).toHaveTextContent("hey-hey: feature-x");
      expect(
        screen.getByTestId("agent-session-metadata-place-main"),
      ).toHaveTextContent("demos: dev");
      expect(
        screen.getByTestId("agent-session-metadata-place-detached"),
      ).toHaveTextContent("docs: detached");
      expect(
        screen.getByTestId("agent-session-metadata-place-not-recorded"),
      ).toHaveTextContent("infra: Not recorded");
    },
  );

  it("omits unset effort and does not render a placeholder", () => {
    setViewport(false);

    renderMetadata("below-conversation");

    expect(
      screen.getByTestId("agent-session-metadata-provider"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-metadata-model"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-metadata-effort"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-metadata-fast"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/unknown|not set|default/i),
    ).not.toBeInTheDocument();
  });

  it("uses an info-icon popover disclosure at a 375px mobile width", () => {
    setViewport(true);

    renderMetadata("below-composer", "high", true, mixedPlaces);

    const toggle = screen.getByTestId("agent-session-metadata-mobile-toggle");
    const root = screen.getByTestId("agent-session-metadata");
    expect(toggle).toHaveAttribute("aria-label", "Show more details");
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("agent-session-metadata-mobile-details"),
    ).not.toBeInTheDocument();
    expect(getComputedStyle(root).overflow).toBe("hidden");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-label", "Hide more details");
    expect(
      screen.getByTestId("agent-session-metadata-mobile-details"),
    ).toHaveTextContent("Modelclaude-opus-4-7");
    expect(
      screen.getByTestId("agent-session-metadata-mobile-details"),
    ).toHaveTextContent("Providercodex");
    expect(
      screen.getByTestId("agent-session-metadata-mobile-details"),
    ).toHaveTextContent("Reasoning efforthigh");
    expect(
      screen.getByTestId("agent-session-metadata-mobile-details"),
    ).toHaveTextContent("Fast modefast");
    const details = screen.getByTestId("agent-session-metadata-mobile-details");
    expect(details).toHaveTextContent("Where each Service works");
    expect(details).toHaveTextContent("hey-heyfeature-x");
    expect(details).toHaveTextContent("demosdev");
    expect(details).toHaveTextContent("docsdetached");
    expect(details).toHaveTextContent("infraNot recorded");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("copies the branch from a worktree entry's copy button", async () => {
    setViewport(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderMetadata("below-conversation", undefined, undefined, mixedPlaces);

    fireEvent.click(screen.getByTestId("agent-session-metadata-place-copy-0"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("feature-x");
    });
    expect(
      screen.queryByTestId("agent-session-metadata-place-copy-1"),
    ).not.toBeInTheDocument();
  });
});
