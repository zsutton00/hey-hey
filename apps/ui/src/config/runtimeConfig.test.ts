import { afterEach, describe, expect, it } from "vitest";
import { getApiBaseUrl, getWsUrl } from "@hey-hey/ui-common/services";

const resetRuntimeConfig = () => {
  delete window.__HEY_HEY_RUNTIME_CONFIG__;
};

afterEach(() => {
  resetRuntimeConfig();
});

describe("runtimeConfig", () => {
  it("uses a browser-relative API path for internal container hostnames", () => {
    window.__HEY_HEY_RUNTIME_CONFIG__ = {
      apiUrl: "http://api/api",
    };

    expect(getApiBaseUrl()).toBe("/api");
  });

  it("derives a browser-reachable websocket URL from an internal API hostname", () => {
    window.__HEY_HEY_RUNTIME_CONFIG__ = {
      apiUrl: "http://api/api",
    };

    expect(getWsUrl()).toBe(`ws://${window.location.host}`);
  });

  it("normalizes explicit websocket URLs that use internal container hostnames", () => {
    window.__HEY_HEY_RUNTIME_CONFIG__ = {
      wsUrl: "ws://api/socket",
    };

    expect(getWsUrl()).toBe(`ws://${window.location.host}/socket`);
  });

  it("preserves localhost API URLs for local development", () => {
    window.__HEY_HEY_RUNTIME_CONFIG__ = {
      apiUrl: "http://localhost:3000/api/v1",
    };

    expect(getApiBaseUrl()).toBe("http://localhost:3000/api/v1");
    expect(getWsUrl()).toBe("ws://localhost:3000");
  });
});
