import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionType,
  EntityType,
  OpenItemGoalTrackedWorkFilter,
  type MessageResponseDto,
  type OpenItem,
  type OpenItemPresentation,
  type OpenItemsCollection,
  type OpenItemsTriageItem,
  type OpenItemsTriagePayload,
  type OpenItemsTriageSuggestion,
} from "../../api";
import {
  TriageApplicationCoordinator,
  type TriageApplicationPorts,
} from "../../data/triage/application";
import { legacyStatuses } from "../../test/fixtures/workItemStatuses";
import {
  OpenItemIcon,
  type WorkItemIconRegistry,
} from "../Entity/OpenItemIcon";
import { OpenItemsTriageResults } from "./OpenItemsTriageResults";
import { latestOpenItemsTriageResult } from "./openItemsTriageResult";

const peek = vi.hoisted(() => ({ canHover: true }));
vi.mock("../../hooks/useCanHover", () => ({
  useCanHover: () => peek.canHover,
}));
vi.mock("../shared/EntityHoverCard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/EntityHoverCard")>()),
  EntityHoverCard: (props: { entityId: string; entityType: string }) => (
    <div data-testid="entity-hover-card">
      {props.entityType}:{props.entityId}
    </div>
  ),
}));

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
const taskPresentation = (
  label: string,
  workItemTypeKey = "STANDARD",
): OpenItemPresentation => ({
  label,
  workItemTypeKey,
  agentSessionType: null,
  routeParams: { workItemRoute: "task" },
});
function openItem(
  id: string,
  presentation: OpenItemPresentation = taskPresentation(`Task ${id}`),
  entityType: EntityType = EntityType.Task,
): OpenItem {
  return {
    goalTrackedWorkFilter: OpenItemGoalTrackedWorkFilter.ActiveAndBacklog,
    goalCollapsed: false,
    entityType,
    entityId: id,
    note: null,
    pinned: false,
    position: `a${id}`,
    groupId: null,
    memberPosition: null,
    revision: 1,
    lineage: [],
    presentation,
    removedAt: null,
    updatedAt: "2026-10-14T08:00:00Z",
  };
}
const collectionOf = (items: OpenItem[]): OpenItemsCollection => ({
  state: "PRESENT",
  revision: 1,
  items,
  groups: [],
});
const task = (id: string): OpenItemsTriageItem => ({
  entityType: EntityType.Task,
  entityId: id,
  title: `Task ${id}`,
});
const removeOf = (id: string, ids: string[]): OpenItemsTriageSuggestion => ({
  suggestionId: id,
  kind: "removeOpenItems",
  items: ids.map(task),
  rationale: `Remove ${ids.join(", ")}`,
  evidence: [],
});
const workItemIcons: WorkItemIconRegistry = {
  definitions: new Map([
    [
      "STANDARD",
      {
        key: "STANDARD",
        name: "Task",
        sections: [],
        statuses: legacyStatuses([]),
        iconKey: "task",
      },
    ],
  ]),
  sources: new Map([["STANDARD", "CANONICAL"]]),
};
const card = (suggestionId: string) =>
  screen
    .getAllByTestId("triage-suggestion")
    .find((node) => node.getAttribute("data-suggestion-id") === suggestionId)!;
const checkboxOf = (suggestionId: string) =>
  within(card(suggestionId)).getByRole("checkbox");
const previewRows = (side: "before" | "after") =>
  within(screen.getByTestId(`triage-preview-${side}`)).queryAllByTestId(
    "triage-preview-row",
  );
const rowOf = (side: "before" | "after", key: string) =>
  previewRows(side).find((node) => node.getAttribute("data-row-key") === key);
const highlightedKeys = (side: "before" | "after") =>
  previewRows(side)
    .filter((node) => node.getAttribute("data-highlighted") === "true")
    .map((node) => node.getAttribute("data-row-key"));
