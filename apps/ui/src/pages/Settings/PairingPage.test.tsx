import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PairingPage } from "./PairingPage";

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: ReactNode }) => (
    <main data-testid="detail-page-container">{children}</main>
  ),
  DetailPageHeader: ({ title }: { title: ReactNode }) => (
    <header>{title}</header>
  ),
  PageBreadcrumbs: ({
    items,
  }: {
    items: Array<{ label: string; isCurrent: boolean }>;
  }) => <nav data-testid="page-breadcrumbs">{items[0]?.label}</nav>,
}));

vi.mock("./ClaimMachine", () => ({
  ClaimMachine: ({
    initialCode,
    completionActionLabel,
    onCompletionAction,
    journey,
    authorizationTarget,
  }: {
    initialCode: string | null;
    completionActionLabel: string;
    onCompletionAction: () => void;
    journey?: "first-machine" | "existing-machine";
    authorizationTarget?: { machineId: string; machineName: string };
  }) => (
    <section
      data-testid="settings-machine-claim"
      data-initial-code={initialCode === null ? "missing" : initialCode}
      data-machine-id={authorizationTarget?.machineId}
      data-journey={journey}
    >
      Pairing journey
      <button type="button" onClick={onCompletionAction}>
        {completionActionLabel}
      </button>
    </section>
  ),
}));

const LocationState = () => {
  const location = useLocation();
  return <div data-testid="location-state">{location.pathname}</div>;
};

describe("PairingPage", () => {
  it("opens a target-specific browser authorization journey", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/pairing?intent=authorize-browser&machineId=machine-1&machineName=MacBook-Pro",
        ]}
      >
        <PairingPage />
      </MemoryRouter>
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

  it("renders the existing pairing journey without project context", () => {
    render(
      <MemoryRouter initialEntries={["/pairing"]}>
        <PairingPage />
        <LocationState />
      </MemoryRouter>
    );

    expect(screen.getByTestId("pairing-page")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pair an Agent Bridge" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("page-breadcrumbs")).toHaveTextContent("Pairing");
    expect(screen.getByTestId("settings-machine-claim")).toHaveAttribute(
      "data-initial-code",
      "missing"
    );
    expect(screen.getByTestId("settings-machine-claim")).toHaveAttribute(
      "data-journey",
      "first-machine"
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to projects" }));
    expect(screen.getByTestId("location-state")).toHaveTextContent("/projects");
  });

  it("opens the explicit existing-machine journey without trusting URL machine metadata", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/add-controller?code=bcdfg%20hjklm&intent=authorize-browser&machineId=forged-machine&machineName=Forged",
        ]}
      >
        <PairingPage journey="existing-machine" />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("heading", { name: "Add a controller" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("settings-machine-claim")).toHaveAttribute(
      "data-initial-code",
      "bcdfg hjklm"
    );
    expect(screen.getByTestId("settings-machine-claim")).toHaveAttribute(
      "data-journey",
      "existing-machine"
    );
    expect(screen.getByTestId("settings-machine-claim")).not.toHaveAttribute(
      "data-machine-id"
    );
  });

  it.each([
    ["a code", "/pairing?code=BCDFG-HJKLM", "BCDFG-HJKLM"],
    ["an encoded code", "/pairing?code=bcdfg%20hjklm", "bcdfg hjklm"],
    ["an empty code", "/pairing?code=", ""],
  ])(
    "passes %s from the protected route into the journey",
    (_label, entry, expected) => {
      render(
        <MemoryRouter initialEntries={[entry]}>
          <PairingPage />
        </MemoryRouter>
      );

      expect(screen.getByTestId("settings-machine-claim")).toHaveAttribute(
        "data-initial-code",
        expected
      );
    }
  );
});
