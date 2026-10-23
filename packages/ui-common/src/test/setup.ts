import "@testing-library/jest-dom";
import { beforeAll, beforeEach, afterEach, afterAll, expect, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  takeUnexpectedRequests,
  unexpectedRequestHandler,
} from "./networkGuard";
import type {
  ConversationCliStatusResponseDto,
  GetMessages200ResponseAllOfData,
  GetQueuedConversationInputs200Response,
  ListStars200Response,
  PaginatedWorkItemReferenceResponseDto,
} from "../api";
import WS from "jest-websocket-mock";
import type { RenderHookOptions, RenderOptions } from "@testing-library/react";

const testQueryClients = vi.hoisted(
  () => new Set<import("@tanstack/react-query").QueryClient>(),
);

// Data Layer collections on TanStack Query need a QueryClient, the way the
// Jotai-backed collections fall back to Jotai's default store. Give every
// render its own client, outside any wrapper the test supplies, so suites
// stay isolated and a test's own QueryClientProvider still wins.
vi.mock("@testing-library/react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@testing-library/react")>();
  const { createElement } = await import("react");
  // importActual: suites that mock TanStack still get a real provider here.
  const { QueryClient, QueryClientProvider } = await vi.importActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  type Wrapper = React.JSXElementConstructor<{ children: React.ReactNode }>;

  const withQueryClient = (Inner?: Wrapper) => {
    // Transient-failure retries still run, without real backoff delays.
    const client = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    testQueryClients.add(client);
    return function QueryClientTestWrapper({
      children,
    }: {
      children: React.ReactNode;
    }) {
      return createElement(
        QueryClientProvider,
        { client },
        Inner ? createElement(Inner, null, children) : children,
      );
    };
  };

  const render = (ui: React.ReactNode, options?: RenderOptions) =>
    actual.render(ui, {
      ...options,
      wrapper: withQueryClient(options?.wrapper as Wrapper | undefined),
    });
  const renderHook = (
    callback: (props: unknown) => unknown,
    options?: RenderHookOptions<unknown>,
  ) =>
    actual.renderHook(callback, {
      ...options,
      wrapper: withQueryClient(options?.wrapper as Wrapper | undefined),
    });

  return {
    ...actual,
    render: render as typeof actual.render,
    renderHook: renderHook as typeof actual.renderHook,
  };
});

// Use vi instead of jest for global mocks
global.fetch = vi.fn();

// Keep the default observer stable across suites that call restoreAllMocks().
// Tests that need resize callbacks can still replace it with vi.stubGlobal().
global.ResizeObserver = class ResizeObserverMock implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// React Flow reads the viewport transform through DOMMatrixReadOnly when it
// measures node internals; jsdom does not implement it.
if (typeof window !== "undefined" && !("DOMMatrixReadOnly" in window)) {
  class DOMMatrixReadOnlyMock {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([^)]+)\)/)?.[1];
      this.m22 = scale === undefined ? 1 : Number(scale);
    }
  }
  Object.defineProperty(window, "DOMMatrixReadOnly", {
    configurable: true,
    writable: true,
    value: DOMMatrixReadOnlyMock,
  });
}

