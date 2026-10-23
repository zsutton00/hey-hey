import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliReadProviderUsage } from "../../../api";
import { useProviderUsage } from "../../../data/hooks/useProviderUsage";
import { RunContextUsageModal } from "../RunContextUsageModal";
import type { AgentProvider } from "../runtime/types";

const retry = vi.fn();
const useRunContextUsage = vi.fn();

vi.mock("../runtime/hooks/useRunContextUsage", () => ({
  useRunContextUsage: (params: unknown) => useRunContextUsage(params),
}));

vi.mock("../../../data/hooks/useProviderUsage", () => ({
  useProviderUsage: vi.fn(),
}));

const useProviderUsageMock = vi.mocked(useProviderUsage);
const baseUsageReturn: ReturnType<typeof useProviderUsage> = {
  providers: null,
  typedError: null,
  requestError: null,
  isInitialLoading: false,
};
const providers = [
  "claude",
  "codex",
  "opencode",
] as const satisfies readonly AgentProvider[];

const createUsage = (provider: AgentProvider): CliReadProviderUsage => ({
  provider,
  status: "reported",
  observedAt: "2026-10-01T00:00:00.000Z",
  fiveHour: { usedPercent: 25, resetsAt: "2026-10-01T05:00:00.000Z" },
  weekly: { usedPercent: 60, resetsAt: "2026-10-08T00:00:00.000Z" },
});

beforeEach(() => {
  useProviderUsageMock.mockReset().mockReturnValue(baseUsageReturn);
});

describe("RunContextUsageModal", () => {
  it("renders context and required unavailable cost as one result", () => {
    useRunContextUsage.mockReturnValue({
      status: "success",
      data: {
        runId: "run-1",
        providerSessionId: "session-2",
        contextData: {
          categories: [{ name: "Messages", tokens: 50, color: "blue" }],
          totalTokens: 50,
          maxTokens: 100,
          rawMaxTokens: 100,
          percentage: 50,
          gridRows: [],
          model: "codex-1",
          memoryFiles: [],
          mcpTools: [],
          agents: [],
          isAutoCompactEnabled: false,
          apiUsage: null,
        },
        cost: {
          state: "unavailable",
          reason: "session_not_found",
          message: "No cost record was found.",
        },
      },
      error: null,
      errorCode: null,
      retry,
    });

    render(
      <RunContextUsageModal
        open
        onClose={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="agent-session-1"
        runId="run-1"
        providerSessions={[
          { id: "session-1", label: "Planner" },
          { id: "session-2", label: "Implementation" },
        ]}
        provider="codex"
      />,
    );

    expect(screen.getByText("codex-1")).toBeInTheDocument();
    expect(
      screen.getByTestId("run-context-usage-cost-unavailable"),
    ).toHaveTextContent("No cost record was found.");
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Planner" }));
    expect(useRunContextUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerSessionId: "session-1" }),
    );
    expect(
      screen.queryByTestId("run-context-usage-content"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("run-context-usage-loading")).toBeInTheDocument();
  });

  it("renders a typed timeout state", () => {
    useRunContextUsage.mockReturnValue({
      status: "unavailable",
      data: null,
      error: "timed out",
      errorCode: "TIMEOUT",
      retry,
    });
    render(
      <RunContextUsageModal
        open
        onClose={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="agent-session-1"
        runId="run-1"
        providerSessions={[]}
        provider="claude"
      />,
    );
    expect(screen.getByTestId("run-context-usage-error")).toHaveTextContent(
      "Context usage timed out",
    );
  });
});

describe("Context selection reconciliation", () => {
  it("resolves selection against the new Run and session choices before publishing hook inputs", () => {
    useRunContextUsage.mockReturnValue({
      status: "idle",
      data: null,
      error: null,
      errorCode: null,
      retry,
    });
    const props = {
      open: true,
      onClose: vi.fn(),
      organizationId: "org",
      projectId: "project",
      agentSessionId: "agent",
      runId: "run-one",
      provider: "claude" as const,
      providerSessions: [
        { id: "one", label: "First" },
        { id: "two", label: "Second" },
      ],
    };
    const view = render(<RunContextUsageModal {...props} />);
    expect(useRunContextUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerSessionId: "two" }),
    );
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "First" }));
    expect(useRunContextUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerSessionId: "one" }),
    );
    view.rerender(<RunContextUsageModal {...props} runId="run-two" />);
    expect(useRunContextUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ runId: "run-two", providerSessionId: "two" }),
    );
    view.rerender(
      <RunContextUsageModal
        {...props}
        runId="run-two"
        providerSessions={[{ id: "three", label: "Third" }]}
      />,
    );
    expect(useRunContextUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerSessionId: "three" }),
    );
  });
});

