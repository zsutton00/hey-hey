import axios, { type AxiosAdapter } from "axios";
import { expect, it, vi } from "vitest";
import { createApiRuntime } from "../createApiRuntime";

it("sends initial and confirmed Apply through the generated runtime client", async () => {
  const adapter = vi.fn<AxiosAdapter>(async (config) => ({
    data: { success: true },
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  }));
  const runtime = createApiRuntime({
    baseUrl: "/api/v1",
    transport: {
      axios: axios.create({ adapter }),
      request: vi.fn(),
      setAuthToken: vi.fn(),
      onUnauthorized: vi.fn(() => () => undefined),
    },
  });
  const request = {
    organizationId: "org",
    projectId: "project",
    futureId: "future",
  };
  const confirmation = {
    revision: 2,
    refinements: [
      { proposalId: "refinement", updatedAt: "2026-09-28T00:00:00Z" },
    ],
  };
  for (const futureApplyRequest of [
    { expectedRevision: 2 },
    { expectedRevision: 2, confirmation },
  ]) {
    await runtime.clients.proposals.applyProposalFuture({
      ...request,
      futureApplyRequest,
    });
    const config = adapter.mock.lastCall?.[0];
    expect(config?.method).toBe("post");
    expect(config?.url).toBe(
      "/api/v1/organizations/org/projects/project/proposals/futures/future/apply",
    );
    expect(config?.data).toBe(JSON.stringify(futureApplyRequest));
  }
});

it("reads project-ready futures through the generated proposal client with independent pagination", async () => {
  const adapter = vi.fn<AxiosAdapter>(async (config) => ({
    data: {
      success: true,
      data: { items: [], total: 0, limit: 10, offset: 20, unavailableCount: 0 },
    },
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  }));
  const runtime = createApiRuntime({
    baseUrl: "/api/v1",
    transport: {
      axios: axios.create({ adapter }),
      request: vi.fn(),
      setAuthToken: vi.fn(),
      onUnauthorized: vi.fn(() => () => undefined),
    },
  });
  await runtime.clients.proposals.listProjectReadyFutures({
    organizationId: "org",
    projectId: "project",
    limit: 10,
    offset: 20,
  });
  const config = adapter.mock.lastCall?.[0];
  expect(config?.method).toBe("get");
  expect(config?.url).toBe(
    "/api/v1/organizations/org/projects/project/proposals/futures/ready?limit=10&offset=20",
  );
});
