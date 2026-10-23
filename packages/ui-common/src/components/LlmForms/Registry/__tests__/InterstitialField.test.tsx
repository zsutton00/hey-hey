import React from "react";
import { render, screen, within } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportDto, SystemMessageData } from "../../../../api";
import type { LatestTurnToolCallsState } from "../../../AgentSession/runtime/hooks/useLatestTurnToolCalls";
import {
  InterstitialField,
  isInterstitialMessageData,
} from "../InterstitialField";
import { formatMessageTimestamp } from "../../../Conversation/Components/messageTimestamp";
import { FIELD_REGISTRY, getRegistryType } from "../Registry";
import type { FieldComponentContext, FieldConfig } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// The conversation polls once and shares the state through the field context.
const toolCallsState: { current: LatestTurnToolCallsState } = {
  current: { status: "idle" },
};

vi.mock("../../../shared/MermaidCodeBlock", () => ({
  MermaidCodeBlock: ({ code }: { code: string }) => <div>{code}</div>,
}));

vi.mock("../../../Conversation/Components/SystemMessage", () => ({
  SystemMessage: ({
    inlineReports,
    text,
  }: {
    inlineReports?: ReportDto[];
    text?: string;
  }) => (
    <div data-testid="system-message">
      {text}
      <span data-testid="interstitial-report-ids">
        {inlineReports?.map((report) => report.id).join(",")}
      </span>
    </div>
  ),
}));

// SystemMessage reads the app-specific `palette.attention`, absent from the
// default MUI theme — provide it so the reused bubble renders.
const theme = (() => {
  const nextTheme = createTheme();
  (nextTheme.palette as Record<string, unknown>).attention = {
    main: "#1976d2",
    light: "#63a4ff",
    dark: "#004ba0",
    contrastText: "#ffffff",
  };
  return nextTheme;
})();

const renderField = (response: string, inlineReports?: ReportDto[]) =>
  render(
    <ThemeProvider theme={theme}>
      <InterstitialField
        config={baseConfig}
        isSubmitted={false}
        inlineReports={inlineReports}
        context={contextWithResponse(response)}
      />
    </ThemeProvider>,
  );

const baseConfig: FieldConfig = {
  field: "interstitial_field",
  description: "Interstitial",
  type: "interstitial",
};

const contextWithResponse = (response: string): FieldComponentContext => ({
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "org-1",
  messageData: { response, type: "AGENT" } as SystemMessageData,
  latestTurnToolCalls: toolCallsState.current,
});

