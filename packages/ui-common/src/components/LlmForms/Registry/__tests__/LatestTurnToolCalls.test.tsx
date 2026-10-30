import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CliReadToolCall } from "../../../../api";
import { groupToolCallsByThought } from "../groupToolCallsByThought";
import {
  LatestTurnToolCalls,
  TOOL_CALLS_BEFORE_NARRATION_LIMIT,
} from "../LatestTurnToolCalls";

const call = (overrides: Partial<CliReadToolCall> = {}): CliReadToolCall => ({
  entryId: "entry-1",
  toolUseId: "use-1",
  toolName: "Bash",
  summary: "npm test",
  status: "completed",
  exitCode: 0,
  lane: { subagentTurnId: null, providerThreadId: null, parentToolUseId: null },
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  detail: {
    input: { text: "npm test", truncated: false },
    output: { text: "lots of output", truncated: true },
    result: null,
  },
  ...overrides,
});

describe("LatestTurnToolCalls", () => {
  it("shows summaries and expands to detail with a truncated label", async () => {
    render(
      <LatestTurnToolCalls
        toolCalls={[call()]}
        hiddenCount={0}
        newestEntryId={null}
      />,
    );
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-detail")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("tool-call-detail-input")).toHaveTextContent(
      "npm test",
    );
    expect(screen.getByTestId("tool-call-detail-output")).toHaveTextContent(
      "truncated",
    );
    expect(screen.getAllByTestId("tool-call-truncated")).toHaveLength(1);
    expect(
      screen.queryByTestId("tool-call-detail-result"),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.queryByTestId("tool-call-detail")).not.toBeInTheDocument(),
    );
  });

  it("marks subagent calls distinctly", () => {
    render(
      <LatestTurnToolCalls
        hiddenCount={0}
        newestEntryId={null}
        toolCalls={[
          call(),
          call({
            entryId: "entry-2",
            lane: {
              subagentTurnId: "sub-1",
              providerThreadId: null,
              parentToolUseId: "use-1",
            },
          }),
        ]}
      />,
    );
    expect(screen.getAllByText("subagent")).toHaveLength(1);
  });

  it("shows failed calls with their exit code", () => {
    render(
      <LatestTurnToolCalls
        toolCalls={[call({ status: "failed", exitCode: 2 })]}
        hiddenCount={0}
        newestEntryId={null}
      />,
    );
    expect(screen.getByText("exit 2")).toBeInTheDocument();
  });

  it("captions earlier calls that were not returned", () => {
    render(
      <LatestTurnToolCalls
        toolCalls={[call()]}
        hiddenCount={3}
        newestEntryId={null}
      />,
    );
    expect(screen.getByTestId("tool-calls-hidden-count")).toHaveTextContent(
      "3 earlier tool calls not shown",
    );
  });

  it("renders nothing for an empty Turn", () => {
    const { container } = render(
      <LatestTurnToolCalls
        toolCalls={[]}
        hiddenCount={0}
        newestEntryId={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LatestTurnToolCalls limiting", () => {
  const calls = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      call({ entryId: `e${index}`, summary: `call-${index}` }),
    );
  const summaries = () =>
    screen
      .getAllByTestId("tool-call-row")
      .map((row) =>
        within(row)
          .getAllByRole("button")[0]
          .textContent?.replace("Bash · ", ""),
      );

  it("shows only the most recent calls with a control to reveal the rest", () => {
    render(
      <LatestTurnToolCalls
        toolCalls={calls(7)}
        hiddenCount={0}
        visibleLimit={TOOL_CALLS_BEFORE_NARRATION_LIMIT}
        newestEntryId="e6"
      />,
    );
    expect(summaries()).toEqual([
      "call-2",
      "call-3",
      "call-4",
      "call-5",
      "call-6",
    ]);
    const reveal = screen.getByTestId("tool-calls-show-earlier");
    expect(reveal).toHaveTextContent("Show 2 earlier tool calls");
    fireEvent.click(reveal);
    expect(summaries()).toHaveLength(7);
    expect(
      screen.queryByTestId("tool-calls-show-earlier"),
    ).not.toBeInTheDocument();
  });

  it("shows no reveal control when everything fits", () => {
    render(
      <LatestTurnToolCalls
        toolCalls={calls(2)}
        hiddenCount={0}
        visibleLimit={2}
        newestEntryId="e1"
      />,
    );
    expect(
      screen.queryByTestId("tool-calls-show-earlier"),
    ).not.toBeInTheDocument();
  });

  it("expands only the newest call, and a viewer toggle overrides it", () => {
    render(
      <LatestTurnToolCalls
        toolCalls={calls(3)}
        hiddenCount={0}
        newestEntryId="e2"
      />,
    );
    const [first, , newest] = screen.getAllByRole("button");
    expect(newest).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(newest);
    expect(newest).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps reveal and toggles when polling replaces the snapshot", () => {
    const { rerender } = render(
      <LatestTurnToolCalls
        toolCalls={calls(4)}
        hiddenCount={0}
        visibleLimit={2}
        newestEntryId="e3"
      />,
    );
    fireEvent.click(screen.getByTestId("tool-calls-show-earlier"));
    fireEvent.click(screen.getAllByRole("button")[0]);

    // A fresh snapshot: new objects with the same entryIds plus a new call.
    rerender(
      <LatestTurnToolCalls
        toolCalls={calls(5)}
        hiddenCount={0}
        visibleLimit={2}
        newestEntryId="e4"
      />,
    );
    expect(summaries()).toHaveLength(5);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveAttribute("aria-expanded", "true");
    expect(buttons[3]).toHaveAttribute("aria-expanded", "false");
    expect(buttons[4]).toHaveAttribute("aria-expanded", "true");
  });
});

describe("groupToolCallsByThought", () => {
  const at = (entryId: string, createdAt: string) =>
    call({ entryId, createdAt });

  it("places each call after the latest thought that began before it", () => {
    const groups = groupToolCallsByThought(
      [
        "2026-10-20T00:00:00.000Z",
        "2026-10-20T00:01:00.000Z",
        "2026-10-20T00:02:00.000Z",
      ],
      [
        at("a", "2026-10-20T00:00:30.000Z"),
        at("b", "2026-10-20T00:01:00.000Z"),
        at("c", "2026-10-20T00:05:00.000Z"),
      ],
    );
    expect(groups.map((group) => group.map(({ entryId }) => entryId))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });

  it("skips untimed thoughts and puts calls before any timed thought first", () => {
    const groups = groupToolCallsByThought(
      [null, "2026-10-20T00:01:00.000Z", null],
      [
        at("a", "2026-10-20T00:00:30.000Z"),
        at("b", "2026-10-20T00:03:00.000Z"),
      ],
    );
    expect(groups.map((group) => group.map(({ entryId }) => entryId))).toEqual([
      ["a"],
      ["b"],
      [],
    ]);
  });

  it("puts calls with an unreadable time after the last thought", () => {
    const groups = groupToolCallsByThought(
      ["2026-10-20T00:00:00.000Z", "2026-10-20T00:01:00.000Z"],
      [at("a", "not a time")],
    );
    expect(groups[1].map(({ entryId }) => entryId)).toEqual(["a"]);
  });
});