function setup() {
  const ports: TriageApplicationPorts = {
    refresh: vi.fn().mockResolvedValue(undefined),
    target: () => ({ open: true, groupId: null, pinned: false }),
    groupExists: () => true,
    openCount: () => 1,
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
    collection: collectionOf([openItem("item")]),
    workItemIcons,
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
    expect(screen.queryByTestId("triage-follow-up")).not.toBeInTheDocument();
    mocks.messages = [reply("output", payload)];
    view.rerender(<OpenItemsTriageResults {...props} />);
    expect(screen.getByText(payload.summary)).toBeInTheDocument();
    await userEvent.click(screen.getAllByTestId("triage-evidence-toggle")[0]);
    expect(screen.getByText(/No recent views/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Delivered work" }),
    ).toHaveAttribute("href", "/work/item");
    // Every suggestion arrives checked; nothing is written until Apply.
    expect(
      screen.getByRole("checkbox", { name: "Select suggestion" }),
    ).toBeChecked();
    expect(ports.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("triage-apply-selected"));
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

  it("starts with every suggestion checked and applies exactly the checked ones, each on its own", async () => {
    const { props, ports } = setup();
    mocks.messages = [
      reply("output", {
        summary: "Clean up",
        suggestions: [
          removeOf("r1", ["a"]),
          removeOf("r2", ["b"]),
          removeOf("r3", ["c"]),
        ],
      }),
    ];
    const collection = collectionOf(
      ["a", "b", "c", "d"].map((id) => openItem(id)),
    );
    render(<OpenItemsTriageResults {...props} collection={collection} />);
    const summary = screen.getByTestId("triage-preview-summary");
    const count = screen.getByTestId("triage-selected-count");
    const apply = screen.getByTestId("triage-apply-selected");
    expect(count).toHaveTextContent("3 of 3 selected");
    expect(summary).toHaveTextContent("4 → 1 open items");
    expect(rowOf("before", "TASK:c")).toHaveAttribute("data-change", "removed");

    // Unchecking takes its effect out at once; its item shows unchanged.
    await userEvent.click(checkboxOf("r3"));
    expect(summary).toHaveTextContent("4 → 2 open items");
    expect(rowOf("before", "TASK:c")).toHaveAttribute(
      "data-change",
      "unchanged",
    );
    expect(
      within(rowOf("before", "TASK:c")!).queryByTestId("triage-preview-marker"),
    ).toBeNull();
    expect(rowOf("after", "TASK:c")).toBeDefined();
    expect(apply).toHaveTextContent("Apply 2 selected");

    await userEvent.click(screen.getByTestId("triage-clear-selection"));
    expect(count).toHaveTextContent("0 of 3 selected");
    expect(summary).toHaveTextContent("4 → 4 open items");
    expect(apply).toBeDisabled();
    await userEvent.click(screen.getByTestId("triage-select-all"));
    expect(count).toHaveTextContent("3 of 3 selected");
    await userEvent.click(checkboxOf("r3"));

    // One conflict does not stop the others; the unchecked one is untouched.
    vi.mocked(ports.remove).mockRejectedValueOnce(new Error("Item moved"));
    await userEvent.click(apply);
    await waitFor(() => expect(ports.remove).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(card("r2")).getByTestId("triage-outcome")).toHaveAttribute(
        "data-outcome",
        "success",
      ),
    );
    expect(within(card("r1")).getByTestId("triage-outcome")).toHaveAttribute(
      "data-outcome",
      "failure",
    );
    expect(within(card("r3")).queryByTestId("triage-outcome")).toBeNull();
    expect(ports.remove).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "c" }),
      expect.anything(),
    );
  });

  it("starts a later overlapping suggestion unavailable, naming the earlier one, and frees it unchecked", async () => {
    const { props, ports } = setup();
    mocks.messages = [
      reply("output", {
        summary: "Overlap",
        suggestions: [
          removeOf("remove", ["a"]),
          {
            suggestionId: "group",
            kind: "groupOpenItems",
            items: [task("a"), task("b")],
            group: { kind: "newGroup", newGroupName: "Cleanup" },
            rationale: "Related",
            evidence: [],
          },
        ],
      }),
    ];
    const collection = collectionOf(["a", "b", "c"].map((id) => openItem(id)));
    render(<OpenItemsTriageResults {...props} collection={collection} />);
    const summary = screen.getByTestId("triage-preview-summary");
    expect(checkboxOf("remove")).toBeChecked();
    expect(checkboxOf("group")).not.toBeChecked();
    expect(checkboxOf("group")).toBeDisabled();
    expect(
      within(card("group")).getByTestId("triage-unavailable"),
    ).toHaveTextContent(/Task a.*Remove 1 item/);
    expect(summary).toHaveTextContent("3 → 2 open items");

    await userEvent.click(checkboxOf("remove"));
    expect(screen.queryByTestId("triage-unavailable")).toBeNull();
    expect(checkboxOf("group")).toBeEnabled();
    expect(checkboxOf("group")).not.toBeChecked();
    expect(summary).toHaveTextContent("3 → 3 open items");

    await userEvent.click(checkboxOf("group"));
    expect(summary).toHaveTextContent("1 new group (2 items)");
    expect(checkboxOf("remove")).toBeDisabled();
    expect(ports.remove).not.toHaveBeenCalled();
  });

  it("outlines a hovered card's rows in both columns, and only the left column when it is unchecked", async () => {
    const { props } = setup();
    mocks.messages = [
      reply("output", {
        summary: "Group",
        suggestions: [
          {
            suggestionId: "group",
            kind: "groupOpenItems",
            items: [task("a"), task("b")],
            group: { kind: "newGroup", newGroupName: "Cleanup" },
            rationale: "Related",
            evidence: [],
          },
          removeOf("remove", ["c"]),
        ],
      }),
    ];
    const collection = collectionOf(["a", "b", "c"].map((id) => openItem(id)));
    render(<OpenItemsTriageResults {...props} collection={collection} />);

    await userEvent.hover(card("group"));
    expect(highlightedKeys("before")).toEqual(["TASK:a", "TASK:b"]);
    expect(highlightedKeys("after")).toEqual([
      "group:new-group:group",
      "TASK:a",
      "TASK:b",
    ]);
    const ribbons = screen.getByTestId("triage-preview-ribbons");
    expect(
      ribbons.querySelectorAll('[data-highlighted="true"]').length,
    ).toBeGreaterThan(0);
    await userEvent.unhover(card("group"));
    expect(highlightedKeys("before")).toEqual([]);
    expect(highlightedKeys("after")).toEqual([]);

    await userEvent.click(checkboxOf("group"));
    await userEvent.hover(card("group"));
    expect(highlightedKeys("before")).toEqual(["TASK:a", "TASK:b"]);
    expect(highlightedKeys("after")).toEqual([]);
    expect(ribbons.querySelectorAll('[data-highlighted="true"]')).toHaveLength(
      0,
    );
  });

  it("shows the sidebar's Peek on a rested preview row in either column, and never on touch", async () => {
    const { props } = setup();
    mocks.messages = [
      reply("output", {
        summary: "Clean up",
        suggestions: [removeOf("remove", ["a"]), removeOf("keep", ["b"])],
      }),
    ];
    const noted = { ...openItem("b"), note: "Waiting on review" };
    const collection = collectionOf([openItem("a"), noted]);
    const hoverRow = async (side: "before" | "after", key: string) =>
      act(async () => {
        fireEvent.mouseEnter(rowOf(side, key)!);
      });
    const view = render(
      <OpenItemsTriageResults {...props} collection={collection} />,
    );
    // An unchecked suggestion's item stays a plain row in both columns.
    await userEvent.click(checkboxOf("keep"));
    await userEvent.unhover(card("keep"));

    // Crossing rows quickly shows nothing, and never changes the highlight.
    await hoverRow("before", "TASK:a");
    fireEvent.mouseLeave(rowOf("before", "TASK:a")!);
    await hoverRow("before", "TASK:b");
    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
    expect(highlightedKeys("before")).toEqual([]);

    // Resting past 400 ms shows the entity card, without any highlight.
    fireEvent.mouseLeave(rowOf("before", "TASK:b")!);
    await hoverRow("before", "TASK:a");
    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
    expect(await screen.findByTestId("entity-hover-card")).toHaveTextContent(
      "TASK:a",
    );
    expect(highlightedKeys("before")).toEqual([]);

    // A saved note replaces the card, as in the sidebar; the right column too.
    fireEvent.mouseLeave(rowOf("before", "TASK:a")!);
    await waitFor(() =>
      expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument(),
    );
    await hoverRow("after", "TASK:b");
    expect(
      await screen.findByTestId("triage-preview-peek-note"),
    ).toHaveTextContent("Waiting on review");

    // Touch devices never open one.
    fireEvent.mouseLeave(rowOf("after", "TASK:b")!);
    peek.canHover = false;
    view.rerender(
      <OpenItemsTriageResults {...props} collection={collection} />,
    );
    await hoverRow("before", "TASK:a");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
    peek.canHover = true;
  });

  it("draws each row with the Open Items icon, never a letter glyph", () => {
    const { props } = setup();
    const coding = openItem(
      "coding",
      {
        label: "Coding run",
        workItemTypeKey: null,
        agentSessionType: AgentSessionType.Coding,
      },
      EntityType.AgentSession,
    );
    const talking = openItem(
      "talking",
      {
        label: "Conversation",
        workItemTypeKey: null,
        agentSessionType: AgentSessionType.EntityConversation,
      },
      EntityType.AgentSession,
    );
    const unknownType = openItem(
      "custom",
      taskPresentation("Custom item", "CUSTOM"),
    );
    mocks.messages = [
      reply("output", {
        summary: "Clean up",
        suggestions: [
          removeOf("r", ["a", "custom"]),
          {
            suggestionId: "s",
            kind: "removeOpenItems",
            items: [
              {
                entityType: EntityType.AgentSession,
                entityId: "coding",
                title: "Coding run",
              },
              {
                entityType: EntityType.AgentSession,
                entityId: "talking",
                title: "Conversation",
              },
            ],
            rationale: "Done",
            evidence: [],
          },
        ],
      }),
    ];
    render(
      <OpenItemsTriageResults
        {...props}
        collection={collectionOf([openItem("a"), unknownType, coding, talking])}
      />,
    );
    const iconOf = (key: string) =>
      within(rowOf("before", key)!).getByTestId("triage-preview-icon");
    expect(
      within(iconOf("TASK:a")).getByTestId("open-item-registry-icon-STANDARD"),
    ).toBeInTheDocument();
    // No definition for the type: the icon is withheld, as in the sidebar.
    expect(iconOf("TASK:custom")).toBeEmptyDOMElement();

    const sidebarIcon = (sessionType: AgentSessionType) =>
      render(
        <OpenItemIcon
          entityType="agent_session"
          presentation={{ kind: "agent_session", label: "x", sessionType }}
          registry={workItemIcons}
        />,
      ).container.innerHTML;
    const codingIcon = sidebarIcon(AgentSessionType.Coding);
    const talkingIcon = sidebarIcon(AgentSessionType.EntityConversation);
    expect(codingIcon).not.toEqual(talkingIcon);
    expect(iconOf("AGENT_SESSION:coding").innerHTML).toEqual(codingIcon);
    expect(iconOf("AGENT_SESSION:talking").innerHTML).toEqual(talkingIcon);
    for (const row of previewRows("before")) {
      expect(
        within(row).queryByTestId("triage-preview-icon")?.textContent ?? "",
      ).toBe("");
    }
  });
});
