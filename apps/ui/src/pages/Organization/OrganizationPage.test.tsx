import type { OrganizationResponseDto } from "@hey-hey/ui-common/api";
import { useOrganization } from "@hey-hey/ui-common/context";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationPage } from "./OrganizationPage";

const organizationState = vi.hoisted(() => ({
  organizations: [] as OrganizationResponseDto[],
  currentOrganization: null as OrganizationResponseDto | null,
  loading: false,
  switchOrganization: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  useOrganization: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  OrganizationMembersPanel: ({
    organizationId,
  }: {
    organizationId: string;
  }) => (
    <div
      data-testid="organization-members-panel"
      data-organization-id={organizationId}
    />
  ),
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="detail-page-container">{children}</div>
  ),
  DetailPageTabs: ({
    value,
    onChange,
    tabs,
  }: {
    value: string;
    onChange: (value: string) => void;
    tabs: Array<{ value: string; label: string }>;
  }) => (
    <div role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
  PageBreadcrumbs: ({
    items,
  }: {
    items: Array<{ label: string; isCurrent?: boolean; type?: string }>;
  }) => (
    <nav aria-label="breadcrumb" data-testid="breadcrumbs">
      {items.map((item) => (
        <span
          key={item.label}
          data-current={item.isCurrent ? "true" : "false"}
          data-type={item.type}
        >
          {item.label}
        </span>
      ))}
    </nav>
  ),
}));

const makeOrganization = (
  overrides: Partial<OrganizationResponseDto> = {},
): OrganizationResponseDto => ({
  id: "org-1",
  name: "Acme",
  slug: "acme",
  description: null,
  isActive: true,
  createdAt: "2026-01-15T09:00:00.000Z",
  updatedAt: "2026-01-15T09:00:00.000Z",
  userRole: "OWNER",
  ...overrides,
});

const useOrganizationMock = vi.mocked(useOrganization);

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/organizations"]}>
      <OrganizationPage />
    </MemoryRouter>,
  );

describe("OrganizationPage", () => {
  beforeEach(() => {
    organizationState.organizations = [];
    organizationState.currentOrganization = null;
    organizationState.loading = false;
    organizationState.switchOrganization
      .mockReset()
      .mockResolvedValue(undefined);
    useOrganizationMock.mockImplementation(
      () => organizationState as ReturnType<typeof useOrganization>,
    );
  });

  it("shows a loading state while organizations are being fetched", () => {
    organizationState.loading = true;

    renderPage();

    expect(screen.getByLabelText("Loading organizations")).toBeInTheDocument();
  });

  it("shows an empty selection state when there are no organizations", () => {
    renderPage();

    expect(
      screen.getByText("Select an organization to continue."),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Admin" })).toBeInTheDocument();
  });

  it("requires explicit selection even for a sole organization", () => {
    organizationState.organizations = [makeOrganization()];
    renderPage();
    expect(organizationState.switchOrganization).not.toHaveBeenCalled();
    expect(screen.queryByTestId("organization-overview")).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Organization" }),
    ).toBeInTheDocument();
  });

  it("lets multi-organization users switch the page identity", async () => {
    const firstOrganization = makeOrganization();
    const secondOrganization = makeOrganization({
      id: "org-2",
      name: "Globex",
      slug: "globex",
      createdAt: "2026-02-20T09:00:00.000Z",
    });
    organizationState.organizations = [firstOrganization, secondOrganization];
    organizationState.currentOrganization = firstOrganization;

    const { rerender } = renderPage();
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(
      screen.getByRole("option", { name: secondOrganization.name }),
    );

    expect(organizationState.switchOrganization).toHaveBeenCalledWith(
      secondOrganization.id,
    );
    organizationState.currentOrganization = secondOrganization;
    rerender(
      <MemoryRouter initialEntries={["/organizations"]}>
        <OrganizationPage />
      </MemoryRouter>,
    );

    expect(
      within(screen.getByTestId("organization-overview")).getByRole("heading", {
        name: secondOrganization.name,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("breadcrumbs")).toHaveTextContent(
      secondOrganization.name,
    );
  });

  it("renders the organization breadcrumb and organization-scoped tab slots", () => {
    const organization = makeOrganization();
    organizationState.organizations = [organization];
    organizationState.currentOrganization = organization;

    renderPage();

    const breadcrumb = screen.getByTestId("breadcrumbs");
    expect(breadcrumb).toHaveTextContent("Organizations");
    expect(breadcrumb.querySelector('[data-current="true"]')).toHaveAttribute(
      "data-type",
      "organization",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    expect(screen.getByTestId("organization-members-panel")).toHaveAttribute(
      "data-organization-id",
      organization.id,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
    expect(screen.getByTestId("organization-projects-slot")).toHaveAttribute(
      "data-organization-id",
      organization.id,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Admin" }));
    expect(screen.getByTestId("organization-admin-slot")).toHaveAttribute(
      "data-organization-id",
      organization.id,
    );
  });

  it("binds the Members tab to the newly selected organization", () => {
    const firstOrganization = makeOrganization();
    const secondOrganization = makeOrganization({
      id: "org-2",
      name: "Globex",
      slug: "globex",
    });
    organizationState.organizations = [firstOrganization, secondOrganization];
    organizationState.currentOrganization = firstOrganization;

    const { rerender } = renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    expect(screen.getByTestId("organization-members-panel")).toHaveAttribute(
      "data-organization-id",
      firstOrganization.id,
    );

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(
      screen.getByRole("option", { name: secondOrganization.name }),
    );
    organizationState.currentOrganization = secondOrganization;
    rerender(
      <MemoryRouter initialEntries={["/organizations"]}>
        <OrganizationPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));

    expect(screen.getByTestId("organization-members-panel")).toHaveAttribute(
      "data-organization-id",
      secondOrganization.id,
    );
  });
});
