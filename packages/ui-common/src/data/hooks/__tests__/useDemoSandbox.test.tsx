import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoSandboxResponseDto } from "../../../api";

const client = vi.hoisted(() => ({
  getCurrentDemoSandbox: vi.fn(),
  resumeDemoSandbox: vi.fn(),
  provisionDemoSandbox: vi.fn(),
}));
const refreshAuthToken = vi.hoisted(() => vi.fn());

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: client,
}));
vi.mock("../../../services/authService", () => ({ refreshAuthToken }));

import { hasDemoSandboxSession } from "../../demoSandboxSession";
import {
  DemoSandboxProvisionError,
  useDemoSandbox,
  useDemoSandboxAdmission,
} from "../useDemoSandbox";

const sandbox: DemoSandboxResponseDto = {
  organizationId: "org-1",
  projectId: "project-1",
  expiresAt: "2026-10-17T14:30:00.000Z",
  inactivityTimeoutSeconds: 7200,
  repositoryUrl: "https://example.com/demo.git",
  resumed: false,
};

const ok = (data: unknown) => ({ data: { success: true, data } });
const httpError = (status: number, data: unknown) =>
  Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("useDemoSandbox", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    window.localStorage.clear();
    Object.values(client).forEach((fn) => fn.mockReset());
    refreshAuthToken.mockReset().mockResolvedValue({});
  });

  afterEach(() => queryClient.clear());

  it("returns the caller's sandbox and remembers the session belongs to a demo", async () => {
    client.getCurrentDemoSandbox.mockResolvedValue(ok(sandbox));

    const { result } = renderHook(() => useDemoSandbox(), { wrapper });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.sandbox).toEqual(sandbox);
    expect(hasDemoSandboxSession()).toBe(true);
  });

  it("treats a 404 as 'not a demo user' rather than an error and clears the hint", async () => {
    window.localStorage.setItem("heyhey.demoSandbox.session", "1");
    client.getCurrentDemoSandbox.mockRejectedValue(httpError(404, {}));

    const { result } = renderHook(() => useDemoSandbox(), { wrapper });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.sandbox).toBeNull();
    expect(result.current.error).toBeNull();
    expect(hasDemoSandboxSession()).toBe(false);
  });

  it("does not call the API while disabled", () => {
    renderHook(() => useDemoSandbox({ enabled: false }), { wrapper });

    expect(client.getCurrentDemoSandbox).not.toHaveBeenCalled();
  });
});

describe("useDemoSandboxAdmission", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.values(client).forEach((fn) => fn.mockReset());
    refreshAuthToken.mockReset().mockResolvedValue({});
  });

  it("resumes an existing sandbox and adopts the API-established session", async () => {
    client.resumeDemoSandbox.mockResolvedValue(
      ok({ ...sandbox, resumed: true }),
    );
    const { result } = renderHook(() => useDemoSandboxAdmission());

    await expect(result.current.resume()).resolves.toEqual({
      outcome: "resumed",
      sandbox: { ...sandbox, resumed: true },
    });
    expect(refreshAuthToken).toHaveBeenCalledOnce();
    expect(hasDemoSandboxSession()).toBe(true);
  });

  it.each([
    ["EXPIRED", "expired"],
    ["NONE", "none"],
  ])(
    "maps a %s resume miss to %s without starting a session",
    async (state, outcome) => {
      client.resumeDemoSandbox.mockRejectedValue(
        httpError(404, { data: { state } }),
      );
      const { result } = renderHook(() => useDemoSandboxAdmission());

      await expect(result.current.resume()).resolves.toEqual({ outcome });
      expect(refreshAuthToken).not.toHaveBeenCalled();
    },
  );

  it("surfaces unexpected resume failures", async () => {
    client.resumeDemoSandbox.mockRejectedValue(httpError(500, {}));
    const { result } = renderHook(() => useDemoSandboxAdmission());

    await expect(result.current.resume()).rejects.toThrow();
  });

  it("provisions with the supplied proof and versions", async () => {
    client.provisionDemoSandbox.mockResolvedValue(ok(sandbox));
    const { result } = renderHook(() => useDemoSandboxAdmission());
    const input = {
      botCheckToken: "token",
      demoTermsVersion: "1.2-beta",
      agentBridgeAcknowledgmentVersion: "1.2-beta",
    };

    await expect(result.current.provision(input)).resolves.toEqual(sandbox);
    expect(client.provisionDemoSandbox).toHaveBeenCalledWith({
      provisionDemoSandboxDto: input,
    });
    expect(refreshAuthToken).toHaveBeenCalledOnce();
  });

  it.each([
    [503, "DISABLED"],
    [503, "AT_CAPACITY"],
    [503, "PROVISIONING_FAILED"],
    [429, "RATE_LIMITED"],
    [400, "BOT_CHECK_FAILED"],
  ])("reports a %s %s response as that failure", async (status, code) => {
    client.provisionDemoSandbox.mockRejectedValue(httpError(status, { code }));
    const { result } = renderHook(() => useDemoSandboxAdmission());

    await expect(
      result.current.provision({
        botCheckToken: "t",
        demoTermsVersion: "v",
        agentBridgeAcknowledgmentVersion: "v",
      }),
    ).rejects.toMatchObject({ failure: code });
  });

  it("reports a stale document version (409) distinctly and anything else as unknown", async () => {
    const { result } = renderHook(() => useDemoSandboxAdmission());
    const input = {
      botCheckToken: "t",
      demoTermsVersion: "v",
      agentBridgeAcknowledgmentVersion: "v",
    };

    client.provisionDemoSandbox.mockRejectedValueOnce(httpError(409, {}));
    await expect(result.current.provision(input)).rejects.toMatchObject({
      failure: "STALE_TERMS_VERSION",
    });

    client.provisionDemoSandbox.mockRejectedValueOnce(httpError(500, {}));
    const error = await result.current
      .provision(input)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoSandboxProvisionError);
    expect(error).toMatchObject({ failure: "UNKNOWN" });
  });
});
