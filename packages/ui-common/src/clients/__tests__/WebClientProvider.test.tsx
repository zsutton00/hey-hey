import { render } from "@testing-library/react";
import { vi } from "vitest";

import { WebClientProvider } from "../WebClientProvider";
import type { ApiRuntime } from "../createApiRuntime";

const authMocks = vi.hoisted(() => ({
  browserApiAuthAdapter: {
    getAccessToken: vi.fn(() => null),
    refreshAccessToken: vi.fn(),
    onAuthChanged: vi.fn(() => () => undefined),
    onUnauthorized: vi.fn(),
  },
}));

vi.mock("../../services/authService", () => authMocks);

vi.mock("../runtime", () => ({
  initializeBrowserApiRuntime: vi.fn(),
  registerApiRuntime: vi.fn(),
}));

const { initializeBrowserApiRuntime, registerApiRuntime } = await import(
  "../runtime"
);

describe("WebClientProvider", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("initializes the browser runtime when one isn't provided", () => {
    const refreshAuthToken = vi.fn();

    render(
      <WebClientProvider
        baseUrl="https://example.test"
        refreshAuthToken={refreshAuthToken}
      >
        <div>child</div>
      </WebClientProvider>
    );

    expect(initializeBrowserApiRuntime).toHaveBeenCalledWith({
      baseUrl: "https://example.test",
      refreshAuthToken,
    });
    expect(registerApiRuntime).not.toHaveBeenCalled();
  });

  it("installs the cookie-backed browser adapter by default", () => {
    render(
      <WebClientProvider baseUrl="https://example.test">
        <div>child</div>
      </WebClientProvider>,
    );

    expect(initializeBrowserApiRuntime).toHaveBeenCalledWith({
      baseUrl: "https://example.test",
      authAdapter: authMocks.browserApiAuthAdapter,
    });
  });

  it("keeps the default browser adapter when only an unauthorized callback is supplied", () => {
    const onUnauthorized = vi.fn();

    render(
      <WebClientProvider
        baseUrl="https://example.test"
        onUnauthorized={onUnauthorized}
      >
        <div>child</div>
      </WebClientProvider>,
    );

    expect(initializeBrowserApiRuntime).toHaveBeenCalledWith({
      baseUrl: "https://example.test",
      onUnauthorized,
      authAdapter: authMocks.browserApiAuthAdapter,
    });
  });

  it("preserves an explicitly supplied auth adapter", () => {
    const explicitAdapter = {
      getAccessToken: vi.fn(() => null),
      refreshAccessToken: vi.fn(),
      onAuthChanged: vi.fn(() => () => undefined),
      onUnauthorized: vi.fn(),
    };

    render(
      <WebClientProvider
        baseUrl="https://example.test"
        authAdapter={explicitAdapter}
      >
        <div>child</div>
      </WebClientProvider>,
    );

    expect(initializeBrowserApiRuntime).toHaveBeenCalledWith({
      baseUrl: "https://example.test",
      authAdapter: explicitAdapter,
    });
  });

  it("registers a provided runtime", () => {
    const runtime = {
      baseUrl: "https://example.test",
      transport: {
        axios: {} as never,
        request: vi.fn(),
        setAuthToken: vi.fn(),
      },
      clients: {
        default: {} as never,
      },
    } as unknown as ApiRuntime;

    render(
      <WebClientProvider runtime={runtime}>
        <div>child</div>
      </WebClientProvider>
    );

    expect(registerApiRuntime).toHaveBeenCalledWith(runtime);
    expect(initializeBrowserApiRuntime).not.toHaveBeenCalled();
  });

  it("only sets up the runtime once per provider", () => {
    const { rerender } = render(
      <WebClientProvider baseUrl="https://example.test">
        <div>child</div>
      </WebClientProvider>
    );

    rerender(
      <WebClientProvider baseUrl="https://example.test">
        <div>child</div>
      </WebClientProvider>
    );

    expect(initializeBrowserApiRuntime).toHaveBeenCalledTimes(1);
  });
});