// Mock IntersectionObserver for visibility-based hooks
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock window.matchMedia for animations when a browser-like global is available.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Handle unhandled rejections during tests (expected in error tests)
process.on("unhandledRejection", (reason, promise) => {
  // Only suppress specific test errors, not all unhandled rejections
  if (reason instanceof Error && reason.message === "Fetch failed") {
    // This is expected from our error handling tests
    return;
  }
  // Re-throw other unhandled rejections
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Components that render an interaction surface may resolve paired machines
// in the background even when the test is not exercising machine selection.
// Keep that read deterministic so an unrelated rejected request cannot tear
// down a Vitest worker while the test is finishing.
// Keep the launch fixture read available during teardown, when runtime handlers reset.
const server = setupServer(
  http.get(
    "*/api/v1/organizations/:organizationId/projects/:projectId/messages",
    ({ request }) => {
      const data: GetMessages200ResponseAllOfData =
        new URL(request.url).searchParams.get("mode") === "REVERSE_HISTORY"
          ? { messages: [] }
          : [];
      return HttpResponse.json({ data });
    },
  ),
  http.get(
    "*/api/v1/organizations/:organizationId/projects/:projectId/conversations/:conversationId/cli-status",
    () => {
      const data: ConversationCliStatusResponseDto = {
        connected: false,
        selectedMachineId: null,
        authorizationProtocolVersion: null,
        executionReadiness: "NO_MACHINE_SELECTED",
      };
      return HttpResponse.json({ data });
    },
  ),
  // These shared fixture reads also occur while component suites tear down.
  http.get("*/api/v1/organizations/:organizationId/stars", () => {
    const response: ListStars200Response = {
      success: true,
      message: "Stars loaded.",
      data: [],
      timestamp: "2026-01-01T00:00:00.000Z",
      statusCode: 200,
    };
    return HttpResponse.json(response);
  }),
  http.get(
    "*/api/v1/organizations/:organizationId/projects/:projectId/conversations/:conversationId/queued-inputs",
    () => {
      const response: GetQueuedConversationInputs200Response = {
        success: true,
        message: "Queued inputs loaded.",
        data: [],
        timestamp: "2026-01-01T00:00:00.000Z",
        statusCode: 200,
      };
      return HttpResponse.json(response);
    },
  ),
  http.get(
    "*/api/v1/organizations/:organizationId/projects/:projectId/work-items/references",
    () => {
      const data: PaginatedWorkItemReferenceResponseDto = {
        items: [],
        pagination: {
          page: 1,
          limit: 500,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrevious: false,
        },
      };
      return HttpResponse.json({ data });
    },
  ),
  http.get("*/api/v1/machines", () =>
    HttpResponse.json({
      success: true,
      message: "Machines loaded.",
      data: { machines: [] },
      timestamp: "2026-01-01T00:00:00.000Z",
      statusCode: 200,
    }),
  ),
  // Proposal review surfaces load reconciliation state; default to current.
  http.get("*/proposals/:proposalId/reconciliation", () =>
    HttpResponse.json({
      success: true,
      message: "Reconciliation loaded.",
      data: {
        status: "CURRENT",
        currentBases: [],
        revisions: [],
        conflictingPaths: [],
        interveningProposals: [],
        overlaps: [],
      },
      timestamp: "2026-01-01T00:00:00.000Z",
      statusCode: 200,
    }),
  ),
  // WebSocket integration tests exercise the service lifecycle without a
  // live Socket.IO server. Resolve the client handshake so MSW does not turn
  // the expected connection failure into an unhandled worker rejection.
  http.get("*/socket.io/", () => new HttpResponse(null, { status: 503 })),
  unexpectedRequestHandler,
);

// The runtime catalog has no built-in rows, so every test starts with the
// fixture catalog loaded; suites that exercise load states reset it themselves.
beforeEach(async () => {
  const [{ setCapabilityCatalogForTests }, { TEST_CAPABILITY_CATALOG }] =
    await Promise.all([
      import("../components/AgentSession/capabilityCatalog"),
      import("./capabilityCatalogFixture"),
    ]);
  setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
});

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

// Reset handlers after each test `important for test isolation`
afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  await Promise.all(
    [...testQueryClients].map((client) => client.cancelQueries()),
  );
  for (const client of testQueryClients) client.clear();
  testQueryClients.clear();
  server.resetHandlers();
  // Clean up WebSocket mocks after each test
  WS.clean();
  // Clear all vitest mocks
  vi.clearAllMocks();
  expect(
    takeUnexpectedRequests(),
    "Add explicit MSW handlers for unexpected requests",
  ).toEqual([]);
});

// Clean up after all tests
afterAll(() => server.close());

// Make server available globally for test setup
globalThis.mswServer = server;