describe("Context breakdown visibility", () => {
  it.each([true, false])(
    "shows category headers only with category data (available: %s) and never lists MCP tools",
    (hasCategories) => {
      useRunContextUsage.mockReturnValue({
        status: "success",
        data: {
          runId: "run",
          providerSessionId: "session",
          contextData: {
            model: "provider-model",
            totalTokens: 100,
            rawMaxTokens: 1000,
            percentage: 10,
            categories: hasCategories
              ? [{ name: "Messages", tokens: 100, color: "blue" }]
              : [],
            mcpTools: [
              {
                name: "private-tool-name",
                serverName: "private-server",
                tokens: 30,
              },
            ],
            memoryFiles: [],
          },
          cost: {
            state: "available",
            amountUsd: 1,
            currency: "USD",
            source: "ccusage",
          },
        },
        retry,
      });
      render(
        <RunContextUsageModal
          open
          onClose={vi.fn()}
          organizationId="org"
          projectId="project"
          agentSessionId="agent"
          runId="run"
          providerSessions={[{ id: "session", label: "Session" }]}
          provider="claude"
        />,
      );
      expect(screen.queryByText("MCP tools")).not.toBeInTheDocument();
      expect(screen.queryByText("private-tool-name")).not.toBeInTheDocument();
      expect(screen.queryByText("private-server")).not.toBeInTheDocument();
      if (hasCategories) {
        expect(
          screen.getByRole("columnheader", { name: "Category" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("columnheader", { name: "Tokens" }),
        ).toBeInTheDocument();
        expect(screen.getByText("Messages")).toBeInTheDocument();
      } else {
        expect(screen.queryByText("Categories")).not.toBeInTheDocument();
        expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
      }
      expect(screen.getByText("provider-model")).toBeInTheDocument();
      expect(screen.getByTestId("run-context-usage-cost")).toHaveTextContent(
        "$1.00",
      );
    },
  );
});

describe("Provider usage in the Context modal", () => {
  const renderModal = (provider: AgentProvider) => {
    useRunContextUsage.mockReturnValue({
      status: "idle",
      data: null,
      error: null,
      errorCode: null,
      retry,
    });
    return render(
      <RunContextUsageModal
        open
        onClose={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        agentSessionId="agent-session-1"
        runId="run-1"
        providerSessions={[]}
        provider={provider}
      />,
    );
  };

  it.each(providers)(
    "shows only the %s provider card above the breakdown",
    (provider) => {
      useProviderUsageMock.mockReturnValue({
        ...baseUsageReturn,
        providers: providers.map(createUsage),
      });
      renderModal(provider);

      expect(useProviderUsageMock).toHaveBeenCalledWith(
        "org-1",
        "project-1",
        "agent-session-1",
        { refetchOnMount: true },
      );
      const card = screen.getByTestId(`provider-usage-card-${provider}`);
      for (const other of providers) {
        if (other !== provider) {
          expect(
            screen.queryByTestId(`provider-usage-card-${other}`),
          ).not.toBeInTheDocument();
        }
      }
      expect(
        card.compareDocumentPosition(
          screen.getByText("No provider session is available for this Run."),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it("shows a card error when the session's provider is missing", () => {
    useProviderUsageMock.mockReturnValue({
      ...baseUsageReturn,
      providers: [createUsage("claude")],
    });
    renderModal("codex");

    expect(
      screen.getByTestId("provider-usage-card-codex-error"),
    ).toHaveTextContent("Couldn't read usage for Codex.");
  });

  it("shows the shared timeout state", () => {
    useProviderUsageMock.mockReturnValue({
      ...baseUsageReturn,
      typedError: { code: "TIMEOUT", message: "No answer." },
    });
    renderModal("claude");

    expect(screen.getByTestId("provider-usage-timeout")).toHaveTextContent(
      "No answer.",
    );
  });

  it("shows the shared unavailable state", () => {
    useProviderUsageMock.mockReturnValue({
      ...baseUsageReturn,
      typedError: { code: "MACHINE_NOT_BOUND", message: "No machine." },
    });
    renderModal("opencode");

    expect(screen.getByTestId("provider-usage-unavailable")).toHaveTextContent(
      "No machine.",
    );
  });
});
