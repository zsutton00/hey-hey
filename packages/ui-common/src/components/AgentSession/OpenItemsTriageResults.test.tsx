import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageResponseDto, OpenItemsTriagePayload } from "../../api";
import {
  TriageApplicationCoordinator,
  type TriageApplicationPorts,
} from "../../data/triage/application";
import { OpenItemsTriageResults } from "./OpenItemsTriageResults";
import { latestOpenItemsTriageResult } from "./openItemsTriageResult";

const mocks = vi.hoisted(() => ({
  messages: [] as MessageResponseDto[],
  loading: false,
  error: null as Error | null,
  refetch: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("../../data/hooks/useConversation", () => ({
  useConversation: mocks.subscribe,
}));
vi.mock("../../data/hooks/useConversationMessages", () => ({
  useConversationMessages: () => ({
    orderedData: mocks.messages,
    isLoading: mocks.loading,
    error: mocks.error,
    refetch: mocks.refetch,
  }),
}));
const payload: OpenItemsTriagePayload = {
  summary: "Keep your working set focused.",
  suggestions: [
    {
      suggestionId: "remove",
      kind: "removeOpenItems",
      items: [
        { entityType: "TASK", entityId: "item", title: "Delivered work" },
      ],
      rationale: "Finished",
      evidence: [{ kind: "attention", summary: "No recent views" }],
    },
  ],
};
function reply(id: string, result: OpenItemsTriagePayload): MessageResponseDto {
  return {
    id,
    type: "SYSTEM",
    status: "COMPLETED",
    conversationId: "conversation",
    createdAt: "2026-10-14T08:00:00Z",
    awaitingResponse: false,
    data: {
      type: "QUESTIONS",
      uiElements: [
        { id: "triage", type: "open_items_triage", payload: result },
      ],
    },
  };
}
function setup() {
  const ports: TriageApplicationPorts = {
    refresh: vi.fn().mockResolvedValue(undefined),
    target: () => ({ open: true, groupId: null, pinned: false }),
    groupExists: () => true,
    remove: vi.fn().mockResolvedValue(undefined),
    reopen: vi.fn(),
    createGroup: vi.fn(),
    group: vi.fn(),
    createGoal: vi.fn(),
    track: vi.fn(),
    promote: vi.fn(),
    revalidateGoals: vi.fn().mockResolvedValue(undefined),
  };
  const onSend = vi.fn().mockResolvedValue(undefined);
  const props = {
    organizationId: "org",
    projectId: "project",
    conversationId: "conversation",
    application: new TriageApplicationCoordinator(ports),
    itemHref: () => "/work/item",
    pending: false,
    disabled: false,
    onSend,
  };
  return { props, ports, onSend };
}
describe("feature-owned triage results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messages = [];
    mocks.loading = false;
    mocks.error = null;
  });
  it("shows generation followed by structured suggestions, without an execution transcript", async () => {
    const { props, ports } = setup();
    const view = render(<OpenItemsTriageResults {...props} pending />);
    expect(screen.getByTestId("triage-generating")).toBeInTheDocument();
    expect(screen.getByTestId("triage-send")).toBeDisabled();
    mocks.messages = [reply("output", payload)];
    view.rerender(<OpenItemsTriageResults {...props} />);
    expect(screen.getByText(payload.summary)).toBeInTheDocument();
    expect(screen.getByText(/No recent views/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Delivered work" }),
    ).toHaveAttribute("href", "/work/item");
    expect(ports.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(ports.remove).toHaveBeenCalledOnce());
    expect(await screen.findByText("Applied")).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledWith("org", "project", {
      conversationId: "conversation",
    });
  });
  it("shows only the thinking animation before any narration, then this review's narration only", () => {
    const { props } = setup();
    const narration = (id: string, createdAt: string, text: string) =>
      ({
        id,
        type: "SYSTEM",
        status: "COMPLETED",
        conversationId: "conversation",
        createdAt,
        awaitingResponse: false,
        data: {
          type: "AGENT",
          response: text,
          uiElements: [{ id: `${id}-ui`, type: "interstitial" }],
        },
      }) as unknown as MessageResponseDto;
    const request = {
      id: "fresh",
      type: "USER",
      status: "COMPLETED",
      conversationId: "conversation",
      createdAt: "2026-10-14T09:00:00Z",
      awaitingResponse: false,
      data: {},
    } as MessageResponseDto;
    mocks.messages = [
      narration("earlier", "2026-10-14T08:00:00Z", "Earlier review thought"),
      request,
    ];
    const view = render(
      <OpenItemsTriageResults
        {...props}
        pending
        requestMessageIds={["fresh"]}
      />,
    );
    expect(screen.getByTestId("thinking-indicator-gif")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-narration")).not.toBeInTheDocument();
    mocks.messages = [
      ...mocks.messages,
      narration("current", "2026-10-14T09:00:10Z", "Looking at your items"),
    ];
    view.rerender(
      <OpenItemsTriageResults
        {...props}
        pending
        requestMessageIds={["fresh"]}
      />,
    );
    expect(screen.getByText("Looking at your items")).toBeInTheDocument();
    expect(
      screen.queryByText("Earlier review thought"),
    ).not.toBeInTheDocument();
  });
  it("keeps a failed follow-up for retry and clears it after a successful send without applying suggestions", async () => {
    const { props, ports, onSend } = setup();
    onSend.mockRejectedValueOnce(new Error("Launch failed"));
    render(<OpenItemsTriageResults {...props} />);
    await userEvent.type(
      screen.getByTestId("triage-follow-up"),
      "Keep active work",
    );
    await userEvent.click(screen.getByTestId("triage-send"));
    expect(screen.getByTestId("triage-follow-up")).toHaveValue(
      "Keep active work",
    );
    await userEvent.click(screen.getByTestId("triage-send"));
    await waitFor(() =>
      expect(screen.getByTestId("triage-follow-up")).toHaveValue(""),
    );
    expect(onSend).toHaveBeenCalledWith("Keep active work");
    expect(ports.remove).not.toHaveBeenCalled();
  });
  it("shows a defined load failure and retries", async () => {
    mocks.error = new Error("Fetch failed");
    render(<OpenItemsTriageResults {...setup().props} />);
    expect(screen.getByTestId("triage-results-error")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
  it("renders only the open review's correlated reply and reports its presence", () => {
    const { props } = setup();
    const onResultPresenceChange = vi.fn();
    mocks.messages = [reply("old", payload)];
    const view = render(
      <OpenItemsTriageResults
        {...props}
        requestMessageIds={["fresh"]}
        onResultPresenceChange={onResultPresenceChange}
      />,
    );
    expect(screen.queryByText(payload.summary)).not.toBeInTheDocument();
    expect(screen.queryByTestId("triage-empty")).not.toBeInTheDocument();
    expect(onResultPresenceChange).toHaveBeenLastCalledWith(false);
    mocks.messages = [
      reply("old", payload),
      { ...reply("new", payload), parentMessageId: "fresh" },
    ];
    view.rerender(
      <OpenItemsTriageResults
        {...props}
        requestMessageIds={["fresh"]}
        onResultPresenceChange={onResultPresenceChange}
      />,
    );
    expect(screen.getByText(payload.summary)).toBeInTheDocument();
    expect(onResultPresenceChange).toHaveBeenLastCalledWith(true);
  });
  it("uses the latest structured triage result and ignores ordinary agent messages", () => {
    const newer = { ...payload, summary: "Updated suggestions" };
    const transcript = {
      ...reply("transcript", payload),
      data: {
        type: "QUESTIONS" as const,
        response: "Internal execution detail",
      },
    };
    expect(
      latestOpenItemsTriageResult([
        reply("old", payload),
        reply("new", newer),
        transcript,
      ])?.payload,
    ).toEqual(newer);
  });
});
