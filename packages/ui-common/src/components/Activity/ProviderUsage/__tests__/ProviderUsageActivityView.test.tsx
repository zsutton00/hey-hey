import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProviderUsage } from "../../../../data/hooks/useProviderUsage";
import { ProviderUsageActivityView } from "../ProviderUsageActivityView";

vi.mock("../../../../data/hooks/useProviderUsage", () => ({
  useProviderUsage: vi.fn(),
}));

const useProviderUsageMock = vi.mocked(useProviderUsage);
const baseReturn: ReturnType<typeof useProviderUsage> = {
  providers: null,
  typedError: null,
  requestError: null,
  isInitialLoading: false,
};

const renderView = () =>
  render(
    <ProviderUsageActivityView
      organizationId="org-1"
      projectId="project-1"
      routingAgentSessionId="routing-session-1"
    />,
  );

describe("ProviderUsageActivityView", () => {
  beforeEach(() => {
    useProviderUsageMock.mockReturnValue(baseReturn);
  });

  it("does not show account-scope helper copy", () => {
    renderView();
    expect(
      screen.queryByTestId("provider-usage-account-note"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/These limits belong to your provider account/),
    ).not.toBeInTheDocument();
  });

  it("shows the timed-out state instead of cards", () => {
    useProviderUsageMock.mockReturnValue({
      ...baseReturn,
      typedError: { code: "TIMEOUT", message: "No answer." },
    });
    renderView();
    expect(screen.getByTestId("provider-usage-timeout")).toBeInTheDocument();
    expect(
      screen.queryByTestId("provider-usage-cards"),
    ).not.toBeInTheDocument();
  });

  it("shows the unavailable state when the CLI is unreachable", () => {
    useProviderUsageMock.mockReturnValue({
      ...baseReturn,
      typedError: { code: "MACHINE_NOT_BOUND", message: "No machine." },
    });
    renderView();
    expect(screen.getByTestId("provider-usage-unavailable")).toHaveTextContent(
      "No machine.",
    );
  });

  it("renders not reported values and a failed provider beside healthy cards", () => {
    useProviderUsageMock.mockReturnValue({
      ...baseReturn,
      providers: [
        {
          provider: "claude",
          status: "unreported",
          observedAt: null,
          fiveHour: null,
          weekly: null,
        },
        {
          provider: "codex",
          status: "reported",
          observedAt: "2026-10-01T00:00:00.000Z",
          fiveHour: { usedPercent: 25, resetsAt: "2026-10-01T05:00:00.000Z" },
          weekly: { usedPercent: 60, resetsAt: null },
        },
        {
          provider: "opencode",
          status: "error",
          observedAt: null,
          fiveHour: null,
          weekly: null,
        },
      ],
    });
    renderView();

    expect(
      screen.getByTestId("provider-usage-card-claude-weekly"),
    ).toHaveTextContent("not reported");
    expect(
      screen.queryByTestId("provider-usage-card-claude-five-hour"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("provider-usage-card-codex-five-hour"),
    ).toHaveTextContent("25% used");
    expect(
      screen.getByTestId("provider-usage-card-codex-weekly"),
    ).toHaveTextContent("Resets not reported");
    expect(
      screen.getByTestId("provider-usage-card-opencode-error"),
    ).toHaveTextContent("Couldn't read usage");
    expect(
      screen.getByTestId("provider-usage-card-opencode"),
    ).not.toHaveTextContent("not reported");
    expect(
      screen.getAllByTestId(/^provider-usage-card-(claude|codex|opencode)$/),
    ).toHaveLength(3);
  });
});
