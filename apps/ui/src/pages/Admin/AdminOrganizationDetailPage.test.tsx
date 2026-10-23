import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AdminOrganizationDetailPage } from "./AdminOrganizationDetailPage";

const mutate = vi.fn().mockResolvedValue({});
const refetchDetail = vi.fn().mockResolvedValue(null);
let entitlement = {
  subscriptionType: "BETA",
  accessStatus: "ACTIVE",
  accessThroughAt: "2026-12-01T00:00:00.000Z",
  paidThroughAt: null,
  effectiveAccessThroughAt: "2026-12-01T00:00:00.000Z",
  revision: 7,
};

vi.mock("@hey-hey/ui-common/data", () => ({
  useAdminOrganizationDetail: () => ({
    data: {
      organization: {
        id: "org-1",
        name: "Acme",
        createdAt: "2026-09-01T00:00:00.000Z",
        memberCount: 3,
        projectCount: 2,
      },
      entitlement,
      evidence: {
        workItemsCreatedAllTime: 9,
        agentSessionsCreatedAllTime: 4,
        latestAgentSessionActivityAt: "2026-09-08T00:00:00.000Z",
        workItemsByType: [
          {
            typeKey: "research_finding",
            displayName: "Research Findings",
            count: 9,
          },
        ],
      },
      latestAgentSessions: [
        {
          id: "session-1",
          name: "Research",
          sessionType: "CODING",
          status: "COMPLETED",
          projectId: "project-1",
          lastActivityAt: "2026-09-08T00:00:00.000Z",
        },
      ],
    },
    isForbidden: false,
    isLoading: false,
    isFetched: true,
    error: null,
    refetch: refetchDetail,
  }),
  useAdminOrganizationMembers: () => ({
    members: [
      {
        userId: "user-1",
        name: "Ada",
        email: "ada@example.com",
        organizationRole: "ADMIN",
        projectCount: 2,
        lastActiveAt: "2026-09-07T00:00:00.000Z",
      },
    ],
    totalCount: 1,
    nextCursor: null,
    isForbidden: false,
    isLoading: false,
    isFetched: true,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMakeOrganizationBetaAccessOpenEnded: () => ({
    mutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  OrganizationEntitlementMutationError: class extends Error {},
}));

describe("AdminOrganizationDetailPage", () => {
  it("shows all-time evidence, dynamic types, sessions, roles, and independent layouts", () => {
    render(
      <MemoryRouter initialEntries={["/admin/organizations/org-1"]}>
        <Routes>
          <Route
            path="/admin/organizations/:organizationId"
            element={<AdminOrganizationDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getAllByText(/All time/).length).toBeGreaterThan(1);
    expect(screen.getAllByText("Research Findings").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ADMIN").length).toBeGreaterThan(0);
    expect(
      screen.getByTestId("organization-evidence-desktop")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("organization-members-mobile")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("organization-entitlement-panel")
    ).toHaveTextContent("BETA");
  });

  it("confirms an eligible permanent-access change with the displayed revision", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/admin/organizations/org-1"]}>
        <Routes>
          <Route
            path="/admin/organizations/:organizationId"
            element={<AdminOrganizationDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    );
    await user.click(
      screen.getByRole("button", { name: "Make access permanent" })
    );
    const confirm = screen.getByRole("button", {
      name: "Confirm permanent access",
    });
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", { name: /Reason/ }),
      "Customer beta extension"
    );
    await user.click(confirm);
    expect(mutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      expectedRevision: 7,
      reason: "Customer beta extension",
    });
    expect(refetchDetail).toHaveBeenCalled();
  });

  it("shows Until revoked only for active open-ended beta access", () => {
    entitlement = {
      ...entitlement,
      accessThroughAt: null,
      effectiveAccessThroughAt: null,
    };
    render(
      <MemoryRouter initialEntries={["/admin/organizations/org-1"]}>
        <Routes>
          <Route
            path="/admin/organizations/:organizationId"
            element={<AdminOrganizationDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("Until revoked")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make access permanent" })
    ).not.toBeInTheDocument();
  });
});