describe("InterstitialField", () => {
  beforeEach(() => {
    toolCallsState.current = { status: "idle" };
  });

  it("shows the current Turn's tool calls after the narration", () => {
    toolCallsState.current = {
      status: "available",
      result: {
        state: "available",
        runId: "run-1",
        turnId: "turn-1",
        omittedEarlierCount: 0,
        evictedCount: 0,
        toolCalls: [
          {
            entryId: "entry-1",
            toolUseId: "use-1",
            toolName: "Read",
            summary: "src/index.ts",
            status: "running",
            exitCode: null,
            lane: {
              subagentTurnId: null,
              providerThreadId: null,
              parentToolUseId: null,
            },
            createdAt: "2026-10-20T00:00:00.000Z",
            updatedAt: "2026-10-20T00:00:00.000Z",
            detail: { input: null, output: null, result: null },
          },
        ],
      },
    };
    renderField("Reading files");

    expect(screen.getByTestId("latest-turn-tool-calls")).toHaveTextContent(
      "src/index.ts",
    );
  });

  it("interleaves tool calls between thoughts by time", () => {
    const toolCall = (entryId: string, summary: string, createdAt: string) => ({
      entryId,
      toolUseId: entryId,
      toolName: "Read",
      summary,
      status: "completed" as const,
      exitCode: 0,
      lane: {
        subagentTurnId: null,
        providerThreadId: null,
        parentToolUseId: null,
      },
      createdAt,
      updatedAt: createdAt,
      detail: { input: null, output: null, result: null },
    });
    toolCallsState.current = {
      status: "available",
      result: {
        state: "available",
        runId: "run-1",
        turnId: "turn-1",
        omittedEarlierCount: 2,
        evictedCount: 0,
        toolCalls: [
          toolCall("a", "first-call", "2026-10-20T00:00:30.000Z"),
          toolCall("b", "second-call", "2026-10-20T00:01:30.000Z"),
        ],
      },
    };
    const { container } = renderField(
      "First thought -- 2026-10-20T00:00:00.000Z\n──────────\nSecond thought -- 2026-10-20T00:01:00.000Z",
    );

    const text = container.textContent ?? "";
    expect(text.indexOf("First thought")).toBeLessThan(
      text.indexOf("first-call"),
    );
    expect(text.indexOf("first-call")).toBeLessThan(
      text.indexOf("Second thought"),
    );
    expect(text.indexOf("Second thought")).toBeLessThan(
      text.indexOf("second-call"),
    );
    expect(screen.getAllByTestId("tool-calls-hidden-count")).toHaveLength(1);
    expect(text.indexOf("2 earlier tool calls")).toBeLessThan(
      text.indexOf("first-call"),
    );
  });

  it("shows the last calls per narration message and expands only the newest", () => {
    const toolCall = (entryId: string, createdAt: string) => ({
      entryId,
      toolUseId: entryId,
      toolName: "Read",
      summary: `call-${entryId}`,
      status: "completed" as const,
      exitCode: 0,
      lane: {
        subagentTurnId: null,
        providerThreadId: null,
        parentToolUseId: null,
      },
      createdAt,
      updatedAt: createdAt,
      detail: { input: null, output: null, result: null },
    });
    toolCallsState.current = {
      status: "available",
      result: {
        state: "available",
        runId: "run-1",
        turnId: "turn-1",
        omittedEarlierCount: 0,
        evictedCount: 0,
        toolCalls: [
          toolCall("a", "2026-10-20T00:00:10.000Z"),
          toolCall("b", "2026-10-20T00:00:20.000Z"),
          toolCall("c", "2026-10-20T00:00:30.000Z"),
          toolCall("d", "2026-10-20T00:01:10.000Z"),
          toolCall("e", "2026-10-20T00:01:20.000Z"),
          toolCall("f", "2026-10-20T00:01:30.000Z"),
        ],
      },
    };
    renderField(
      "First thought -- 2026-10-20T00:00:00.000Z\n──────────\nSecond thought -- 2026-10-20T00:01:00.000Z",
    );

    const [firstGroup, secondGroup] = screen.getAllByTestId(
      "latest-turn-tool-calls",
    );
    const rows = (group: HTMLElement) =>
      within(group)
        .getAllByTestId("tool-call-row")
        .map((row) => row.textContent);
    expect(rows(firstGroup)).toEqual(["Read · call-b", "Read · call-c"]);
    expect(rows(secondGroup)).toEqual(["Read · call-e", "Read · call-f"]);
    expect(
      within(firstGroup).getByTestId("tool-calls-show-earlier"),
    ).toHaveTextContent("Show 1 earlier tool call");

    const expanded = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-expanded") === "true");
    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toHaveTextContent("call-f");
  });

  it.each([
    { status: "disabled" } as const,
    { status: "unavailable", error: "boom" } as const,
  ])("shows no tool-call area or error when the read is $status", (state) => {
    toolCallsState.current = state;
    renderField("Reading files");

    expect(
      screen.queryByTestId("latest-turn-tool-calls"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });

  it("renders the streaming response body with the expected test id", () => {
    renderField("Reading the registry...");

    const node = screen.getByTestId("interstitial-field");
    expect(node).toBeInTheDocument();
    expect(node).toHaveAttribute("data-field", "interstitial_field");
    expect(node).toHaveTextContent("Reading the registry...");
  });

  it("renders delimiter-separated narration as timeline thoughts", () => {
    renderField(
      "Checking the current diff...\n\n──────────\n\nUpdating the tests...\n\n──────────\n\nRunning typecheck...",
    );

    const thoughts = screen.getAllByTestId("interstitial-thought");
    expect(thoughts).toHaveLength(3);
    expect(thoughts[0]).toHaveAttribute("data-position", "first");
    expect(thoughts[1]).toHaveAttribute("data-position", "middle");
    expect(thoughts[2]).toHaveAttribute("data-position", "last");
    expect(
      within(thoughts[0]).getByText("Checking the current diff..."),
    ).toBeInTheDocument();
    expect(
      within(thoughts[0]).queryByText("Updating the tests..."),
    ).not.toBeInTheDocument();
    expect(
      within(thoughts[1]).getByText("Updating the tests..."),
    ).toBeInTheDocument();
    expect(
      within(thoughts[1]).queryByText("Running typecheck..."),
    ).not.toBeInTheDocument();
    expect(
      within(thoughts[2]).getByText("Running typecheck..."),
    ).toBeInTheDocument();
    expect(screen.queryByText("──────────")).not.toBeInTheDocument();
  });

  it("renders producer timestamps below each thought without leaking them into the text", () => {
    const firstTimestamp = "2026-08-22T07:08:16.277Z";
    const secondTimestamp = "2026-08-22T07:08:21.277Z";
    renderField(
      `First thought -- ${firstTimestamp}\n──────────\nSecond thought -- ${secondTimestamp}`,
    );

    const thoughts = screen.getAllByTestId("interstitial-thought");
    const timestamps = screen.getAllByTestId("interstitial-thought-timestamp");

    expect(thoughts[0]).toHaveTextContent("First thought");
    expect(thoughts[0]).not.toHaveTextContent(firstTimestamp);
    expect(timestamps[0]).toHaveTextContent(
      formatMessageTimestamp(firstTimestamp),
    );
    expect(thoughts[1]).toHaveTextContent("Second thought");
    expect(thoughts[1]).not.toHaveTextContent(secondTimestamp);
    expect(timestamps[1]).toHaveTextContent(
      formatMessageTimestamp(secondTimestamp),
    );
  });

  it("renders inline reports once on the final interstitial thought", () => {
    renderField("First thought\n──────────\nFinal thought", [
      { id: "feature-sync-decision-report" } as ReportDto,
    ]);

    const reportIds = screen.getAllByTestId("interstitial-report-ids");
    expect(reportIds).toHaveLength(2);
    expect(reportIds[0]).toBeEmptyDOMElement();
    expect(reportIds[1]).toHaveTextContent("feature-sync-decision-report");
  });

  it.each(["──────────", "━━━━━━━━━━", "——————", "――――――", "⎯⎯⎯⎯⎯", "------"])(
    "recognizes %s as a delimiter-only line",
    (delimiter) => {
      renderField(`First thought\n${delimiter}\nCurrent thought`);

      expect(screen.getAllByTestId("interstitial-thought")).toHaveLength(2);
      expect(screen.queryByText(delimiter)).not.toBeInTheDocument();
    },
  );

  it("renders nothing until the body has content", () => {
    const { container } = renderField("");

    expect(container).toBeEmptyDOMElement();
  });

  it("resolves the interstitial wire literal directly through the registry", () => {
    expect(getRegistryType("interstitial")).toBe("interstitial");
  });

  it("detects only the typed interstitial discriminator", () => {
    expect(
      isInterstitialMessageData({
        response: "Narration",
        type: "AGENT",
        uiElements: [{ id: "interstitial", type: "interstitial", label: "" }],
      } as SystemMessageData),
    ).toBe(true);
    expect(
      isInterstitialMessageData({
        response: "Narration\n──────────\nStill ordinary",
        type: "AGENT",
      } as SystemMessageData),
    ).toBe(false);
  });

  it("is registered as a body-only narration field", () => {
    const entry = FIELD_REGISTRY["interstitial"];
    expect(entry).toBeDefined();
    expect(entry.hideSystemMessage).toBe(true);
    expect(entry.getHasContent(undefined)).toBe(false);
    expect(entry.shouldShowButtons?.(undefined)).toBe(false);
    expect(entry.secondaryActions).toBeUndefined();
    // Forces the form visible on a completed, user-reply-less narration row.
    expect(
      entry.shouldShowForm?.(
        {} as Parameters<NonNullable<typeof entry.shouldShowForm>>[0],
      ),
    ).toBe(true);
  });
});
