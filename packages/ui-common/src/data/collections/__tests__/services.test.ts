import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../clients", () => ({ dataClient: { request } }));

import {
  createServiceInvalidator,
  serviceKeys,
  serviceQueryOptions,
  servicesQueryOptions,
} from "../services";
import { dataLayerQueryPolicy } from "../../query/queryPolicy";

const ok = (data: unknown) => ({ data: { success: true, data } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("serviceKeys", () => {
  it("nests every read under the organization prefix", () => {
    expect(serviceKeys.root()).toEqual(["services"]);
    expect(serviceKeys.all("org-1")).toEqual(["services", "org-1"]);
    expect(serviceKeys.lists("org-1")).toEqual(["services", "org-1", "list"]);
    expect(serviceKeys.byId("org-1", "service-1")).toEqual([
      "services",
      "org-1",
      "byId",
      "service-1",
    ]);
  });

  it.each([
    ["no filters", undefined, { projectId: null, status: null }],
    ["projectId", { projectId: "project-1" }, { projectId: "project-1", status: null }],
    ["status", { status: "ACTIVE" as const }, { projectId: null, status: "ACTIVE" }],
    [
      "all filters",
      { projectId: "project-1", status: "ARCHIVED" as const },
      { projectId: "project-1", status: "ARCHIVED" },
    ],
    [
      "undefined filters",
      { projectId: undefined, status: "ACTIVE" as const },
      { projectId: null, status: "ACTIVE" },
    ],
    [
      "empty string filters",
      { projectId: "", status: "ACTIVE" as const },
      { projectId: null, status: "ACTIVE" },
    ],
  ])("builds list keys with %s", (_label, filters, expected) => {
    expect(serviceKeys.list("org-1", filters)).toEqual([
      "services",
      "org-1",
      "list",
      expected,
    ]);
  });
});

describe("servicesQueryOptions", () => {
  it("uses the shared policy and list key", () => {
    const options = servicesQueryOptions("org-1", { projectId: "project-1" });
    expect(options.queryKey).toEqual(
      serviceKeys.list("org-1", { projectId: "project-1" })
    );
    expect(options.staleTime).toBe(dataLayerQueryPolicy.staleTime);
  });

  it("requests the organization services with only set filters", async () => {
    request.mockResolvedValue(ok([{ id: "service-1" }]));
    const client = new QueryClient();

    const data = await client.fetchQuery(
      servicesQueryOptions("org-1", { projectId: "", status: "ACTIVE" })
    );

    expect(data).toEqual([{ id: "service-1" }]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/organizations/org-1/services",
        params: { status: "ACTIVE" },
      })
    );
  });

  it("returns an empty list when the response has no array", async () => {
    request.mockResolvedValue(ok(undefined));
    const client = new QueryClient();

    await expect(
      client.fetchQuery(servicesQueryOptions("org-1"))
    ).resolves.toEqual([]);
  });
});

describe("serviceQueryOptions", () => {
  it("reads one service by id", async () => {
    request.mockResolvedValue(ok({ id: "service-1" }));
    const client = new QueryClient();

    const data = await client.fetchQuery(
      serviceQueryOptions("org-1", "service-1")
    );

    expect(data).toEqual({ id: "service-1" });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/organizations/org-1/services/service-1",
      })
    );
  });

  it("fails instead of caching a missing service as null", async () => {
    request.mockResolvedValue(ok(null));
    const client = new QueryClient();

    await expect(
      client.fetchQuery({
        ...serviceQueryOptions("org-1", "missing"),
        retry: false,
      })
    ).rejects.toThrow("Service not found: missing");
  });
});

describe("createServiceInvalidator", () => {
  it("maps scopes to the organization prefix and items to by-id keys", () => {
    const invalidate = vi.fn();
    const invalidator = createServiceInvalidator("org-1", invalidate);

    expect(
      invalidator.buildScopeKey?.({ lookupField: "projectId", lookupValue: "p" })
    ).toEqual(serviceKeys.all("org-1"));
    expect(invalidator.buildItemKey?.({ id: "service-1" })).toEqual(
      serviceKeys.byId("org-1", "service-1")
    );

    invalidator.dispatch({
      type: "MARK_STALE",
      queryKey: serviceKeys.all("org-1"),
    });
    expect(invalidate).toHaveBeenCalledWith(serviceKeys.all("org-1"));
  });
});
