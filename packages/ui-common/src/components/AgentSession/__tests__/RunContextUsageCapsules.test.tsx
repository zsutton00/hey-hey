import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageResponseDto } from "../../../api";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { runContextUsageCache } from "../runtime/RunContextUsageCache";
import { SessionContextUsageCapsules } from "../SessionContextUsageCapsules";
import type React from "react";
import {
  CONTEXT_ALARM_TOKENS,
  CONTEXT_WARNING_TOKENS,
  collectProviderSessions,
  formatContextTokens,
  getContextAlarmTokens,
  getContextGaugeFill,
  getContextSizeLevel,
  RunContextUsageCapsules,
} from "../RunContextUsageCapsules";

describe("collectProviderSessions", () => {
  it("derives ordered session choices from persisted nested messages", () => {
    const messages = [
      {
        type: "SYSTEM",
        data: {
          type: "AGENT_RESPONSE",
          providerSessionId: "session-1",
          promptHandler: "Planner",
        },
        responses: [
          {
            type: "SYSTEM",
            data: {
              type: "AGENT_RESPONSE",
              providerSessionId: "session-2",
            },
            responses: [],
          },
        ],
      },
    ] as unknown as MessageResponseDto[];

    expect(collectProviderSessions(messages)).toEqual([
      { id: "session-1", label: "Planner" },
      { id: "session-2", label: "Session 2" },
    ]);
  });
});

const runtime = vi.hoisted(() => ({
  read: vi.fn(),
  authorize: vi.fn(),
  machines: [{ machineId: "machine" }],
  messages: [
    {
      type: "SYSTEM",
      data: { type: "AGENT_RESPONSE", providerSessionId: "one" },
      responses: [],
    },
  ],
}));
vi.mock("../../../data/hooks/useConversationMessages", () => ({
  useConversationMessages: () => ({ data: runtime.messages }),
}));
vi.mock("../../ActionsCapsule/CapsuleAction", () => ({
  CapsuleAction: ({
    id,
    onClick,
    label,
    icon: Icon,
    badge,
    textColor,
    iconStyle,
  }: {
    id: string;
    onClick: () => void;
    label: string;
    icon: React.ElementType & { displayName?: string };
    badge?: string | number;
    textColor?: string;
    iconStyle?: React.CSSProperties;
  }) =>
    id === "run-context" ? (
      <button
        data-testid="capsule-action-run-context"
        data-text-color={textColor ?? ""}
        data-icon-color={iconStyle?.color ?? ""}
        data-icon={Icon.displayName}
        onClick={onClick}
      >
        <Icon />
        <span data-testid="capsule-label">{label}</span>
        {badge !== undefined ? (
          <span data-testid="capsule-badge">{badge}</span>
        ) : null}
      </button>
    ) : null,
}));
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { readAgentSessionCliState: runtime.read },
}));
vi.mock("../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: { machineId: "machine" } }),
}));
vi.mock("../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({ machines: runtime.machines }),
}));
vi.mock("../../../data/hooks/useControllerAuthorizedAction", () => ({
  useControllerAuthorizedAction: () => ({ mutate: runtime.authorize }),
}));
vi.mock("../../../services/authService", () => ({
  onAuthChange: () => () => {},
}));

const success = (
  cost:
    | {
        state: "available";
        amountUsd: number;
        currency: "USD";
        source: "ccusage";
      }
    | { state: "unavailable"; reason: "cost_source_unavailable" },
) => ({
  data: {
    data: {
      operation: "run.context_usage.get",
      result: {
        runId: "run",
        providerSessionId: "one",
        contextData: {
          model: "retained-model",
          categories: [],
          totalTokens: 10,
          maxTokens: 100,
          rawMaxTokens: 100,
          percentage: 10,
          gridRows: [],
          memoryFiles: [],
          mcpTools: [],
          agents: [],
          isAutoCompactEnabled: false,
          apiUsage: null,
        },
        cost,
      },
    },
  },
});
const available = success({
  state: "available",
  amountUsd: 0,
  currency: "USD",
  source: "ccusage",
});

beforeEach(() => {
  runContextUsageCache.clear();
  runtime.read.mockReset().mockResolvedValue(available);
  runtime.authorize.mockReset().mockImplementation(async ({ submit }) => ({
    outcome: "ADMITTED",
    data: await submit({
      authorization: { kind: "ACTIVE_GRANT", grantId: "grant" },
    }),
  }));
});

