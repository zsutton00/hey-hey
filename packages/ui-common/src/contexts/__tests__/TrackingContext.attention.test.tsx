import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAttention } from "../../hooks/useAttention";
import { TrackingProvider, useUserAction } from "../TrackingContext";

const contextRegistrationCleanups = vi.hoisted(
  () => new Array<ReturnType<typeof vi.fn>>(),
);
const trackerMocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  initialize: vi.fn(),
  registerContextProvider: vi.fn(() => {
    const cleanup = vi.fn();
    contextRegistrationCleanups.push(cleanup);
    return cleanup;
  }),
  setUserId: vi.fn(),
  track: vi.fn(),
  updateConfig: vi.fn(),
}));

const analyticsMocks = vi.hoisted(() => ({
  trackAttentionEvents: vi.fn().mockResolvedValue(undefined),
}));
const prependMock = vi.hoisted(() => vi.fn());

vi.mock("../../services/userActionTracker", () => ({
  userActionTracker: trackerMocks,
}));
vi.mock("../../clients/serviceClients", () => ({
  analyticsClient: analyticsMocks,
}));
vi.mock("../../hooks/useAttention", () => ({ useAttention: vi.fn() }));
vi.mock("../../data/collections/attentionEvents", () => ({
  prependAttentionEvent: (_queryClient: unknown, event: unknown) =>
    prependMock(event),
}));
vi.mock("../OrganizationContext", () => ({
  useOrganization: () => ({
    currentOrganization: { id: "org-123", name: "Test Org" },
  }),
}));
vi.mock("../AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-123", email: "test@example.com" },
  }),
}));

describe("TrackingContext attention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextRegistrationCleanups.length = 0;
  });

  it("falls back to disabled no-op tracking without a provider", () => {
    const { result } = renderHook(() => useUserAction());

    expect(result.current.isEnabled).toBe(false);
    expect(() => {
      result.current.track({ category: "error", action: "view" });
      result.current.setContext({ page: { name: "test", path: "/test" } });
      result.current.trackNavigation("page_view", { toPage: "/test" });
    }).not.toThrow();
  });

  it("routes attention unconditionally without requiring an activation sink", () => {
    render(
      <TrackingProvider
        context={{
          attentionEntity: { type: "task", id: "task-123", tab: "editor" },
        }}
      >
        <div />
      </TrackingProvider>,
    );

    expect(useAttention).toHaveBeenCalledWith({
      entityType: "task",
      entityId: "task-123",
      tab: "editor",
    });
  });

  it("calls attention tracking for observational context", () => {
    render(
      <TrackingProvider
        context={{ page: { name: "Preview", path: "/preview" } }}
      >
        <div />
      </TrackingProvider>,
    );

    expect(useAttention).toHaveBeenCalledWith({
      entityType: undefined,
      entityId: undefined,
      tab: undefined,
    });
  });

  it("keeps nested tracker ownership and registration cleanup scoped", () => {
    const renderTree = (showInner: boolean) => (
      <TrackingProvider>
        {showInner ? (
          <TrackingProvider>
            <div />
          </TrackingProvider>
        ) : null}
      </TrackingProvider>
    );
    const { rerender, unmount } = render(renderTree(true));
    expect(trackerMocks.initialize).toHaveBeenCalledTimes(2);
    rerender(renderTree(false));
    expect(
      contextRegistrationCleanups.filter(
        (cleanup) => cleanup.mock.calls.length === 1,
      ),
    ).toHaveLength(1);
    expect(
      contextRegistrationCleanups.filter(
        (cleanup) => cleanup.mock.calls.length === 0,
      ),
    ).toHaveLength(1);
    expect(trackerMocks.destroy).toHaveBeenCalledTimes(1);

    unmount();
    contextRegistrationCleanups.forEach((cleanup) => {
      expect(cleanup).toHaveBeenCalledOnce();
    });
    expect(trackerMocks.destroy).toHaveBeenCalledTimes(2);
  });

  it("posts navigation attention and prepends its local response", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TrackingProvider
        context={{
          attentionEntity: {
            type: "task",
            id: "task-123",
            tab: "editor",
            name: "Migrate database",
            status: "active",
            projectId: "project-123",
          },
        }}
      >
        {children}
      </TrackingProvider>
    );
    const { result } = renderHook(() => useUserAction(), { wrapper });
    const timestamp = 1_700_000_000_000;

    act(() => {
      result.current.trackAttention({
        eventType: "attention",
        entity: { type: "task", id: "task-123" },
        tab: "editor",
        timestamp,
        kind: "navigation",
      });
    });

    expect(analyticsMocks.trackAttentionEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        trackAttentionEventsRequest: {
          events: [
            {
              eventType: "attention",
              entity: { type: "task", id: "task-123" },
              tab: "editor",
              timestamp,
            },
          ],
        },
      }),
    );
    expect(prependMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "TASK",
        entityId: "task-123",
        entityName: "Migrate database",
        focusStart: new Date(timestamp).toISOString(),
        focusEnd: new Date(timestamp).toISOString(),
      }),
    );
  });

  it("posts heartbeat attention without prepending navigation history", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TrackingProvider
        context={{ attentionEntity: { type: "task", id: "task-123" } }}
      >
        {children}
      </TrackingProvider>
    );
    const { result } = renderHook(() => useUserAction(), { wrapper });

    act(() => {
      result.current.trackAttention({
        eventType: "attention",
        entity: { type: "task", id: "task-123" },
        timestamp: Date.now(),
        kind: "heartbeat",
      });
    });

    expect(analyticsMocks.trackAttentionEvents).toHaveBeenCalledTimes(1);
    expect(prependMock).not.toHaveBeenCalled();
  });
});
