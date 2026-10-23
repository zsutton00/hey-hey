import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateBetaDisclosureGate } from "./PrivateBetaDisclosureGate";

const usePrivateBetaDisclosureMock = vi.fn();

const useDemoSandboxMock = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  usePrivateBetaDisclosure: () => usePrivateBetaDisclosureMock(),
  useDemoSandbox: () => useDemoSandboxMock(),
}));

const status = (isComplete: boolean) => ({
  data: {
    requiredDocuments: [
      {
        documentKind: "TERMS" as const,
        version: "1.2-beta",
        effectiveDate: "2026-09-14",
        actionType: "AGREED" as const,
      },
    ],
    recordedAcceptances: isComplete
      ? [
          {
            documentKind: "TERMS" as const,
            version: "1.2-beta",
            effectiveDate: "2026-09-14",
            actionType: "AGREED" as const,
          },
        ]
      : [],
    isComplete,
  },
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
  submitAcceptance: vi.fn(),
});

const DisclosureDestination = () => {
  const location = useLocation();
  return <div data-testid="destination">{location.pathname}</div>;
};

const renderGate = () =>
  render(
    <MemoryRouter initialEntries={["/projects/project-1"]}>
      <Routes>
        <Route
          path="/projects/project-1"
          element={
            <PrivateBetaDisclosureGate>
              <div data-testid="protected">Protected</div>
            </PrivateBetaDisclosureGate>
          }
        />
        <Route
          path="/private-beta/disclosure"
          element={<DisclosureDestination />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe("PrivateBetaDisclosureGate", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    useDemoSandboxMock.mockReturnValue({
      sandbox: null,
      isReady: true,
      isLoading: false,
      error: null,
    });
  });

  it("redirects incomplete accounts to the acceptance page", () => {
    usePrivateBetaDisclosureMock.mockReturnValue(status(false));

    renderGate();

    expect(screen.getByTestId("destination")).toHaveTextContent(
      "/private-beta/disclosure",
    );
    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
  });

  it("renders protected content after the current actions are complete", () => {
    usePrivateBetaDisclosureMock.mockReturnValue(status(true));

    renderGate();

    expect(screen.getByTestId("protected")).toBeInTheDocument();
  });

  it("lets a demo visitor through without the beta acceptance", () => {
    useDemoSandboxMock.mockReturnValue({
      sandbox: { projectId: "project-1" },
      isReady: true,
      isLoading: false,
      error: null,
    });
    usePrivateBetaDisclosureMock.mockReturnValue(status(false));

    renderGate();

    expect(screen.getByTestId("protected")).toBeInTheDocument();
    expect(screen.queryByTestId("destination")).not.toBeInTheDocument();
  });

  it("waits for the demo check before deciding an incomplete account must accept", () => {
    useDemoSandboxMock.mockReturnValue({
      sandbox: null,
      isReady: false,
      isLoading: true,
      error: null,
    });
    usePrivateBetaDisclosureMock.mockReturnValue(status(false));

    renderGate();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("destination")).not.toBeInTheDocument();
    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
  });

  it("fails closed when status cannot be read", () => {
    const refetch = vi.fn();
    usePrivateBetaDisclosureMock.mockReturnValue({
      ...status(false),
      data: null,
      isReady: false,
      error: new Error("network unavailable"),
      refetch,
    });

    renderGate();

    expect(
      screen.getByText(/product access is temporarily blocked/i),
    ).toBeInTheDocument();
    screen.getByRole("button", { name: /try again/i }).click();
    expect(refetch).toHaveBeenCalledOnce();
  });
});
