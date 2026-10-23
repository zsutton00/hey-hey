import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

interface MockBreadcrumbItem {
  label: string;
  to?: string;
  isCurrent?: boolean;
}

vi.mock("../../components/Layout", async () => {
  const actual = await vi.importActual<
    typeof import("../../components/Layout")
  >("../../components/Layout");
  return {
    ...actual,
    PageBreadcrumbs: ({
      items,
      testIdPrefix = "breadcrumbs",
    }: {
      items: MockBreadcrumbItem[];
      testIdPrefix?: string;
    }) => (
      <nav data-testid={testIdPrefix}>
        {items.map((item, index) => (
          <span
            key={`${item.label}-${index}`}
            data-testid={`${testIdPrefix}-item-${index}`}
            data-current={item.isCurrent ? "true" : "false"}
          >
            {item.label}
          </span>
        ))}
      </nav>
    ),
  };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "navigation.settings") return "Settings";
      return key;
    },
  }),
}));

vi.mock("./ClaimMachine", () => ({
  ClaimMachine: ({
    completionActionLabel,
    onCompletionAction,
    authorizationTarget,
  }: {
    completionActionLabel: string;
    onCompletionAction: () => void;
    authorizationTarget?: { machineId: string; machineName: string };
  }) => (
    <div
      data-testid="settings-machine-claim"
      data-machine-id={authorizationTarget?.machineId}
      data-machine-name={authorizationTarget?.machineName}
    >
      <button type="button" onClick={onCompletionAction}>
        {completionActionLabel}
      </button>
    </div>
  ),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useUserPairedMachines: () => ({
    machines: [],
    data: [],
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  }),
  useRevokeMachine: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  useAbandonMachineEnrollmentClaim: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  useBeginMachineEnrollmentClaim: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  useCompleteMachineEnrollmentClaim: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({
    name: "Zac",
    email: "zac@example.com",
    currentOrgId: "org-1",
  }),
}));

const changeCurrentPassword = vi.hoisted(() => vi.fn());

vi.mock("@hey-hey/ui-common/context", () => ({
  useAuth: () => ({ changeCurrentPassword }),
  useOptionalOrganization: () => ({
    currentOrganization: { id: "org-1", name: "Hey Hey" },
  }),
}));

const LocationState = () => {
  const location = useLocation();
  return (
    <div data-testid="location-state">
      {location.pathname}
      {location.search}
    </div>
  );
};

const renderPage = (initialEntry = "/projects/project-1/settings") =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SettingsPage />
      <LocationState />
    </MemoryRouter>
  );

describe("SettingsPage", () => {
  it("opens target-specific browser authorization from recovery links", () => {
    renderPage(
      "/settings?section=pairing&intent=authorize-browser&machineId=machine-1&machineName=MacBook-Pro"
    );

    expect(
      screen.getByRole("heading", {
        name: "Authorize this browser for MacBook-Pro",
      })
    ).toBeInTheDocument();
    expect(screen.getByTestId("settings-machine-claim")).toHaveAttribute(
      "data-machine-id",
      "machine-1"
    );
  });

  it("renders the page root", () => {
    renderPage();
    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
  });

  it("renders the localized Settings heading", () => {
    renderPage();
    const heading = screen.getByTestId("settings-page-heading");
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent("Settings");
  });

  it("renders the machines section slot", () => {
    renderPage();
    expect(screen.getByTestId("settings-machines-section")).toBeInTheDocument();
  });

  it("renders the Password section separately from Agent Bridges", () => {
    renderPage();

    expect(screen.getByTestId("settings-password-section")).toHaveTextContent(
      "Password"
    );
    expect(
      screen.getByTestId("settings-change-password-button")
    ).toHaveTextContent("Change Password");
    expect(screen.getByTestId("settings-machines-section")).toBeInTheDocument();
    expect(screen.getByTestId("settings-machines-heading")).toHaveTextContent(
      "Agent Bridges"
    );
    expect(screen.getByTestId("settings-machines-section")).toHaveTextContent(
      "Hey Hey CLIs"
    );
  });

  it("shows the shared password form after choosing Change Password", () => {
    renderPage();

    expect(
      screen.queryByTestId("current-password-change-form")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-change-password-button"));

    expect(
      screen.getByTestId("current-password-change-form")
    ).toBeInTheDocument();
  });

  it("renders the Agent Bridge list and Pair action without the claim journey", () => {
    renderPage();
    const section = screen.getByTestId("settings-machines-section");
    expect(screen.getByTestId("settings-machines-empty")).toBeInTheDocument();
    expect(
      screen.getByTestId("settings-pair-machine-button")
    ).toHaveTextContent("Pair an Agent Bridge");
    expect(section).toContainElement(
      screen.getByTestId("settings-pair-machine-button")
    );
    expect(
      screen.queryByTestId("settings-machine-claim")
    ).not.toBeInTheDocument();
  });

  it("opens the focused Pairing journey from the Machines action", () => {
    renderPage("/projects/project-1/settings?source=settings");

    fireEvent.click(screen.getByTestId("settings-pair-machine-button"));

    expect(screen.getByTestId("settings-pairing-view")).toBeInTheDocument();
    expect(screen.getByTestId("settings-machine-claim")).toBeInTheDocument();
    expect(screen.getByTestId("location-state")).toHaveTextContent(
      "/projects/project-1/settings?source=settings&section=pairing"
    );
  });

  it("renders breadcrumbs with Settings marked as the current crumb", () => {
    renderPage();
    const breadcrumbs = screen.getByTestId("breadcrumbs");
    expect(breadcrumbs).toBeInTheDocument();
    const currentCrumb = screen.getByTestId("breadcrumbs-item-0");
    expect(currentCrumb).toHaveTextContent("Settings");
    expect(currentCrumb).toHaveAttribute("data-current", "true");
  });

  it("focuses the existing Pairing journey from the section query", () => {
    renderPage("/projects/project-1/settings?section=pairing");

    expect(screen.getByTestId("settings-pairing-view")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pair an Agent Bridge" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("settings-machine-claim")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-page")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-password-section")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-machines-section")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("breadcrumbs-item-0")).toHaveTextContent(
      "Settings"
    );
    expect(screen.getByTestId("breadcrumbs-item-1")).toHaveTextContent(
      "Pairing"
    );
  });

  it("returns to the Settings landing while preserving unrelated query state", () => {
    renderPage(
      "/projects/project-1/settings?section=pairing&source=account-menu"
    );

    fireEvent.click(screen.getByTestId("settings-pairing-back"));

    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-pairing-view")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("location-state")).toHaveTextContent(
      "/projects/project-1/settings?source=account-menu"
    );
  });

  it("returns to Settings from the pairing completion action", () => {
    renderPage(
      "/projects/project-1/settings?section=pairing&source=account-menu"
    );

    fireEvent.click(screen.getByRole("button", { name: "Return to settings" }));

    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
    expect(screen.getByTestId("location-state")).toHaveTextContent(
      "/projects/project-1/settings?source=account-menu"
    );
  });

  it("treats unknown sections as the Settings landing", () => {
    renderPage("/projects/project-1/settings?section=unknown");

    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-pairing-view")
    ).not.toBeInTheDocument();
  });
});
