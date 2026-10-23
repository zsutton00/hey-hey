import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HelpNodeWithBody } from "../../../api";
import type { UseHelpNodeReturn } from "../../../data/hooks";
import { useHelpNode } from "../../../data/hooks";
import type { HelpTopicListItem } from "../helpContentSource";
import { HelpTopicCard } from "../HelpTopicCard";

vi.mock("../../../data/hooks", () => ({
  useHelpNode: vi.fn(),
}));

const mockedUseHelpNode = vi.mocked(useHelpNode);

const topic: HelpTopicListItem = {
  id: "topic-id",
  slug: "security",
  slugPath: "security/recovery",
  readKey: "security/recovery",
  title: "Recovery",
  parentId: "security-id",
  ordering: 1,
  depth: 1,
  number: 1,
  scenario: {
    id: "topic-id",
    title: "Recovery",
    deepContent: "Stale static security guidance must not render.",
  },
  node: {
    id: "topic-id",
    parentId: "security-id",
    slug: "recovery",
    title: "Recovery",
    ordering: 1,
  },
};

const node: HelpNodeWithBody = {
  ...topic.node,
  body: [
    "## Recovery",
    "",
    "- Keep the data boundary explicit.",
    "- Run `heyhey verify`.",
    "",
    "[Read more](https://example.com/recovery)",
    "[Unsafe](javascript:alert(1))",
    "",
    "![Guide diagram](assets/agent-bridge-overview.svg)",
  ].join("\n"),
  demos: [],
};

const helpNodeReturn = (
  overrides: Partial<UseHelpNodeReturn> = {}
): UseHelpNodeReturn => ({
  data: node,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(async () => node),
  markStale: vi.fn(),
  ...overrides,
});

describe("HelpTopicCard", () => {
  beforeEach(() => {
    mockedUseHelpNode.mockReturnValue(helpNodeReturn());
  });

  it("reads the exact topic key and renders the persisted Markdown body", () => {
    render(<HelpTopicCard topic={topic} />);

    expect(mockedUseHelpNode).toHaveBeenCalledWith("security/recovery");
    expect(
      screen.getByRole("heading", { name: "Recovery" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Keep the data boundary explicit\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/heyhey verify/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read more" })).toHaveAttribute(
      "href",
      "https://example.com/recovery"
    );
    expect(screen.getByText("Unsafe").closest("a")).toHaveAttribute("href", "");
    expect(screen.getByRole("img", { name: "Guide diagram" })).toHaveAttribute(
      "src",
      expect.stringContaining("/help/assets/agent-bridge-overview.svg")
    );
    expect(
      screen.queryByText("Stale static security guidance must not render.")
    ).toBeNull();
  });

  it("renders an explicit loading state without a body fallback", () => {
    mockedUseHelpNode.mockReturnValue(
      helpNodeReturn({ data: null, isFetched: false, isLoading: true })
    );

    render(<HelpTopicCard topic={topic} />);

    expect(screen.getByTestId("help-topic-loading-state")).toBeInTheDocument();
    expect(
      screen.queryByText("Stale static security guidance must not render.")
    ).toBeNull();
  });

  it("renders unavailable and retry states when the node has no data", () => {
    const refetch = vi.fn(async () => null);
    mockedUseHelpNode.mockReturnValue(
      helpNodeReturn({ data: null, isFetched: true, refetch })
    );

    render(<HelpTopicCard topic={topic} />);

    expect(
      screen.getByTestId("help-topic-unavailable-state")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("help-topic-retry-button"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders read failures explicitly and offers retry", () => {
    const refetch = vi.fn(async () => null);
    mockedUseHelpNode.mockReturnValue(
      helpNodeReturn({
        data: null,
        error: new Error("read failed"),
        isReady: false,
        refetch,
      })
    );

    render(<HelpTopicCard topic={topic} />);

    expect(screen.getByTestId("help-topic-error-state")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("help-topic-retry-button"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
