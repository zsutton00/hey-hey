import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectSessionCosts } from "../../../../data/hooks/useProjectSessionCosts";
import { CostsActivityView } from "../CostsActivityView";

vi.mock("../../../../data/hooks/useProjectSessionCosts", () => ({
  useProjectSessionCosts: vi.fn(),
}));

const useProjectSessionCostsMock = vi.mocked(useProjectSessionCosts);
const baseReturn: ReturnType<typeof useProjectSessionCosts> = {
  result: null,
  typedError: null,
  requestError: null,
  isInitialLoading: false,
  isLoadingMore: false,
  hasNextPage: false,
  loadNextPage: vi.fn(),
};

describe("CostsActivityView", () => {
  beforeEach(() => {
    useProjectSessionCostsMock.mockReturnValue(baseReturn);
  });

  it("renders connected-CLI unavailability separately from an empty result", () => {
    useProjectSessionCostsMock.mockReturnValue({
      ...baseReturn,
      typedError: {
        code: "MACHINE_NOT_BOUND",
        message: "No connected machine.",
      },
    });

    render(
      <MemoryRouter>
        <CostsActivityView
          organizationId="org-1"
          projectId="project-1"
          routingAgentSessionId="routing-session-1"
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId("costs-activity-unavailable")).toHaveTextContent(
      "No connected machine."
    );
    expect(
      screen.queryByTestId("costs-activity-empty")
    ).not.toBeInTheDocument();
  });

  it("renders aggregate, completeness, freshness, and expandable provider details", async () => {
    const user = userEvent.setup();
    useProjectSessionCostsMock.mockReturnValue({
      ...baseReturn,
      result: {
        items: [
          {
            agentSessionId: "11111111-1111-4111-8111-111111111111",
            conversationId: "22222222-2222-4222-8222-222222222222",
            context: {
              entityType: "TASK",
              entityId: "33333333-3333-4333-8333-333333333333",
              entityTitle: "Implement Costs",
              promptType: "coding",
            },
            providerSessions: [
              {
                providerId: "claude",
                providerSessionId: "provider-session-1",
                providerConversationId: null,
                providerSessionAgentId: null,
                observedAt: "2026-07-28T11:00:00.000Z",
                cost: {
                  state: "available",
                  amountUsd: 4.25,
                  currency: "USD",
                  source: "ccusage",
                },
              },
              {
                providerId: "codex",
                providerSessionId: "provider-session-2",
                providerConversationId: null,
                providerSessionAgentId: null,
                observedAt: "2026-07-28T11:30:00.000Z",
                cost: {
                  state: "unavailable",
                  reason: "unsupported_provider",
                },
              },
            ],
            knownCostUsd: 4.25,
            completeness: "partial",
            latestActivityAt: "2026-07-28T11:30:00.000Z",
            costReadAt: "2026-07-28T12:00:00.000Z",
          },
        ],
        nextCursor: null,
        sourceAvailability: "partial",
        costReadAt: "2026-07-28T12:00:00.000Z",
      },
    });

    render(
      <MemoryRouter>
        <CostsActivityView
          organizationId="org-1"
          projectId="project-1"
          routingAgentSessionId="routing-session-1"
        />
      </MemoryRouter>
    );

    const row = screen.getByTestId("costs-activity-row");
    expect(row).toHaveTextContent("Implement Costs");
    expect(row).toHaveTextContent("partial");
    expect(within(row).getByTestId("costs-known-aggregate")).toHaveTextContent(
      "$4.25"
    );

    await user.click(within(row).getByRole("button"));

    expect(screen.getAllByTestId("costs-provider-session")).toHaveLength(2);
    expect(screen.getByText("provider-session-1")).toBeInTheDocument();
    expect(
      screen.getByText(/Unavailable — unsupported provider/)
    ).toBeInTheDocument();
  });

  it("binds date and positive minimum filters to the collection hook", async () => {
    render(
      <CostsActivityView
        organizationId="org-1"
        projectId="project-1"
        routingAgentSessionId="routing-session-1"
      />
    );

    fireEvent.change(screen.getByLabelText("Activity from"), {
      target: { value: "2026-07-01T00:00:00" },
    });
    fireEvent.change(screen.getByLabelText("Minimum known cost (USD)"), {
      target: { value: "2.5" },
    });

    await waitFor(() =>
      expect(useProjectSessionCostsMock).toHaveBeenLastCalledWith(
        "org-1",
        "project-1",
        "routing-session-1",
        expect.objectContaining({
          activityFrom: new Date("2026-07-01T00:00:00").toISOString(),
          minKnownCostUsd: 2.5,
          limit: 25,
        })
      )
    );
  });

  it("does not expose a manual first-page refresh control", () => {
    render(
      <CostsActivityView
        organizationId="org-1"
        projectId="project-1"
        routingAgentSessionId="routing-session-1"
      />
    );

    expect(
      screen.queryByTestId("costs-activity-refresh")
    ).not.toBeInTheDocument();
  });
});