describe("Context capsule retained readings", () => {
  it("restores data through the real conditional unmount/reopen and retains zero with freshness and retry after unavailable cost", async () => {
    render(
      <RunContextUsageCapsules
        organizationId="org"
        projectId="project"
        agentSessionId="agent"
        conversationId="conversation"
        runId="run"
        provider="claude"
      />,
    );
    expect(runtime.read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("capsule-action-run-context"));
    await screen.findByText("retained-model");
    const costTimestamp = screen.getByTestId(
      "run-context-usage-cost-freshness",
    ).textContent;
    fireEvent.click(
      screen.getByRole("button", { name: "Close context usage" }),
    );
    expect(
      screen.queryByTestId("run-context-usage-modal"),
    ).not.toBeInTheDocument();
    await act(async () => {});
    expect(runtime.read).toHaveBeenCalledTimes(1);
    let finish!: (value: ReturnType<typeof success>) => void;
    runtime.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    fireEvent.click(screen.getByTestId("capsule-action-run-context"));
    expect(screen.getByText("retained-model")).toBeInTheDocument();
    expect(
      screen.getByTestId("run-context-usage-refreshing"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("run-context-usage-loading"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(runtime.read).toHaveBeenCalledTimes(2));
    await act(async () =>
      finish(
        success({ state: "unavailable", reason: "cost_source_unavailable" }),
      ),
    );
    expect(screen.getByTestId("run-context-usage-cost")).toHaveTextContent(
      "Last known cost",
    );
    expect(screen.getByTestId("run-context-usage-cost")).toHaveTextContent(
      "$0.00",
    );
    expect(
      screen.getByTestId("run-context-usage-cost-unavailable"),
    ).toHaveTextContent("cost_source_unavailable");
    expect(
      screen.getByTestId("run-context-usage-cost-freshness").textContent,
    ).toBe(costTimestamp);
    runtime.read.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByTestId("run-context-usage-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("run-context-usage-error")).toHaveTextContent(
        "offline",
      ),
    );
    expect(screen.getByText("retained-model")).toBeInTheDocument();
    expect(screen.getByTestId("run-context-usage-cost")).toHaveTextContent(
      "$0.00",
    );
    fireEvent.click(screen.getByTestId("run-context-usage-retry"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("run-context-usage-error"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("run-context-usage-cost")).toHaveTextContent(
      "Cost",
    );
    expect(screen.getByTestId("run-context-usage-cost")).not.toHaveTextContent(
      "Last known",
    );
  });
});

describe("Page context recovery", () => {
  const props = {
    organizationId: "org",
    projectId: "project",
    agentSessionId: "agent",
    provider: "claude" as const,
    conversationId: "conversation",
    runId: "run",
    providerSessionId: "one",
  };

  it("reads on page entry without opening the modal and fills the missing meter", async () => {
    let finish!: (value: typeof available) => void;
    runtime.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const view = render(<SessionContextUsageCapsules {...props} />);
    expect(screen.getByTestId("capsule-label")).toHaveTextContent("Loading");
    await waitFor(() => expect(runtime.read).toHaveBeenCalledTimes(1));
    expect(runtime.read).toHaveBeenCalledWith(
      expect.objectContaining({
        cliReadRequestDto: expect.objectContaining({
          operation: "run.context_usage.get",
          runId: "run",
          providerSessionId: "one",
        }),
      }),
    );
    await act(async () => finish(available));
    expect(screen.getByTestId("capsule-label")).toHaveTextContent("0K");
    expect(
      Number(
        screen
          .getByTestId("capsule-action-run-context")
          .querySelector("svg")
          ?.getAttribute("data-gauge-fill"),
      ),
    ).toBe(0.1);
    expect(
      screen.queryByTestId("run-context-usage-modal"),
    ).not.toBeInTheDocument();
    view.rerender(
      <SessionContextUsageCapsules
        {...props}
        contextTokens={42_000}
        contextWindowTokens={100_000}
      />,
    );
    expect(screen.getByTestId("capsule-label")).toHaveTextContent("42K");
    expect(runtime.read).toHaveBeenCalledTimes(1);
  });

  it("does not read when the page already has a valid value, including zero", async () => {
    render(<SessionContextUsageCapsules {...props} contextTokens={0} />);
    await act(async () => {});
    expect(screen.getByTestId("capsule-label")).toHaveTextContent("0K");
    expect(runtime.read).not.toHaveBeenCalled();
  });

  it("waits for explicit provider identity and rejects a response for another session", async () => {
    const view = render(
      <SessionContextUsageCapsules {...props} providerSessionId={undefined} />,
    );
    await act(async () => {});
    expect(runtime.read).not.toHaveBeenCalled();
    view.rerender(
      <SessionContextUsageCapsules {...props} providerSessionId="two" />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("capsule-label")).toHaveTextContent("Error"),
    );
    expect(screen.getByTestId("capsule-label")).not.toHaveTextContent("0K");
  });

  it("shows a read failure and recovers through the modal Retry", async () => {
    runtime.read.mockRejectedValueOnce(new Error("Session not found"));
    render(<SessionContextUsageCapsules {...props} />);
    await waitFor(() =>
      expect(screen.getByTestId("capsule-label")).toHaveTextContent("Error"),
    );
    runtime.read.mockRejectedValueOnce(new Error("Session not found"));
    fireEvent.click(screen.getByTestId("capsule-action-run-context"));
    await waitFor(() =>
      expect(screen.getByTestId("run-context-usage-error")).toHaveTextContent(
        "Session not found",
      ),
    );
    fireEvent.click(screen.getByTestId("run-context-usage-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("capsule-label")).toHaveTextContent("0K"),
    );
  });
});

describe("Context capsule live size", () => {
  const renderCapsule = (
    contextTokens?: number,
    contextWindowTokens?: number,
  ) =>
    render(
      <RunContextUsageCapsules
        organizationId="org"
        projectId="project"
        agentSessionId="agent"
        conversationId="conversation"
        runId="run"
        provider="claude"
        {...(contextTokens !== undefined && { contextTokens })}
        {...(contextWindowTokens !== undefined && { contextWindowTokens })}
      />,
    );

  it("owns fixed warning and alarm thresholds", () => {
    expect(CONTEXT_WARNING_TOKENS).toBe(150_000);
    expect(CONTEXT_ALARM_TOKENS).toBe(500_000);
  });

  it.each([
    [undefined, "\u2014", "unknown", 0],
    [0, "0K", "normal", 0],
    [149_999, "149K", "normal", 0.3],
    [150_000, "150K", "warning", 0.3],
    [500_000, "500K", "alarm", 1],
  ] as const)(
    "renders %s tokens as %s text under the gauge in the %s state",
    (contextTokens, label, level, fill) => {
      renderCapsule(contextTokens);
      const capsule = screen.getByTestId("capsule-action-run-context");

      expect(screen.getByTestId("capsule-label")).toHaveTextContent(label);
      expect(screen.queryByTestId("capsule-badge")).not.toBeInTheDocument();
      expect(getContextSizeLevel(contextTokens)).toBe(level);
      expect(
        Number(capsule.querySelector("svg")?.getAttribute("data-gauge-fill")),
      ).toBeCloseTo(fill);
      expect(
        capsule.querySelector('[data-testid="context-gauge-fill"]') !== null,
      ).toBe(fill > 0);
      const colored = level === "warning" || level === "alarm";
      expect(capsule.dataset.textColor !== "").toBe(colored);
      expect(capsule.dataset.iconColor !== "").toBe(colored);
      expect(capsule.dataset.icon).toBe(
        level === "alarm" ? "ContextAlarmIcon" : "ContextIcon",
      );
    },
  );

  it("uses distinct colors for warning and alarm", () => {
    const { unmount } = renderCapsule(150_000);
    const warning = screen.getByTestId("capsule-action-run-context").dataset
      .textColor;
    unmount();
    renderCapsule(500_000);
    const alarm = screen.getByTestId("capsule-action-run-context").dataset
      .textColor;

    expect(warning).not.toBe(alarm);
  });

  it("fills the gauge relative to the alarm threshold when the window is unknown", () => {
    expect(getContextGaugeFill(undefined)).toBe(0);
    expect(getContextGaugeFill(250_000)).toBe(0.5);
    expect(getContextGaugeFill(2_000_000)).toBe(1);
  });

  it("fills the gauge relative to the model's context window without stepping", () => {
    expect(getContextGaugeFill(42_000, 1_000_000)).toBeCloseTo(0.042);
    expect(getContextGaugeFill(60_000, 1_000_000)).toBeCloseTo(0.06);
    expect(getContextGaugeFill(129_000, 258_000)).toBe(0.5);
    expect(getContextGaugeFill(300_000, 258_000)).toBe(1);
  });

  it("alarms at 500K for large windows and at 80% of smaller windows", () => {
    expect(getContextAlarmTokens(undefined)).toBe(500_000);
    expect(getContextAlarmTokens(1_000_000)).toBe(500_000);
    expect(getContextAlarmTokens(258_000)).toBe(206_400);
    expect(getContextSizeLevel(499_999, 1_000_000)).toBe("warning");
    expect(getContextSizeLevel(500_000, 1_000_000)).toBe("alarm");
    expect(getContextSizeLevel(206_399, 258_000)).toBe("warning");
    expect(getContextSizeLevel(206_400, 258_000)).toBe("alarm");
    expect(getContextSizeLevel(110_000, 128_000)).toBe("alarm");
    expect(getContextSizeLevel(90_000, 128_000)).toBe("normal");
  });

  it("renders the window-scaled gauge and alarm on the capsule", () => {
    renderCapsule(210_000, 258_000);
    const capsule = screen.getByTestId("capsule-action-run-context");

    expect(
      Number(capsule.querySelector("svg")?.getAttribute("data-gauge-fill")),
    ).toBeCloseTo(210_000 / 258_000);
    expect(capsule.dataset.icon).toBe("ContextAlarmIcon");
  });

  it("keeps every size label a single short token for the mobile 48px row", () => {
    for (const value of [undefined, 0, 149_999, 150_000, 500_000, 1_250_000]) {
      expect(formatContextTokens(value)).toMatch(/^\S{1,6}$/);
    }
  });

  it("still opens the Context modal on click", async () => {
    renderCapsule(42_000);

    fireEvent.click(screen.getByTestId("capsule-action-run-context"));

    await screen.findByText("retained-model");
  });
});
