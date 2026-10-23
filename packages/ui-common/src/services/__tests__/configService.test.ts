import { io } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configService } from "../configService";
import {
  getApiBaseUrl,
  getWsUrl,
  type RuntimeConfigShape,
} from "../runtimeConfig";
import { WorkflowService } from "../workflowService";
import { CollabSectionClient } from "../collab/CollabSectionClient";

const socket = vi.hoisted(() => ({
  on: vi.fn(),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(),
  io: { on: vi.fn() },
}));
vi.mock("socket.io-client", () => ({ io: vi.fn(() => socket) }));
vi.mock("../authService", () => ({ getAuthToken: () => null }));

const configureBrowser = (runtime: RuntimeConfigShape) => {
  vi.stubGlobal("window", {
    location: new URL("https://staging.heyhey.dev"),
    __HEY_HEY_RUNTIME_CONFIG__: runtime,
  });
  configService.resetConfig();
};

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "");
  vi.stubEnv("VITE_WS_URL", "");
  vi.stubEnv("VITE_ENV", "");
  vi.stubEnv("MODE", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  configService.resetConfig();
});

describe("deployment configuration", () => {
  it("gives deployment URLs and environment precedence over build-time values", () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:3000/api/v1");
    vi.stubEnv("VITE_WS_URL", "ws://localhost:3000");
    vi.stubEnv("VITE_ENV", "development");
    configureBrowser({
      apiUrl: "https://staging.heyhey.dev/api/v1",
      wsUrl: "wss://staging.heyhey.dev/socket.io",
      env: "staging",
    });
    expect(configService.getApiBaseUrl()).toBe(
      "https://staging.heyhey.dev/api/v1"
    );
    expect(configService.getWsUrl()).toBe("wss://staging.heyhey.dev/socket.io");
    expect(configService.getEnvironment()).toBe("staging");
    expect(configService.isFeatureEnabled("debugTools")).toBe(false);
    expect(configService.getApiBaseUrl()).toBe(getApiBaseUrl());
    expect(configService.getWsUrl()).toBe(getWsUrl());
  });

  it.each(["/api/v1", "http://api:3000/api/v1"])(
    "resolves %s against the browser for WebSocket connections",
    (apiUrl) => {
      configureBrowser({ apiUrl });
      expect(configService.getApiBaseUrl()).toBe("/api/v1");
      expect(configService.getWsUrl()).toBe("wss://staging.heyhey.dev");
    }
  );

  it("resolves explicit relative WebSocket URLs using secure browser transport", () => {
    configureBrowser({ wsUrl: "/socket.io" });
    expect(configService.getWsUrl()).toBe("wss://staging.heyhey.dev/socket.io");
  });

  it("preserves explicit local development configuration", () => {
    configureBrowser({ apiUrl: "http://localhost:3000/api/v1" });
    expect(configService.getApiBaseUrl()).toBe("http://localhost:3000/api/v1");
    expect(configService.getWsUrl()).toBe("ws://localhost:3000");
  });

  it("supports build-time URLs when deployment URLs are absent", () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com/api/v1");
    configureBrowser({});
    expect(configService.getApiBaseUrl()).toBe(
      "https://api.example.com/api/v1"
    );
    expect(configService.getWsUrl()).toBe("wss://api.example.com");
  });

  it.each(["https://staging.heyhey.dev/api/v1", "/api/v1"])(
    "sends workflow requests through deployment API %s",
    async (apiUrl) => {
      configureBrowser({ apiUrl });
      const fetchImplementation = vi.fn(
        async () => new Response(JSON.stringify({ data: { templates: [] } }))
      );
      const service = new WorkflowService({ fetchImplementation });
      await expect(service.getWorkflowTemplates()).resolves.toEqual([]);
      expect(fetchImplementation).toHaveBeenCalledWith(
        "https://staging.heyhey.dev/api/v1/workflows/templates",
        expect.objectContaining({ method: "GET", credentials: "include" })
      );
    }
  );

  it("connects collaborative editing through the configured server", () => {
    configureBrowser({ apiUrl: "/api/v1" });
    const client = new CollabSectionClient({
      sectionId: "section-1",
      connectOnStart: false,
    });
    try {
      client.connect();
      expect(io).toHaveBeenCalledWith(
        "wss://staging.heyhey.dev/collab/sections/section-1",
        { transports: ["websocket"] }
      );
      expect(client.getStatus().status).toBe("connecting");
    } finally {
      client.destroy();
    }
  });
});
