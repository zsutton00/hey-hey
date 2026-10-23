import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { describe, expect, it, vi } from "vitest";

import {
  createAccessToken,
  createBrowserApiRuntime,
  type ApiAuthAdapter,
} from "../createApiRuntime";

const unauthorized = (
  config: InternalAxiosRequestConfig,
): AxiosError =>
  new AxiosError(
    "Unauthorized",
    AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    {
      data: {},
      status: 401,
      statusText: "Unauthorized",
      headers: new AxiosHeaders(),
      config,
    },
  );

const success = (
  config: InternalAxiosRequestConfig,
): AxiosResponse<{ ok: true }> => ({
  data: { ok: true },
  status: 200,
  statusText: "OK",
  headers: new AxiosHeaders(),
  config,
});

const createAuthAdapter = (
  refreshAccessToken: ApiAuthAdapter["refreshAccessToken"],
) => {
  const onUnauthorized = vi.fn();
  const adapter: ApiAuthAdapter = {
    getAccessToken: () => createAccessToken("expired-token"),
    refreshAccessToken,
    onAuthChanged: () => () => undefined,
    onUnauthorized,
  };

  return { adapter, onUnauthorized };
};

const installAdapter = (
  authAdapter: ApiAuthAdapter,
  adapter: AxiosAdapter,
) => {
  const runtime = createBrowserApiRuntime({
    baseUrl: "https://example.test",
    authAdapter,
  });
  runtime.transport.axios.defaults.adapter = adapter;
  return runtime.transport.axios;
};

describe("createBrowserApiRuntime authentication", () => {
  it("includes HttpOnly browser credentials on non-auth API requests", async () => {
    const { adapter: authAdapter } = createAuthAdapter(vi.fn());
    const axiosAdapter = vi.fn<AxiosAdapter>(async (config) => success(config));
    const client = installAdapter(authAdapter, axiosAdapter);

    await client.get("/machines");

    expect(axiosAdapter).toHaveBeenCalledOnce();
    expect(axiosAdapter.mock.calls[0]?.[0].withCredentials).toBe(true);
  });

  it("shares one renewal wave across concurrent 401s and retries with the replacement bearer", async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue(
      createAccessToken("renewed-token"),
    );
    const { adapter: authAdapter, onUnauthorized } =
      createAuthAdapter(refreshAccessToken);
    const requests = new Map<string, number>();
    const axiosAdapter: AxiosAdapter = async (config) => {
      const url = config.url ?? "";
      requests.set(url, (requests.get(url) ?? 0) + 1);
      if (config.headers.get("Authorization") !== "Bearer renewed-token") {
        throw unauthorized(config);
      }
      return success(config);
    };
    const client = installAdapter(authAdapter, axiosAdapter);

    await expect(
      Promise.all([client.get("/protected-a"), client.get("/protected-b")]),
    ).resolves.toHaveLength(2);

    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(requests).toEqual(
      new Map([
        ["/protected-a", 2],
        ["/protected-b", 2],
      ]),
    );
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("retries an original request only once", async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue(
      createAccessToken("renewed-token"),
    );
    const { adapter: authAdapter, onUnauthorized } =
      createAuthAdapter(refreshAccessToken);
    const axiosAdapter = vi.fn<AxiosAdapter>(async (config) => {
      throw unauthorized(config);
    });
    const client = installAdapter(authAdapter, axiosAdapter);

    await expect(client.get("/still-unauthorized")).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(axiosAdapter).toHaveBeenCalledTimes(2);
    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("does not intercept the browser refresh endpoint", async () => {
    const refreshAccessToken = vi.fn();
    const { adapter: authAdapter, onUnauthorized } =
      createAuthAdapter(refreshAccessToken);
    const axiosAdapter = vi.fn<AxiosAdapter>(async (config) => {
      throw unauthorized(config);
    });
    const client = installAdapter(authAdapter, axiosAdapter);

    await expect(client.post("/auth/refresh")).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(axiosAdapter).toHaveBeenCalledOnce();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it.each([
    "/auth/login",
    "/auth/change-current-password",
  ])("lets %s own its unauthorized response", async (endpoint) => {
    const refreshAccessToken = vi.fn();
    const { adapter: authAdapter, onUnauthorized } =
      createAuthAdapter(refreshAccessToken);
    const axiosAdapter = vi.fn<AxiosAdapter>(async (config) => {
      throw unauthorized(config);
    });
    const client = installAdapter(authAdapter, axiosAdapter);

    await expect(client.post(endpoint)).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(axiosAdapter).toHaveBeenCalledOnce();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("notifies terminal unauthenticated state once when concurrent renewal fails", async () => {
    const renewalError = new Error("renewal failed");
    const refreshAccessToken = vi.fn().mockRejectedValue(renewalError);
    const { adapter: authAdapter, onUnauthorized } =
      createAuthAdapter(refreshAccessToken);
    const axiosAdapter: AxiosAdapter = async (config) => {
      throw unauthorized(config);
    };
    const client = installAdapter(authAdapter, axiosAdapter);

    const results = await Promise.allSettled([
      client.get("/protected-a"),
      client.get("/protected-b"),
    ]);

    expect(results).toEqual([
      { status: "rejected", reason: renewalError },
      { status: "rejected", reason: renewalError },
    ]);
    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
