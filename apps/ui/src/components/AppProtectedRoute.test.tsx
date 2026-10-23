import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppProtectedRoute } from "./AppProtectedRoute";

const useAuthMock = vi.fn();
const usePrivateBetaDisclosureMock = vi.fn();

vi.mock("@hey-hey/ui-common/context", () => ({
  useAuth: () => useAuthMock(),
}));

const useDemoSandboxMock = vi.fn();
const hasDemoSandboxSessionMock = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  usePrivateBetaDisclosure: () => usePrivateBetaDisclosureMock(),
  useDemoSandbox: () => useDemoSandboxMock(),
  hasDemoSandboxSession: () => hasDemoSandboxSessionMock(),
}));

const LoginStateProbe = () => {
  const location = useLocation();
  const state = location.state as {
    from?: { pathname?: string; search?: string; hash?: string };
  } | null;

  return (
    <div>
      <div data-testid="login-path">{location.pathname}</div>
      <div data-testid="captured-path">{state?.from?.pathname}</div>
      <div data-testid="captured-search">{state?.from?.search}</div>
      <div data-testid="captured-hash">{state?.from?.hash}</div>
    </div>
  );
};

const DisclosureProbe = () => {
  const location = useLocation();
  const state = location.state as {
    from?: { pathname?: string; search?: string; hash?: string };
  } | null;

  return (
    <div>
      <div data-testid="disclosure-path">{location.pathname}</div>
      <div data-testid="disclosure-return-path">{state?.from?.pathname}</div>
      <div data-testid="disclosure-return-search">{state?.from?.search}</div>
    </div>
  );
};

const renderProtectedRoute = (initialEntry: string) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginStateProbe />} />
        <Route path="/demo" element={<div data-testid="demo-page" />} />
        <Route path="/private-beta/disclosure" element={<DisclosureProbe />} />
        <Route
          path="/projects/:projectId/features/:taskId"
          element={
            <AppProtectedRoute>
              <div data-testid="protected-content">Protected content</div>
            </AppProtectedRoute>
          }
        />
        <Route
          path="/pairing"
          element={
            <AppProtectedRoute>
              <div data-testid="protected-content">Protected content</div>
            </AppProtectedRoute>
          }
        />
        <Route
          path="/add-controller"
          element={
            <AppProtectedRoute>
              <div data-testid="protected-content">Protected content</div>
            </AppProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe("AppProtectedRoute", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    hasDemoSandboxSessionMock.mockReturnValue(false);
    useDemoSandboxMock.mockReturnValue({
      sandbox: null,
      isReady: true,
      isLoading: false,
      error: null,
    });
    usePrivateBetaDisclosureMock.mockReturnValue({
      data: {
        requiredDocuments: [
          {
            documentKind: "TERMS" as const,
            version: "1.2-beta",
            effectiveDate: "2026-09-14",
            actionType: "AGREED" as const,
          },
        ],
        recordedAcceptances: [
          {
            documentKind: "TERMS" as const,
            version: "1.2-beta",
            effectiveDate: "2026-09-14",
            actionType: "AGREED" as const,
          },
        ],
        isComplete: true,
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
  });

  it("captures the requested protected route before redirecting to login", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      loading: false,
    });

    renderProtectedRoute(
      "/projects/project-1/features/task-1?tab=docs#requirements"
    );

    expect(screen.getByTestId("login-path")).toHaveTextContent("/login");
    expect(screen.getByTestId("captured-path")).toHaveTextContent(
      "/projects/project-1/features/task-1"
    );
    expect(screen.getByTestId("captured-search")).toHaveTextContent(
      "?tab=docs"
    );
    expect(screen.getByTestId("captured-hash")).toHaveTextContent(
      "#requirements"
    );
  });

  it("sends a demo visitor whose session ended to the demo page instead of login", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      loading: false,
    });
    hasDemoSandboxSessionMock.mockReturnValue(true);

    renderProtectedRoute("/projects/project-1/features/task-1");

    expect(screen.getByTestId("demo-page")).toBeInTheDocument();
    expect(screen.queryByTestId("login-path")).not.toBeInTheDocument();
  });

  it("protects the deployment-level pairing route and preserves its return target", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      loading: false,
    });

    renderProtectedRoute("/pairing?code=BCDFGHJKLM");

    expect(screen.getByTestId("login-path")).toHaveTextContent("/login");
    expect(screen.getByTestId("captured-path")).toHaveTextContent("/pairing");
    expect(screen.getByTestId("captured-search")).toHaveTextContent(
      "?code=BCDFGHJKLM"
    );
  });

  it("protects the existing-machine controller route and preserves its code", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      loading: false,
    });

    renderProtectedRoute("/add-controller?code=BCDFG%20HJKLM");

    expect(screen.getByTestId("login-path")).toHaveTextContent("/login");
    expect(screen.getByTestId("captured-path")).toHaveTextContent(
      "/add-controller"
    );
    expect(screen.getByTestId("captured-search")).toHaveTextContent(
      "?code=BCDFG%20HJKLM"
    );
  });

  it("renders children when authenticated", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      loading: false,
    });

    renderProtectedRoute("/projects/project-1/features/task-1");

    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });

  it("requires current disclosure actions before entering a protected destination", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      loading: false,
    });
    usePrivateBetaDisclosureMock.mockReturnValue({
      data: {
        requiredDocuments: [],
        recordedAcceptances: [],
        isComplete: false,
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

    renderProtectedRoute("/projects/project-1/features/task-1?tab=docs");

    expect(screen.getByTestId("disclosure-path")).toHaveTextContent(
      "/private-beta/disclosure"
    );
    expect(screen.getByTestId("disclosure-return-path")).toHaveTextContent(
      "/projects/project-1/features/task-1"
    );
    expect(screen.getByTestId("disclosure-return-search")).toHaveTextContent(
      "?tab=docs"
    );
  });
});
