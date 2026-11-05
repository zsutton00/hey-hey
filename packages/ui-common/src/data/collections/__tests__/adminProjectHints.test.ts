import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { adminProjectHintsQueryOptions } from "../adminProjectHints";

const list = vi.hoisted(() => vi.fn());
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getAdminProjectHints: list },
}));
vi.mock("../../core/requestInitiator", () => ({
  captureRequestOptions: () => ({}),
}));

describe("Admin graph Hints query", () => {
  it("passes organization and project to the generated client and unwraps data", async () => {
    const data = { hints: [] };
    list.mockResolvedValue({ data: { data } });
    const client = new QueryClient();
    expect(
      await client.fetchQuery(
        adminProjectHintsQueryOptions("organization", "project"),
      ),
    ).toEqual(data);
    expect(list).toHaveBeenCalledWith(
      {
        organizationId: "organization",
        projectId: "project",
        search: undefined,
        itemTypes: undefined,
        minStrength: undefined,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    client.clear();
  });
  it("sends filters as query parameters and keeps filtered results apart in the cache", async () => {
    list.mockResolvedValue({ data: { data: { hints: [] } } });
    const filters = { search: "api", itemTypes: ["FEATURE"], minStrength: 2 };
    const client = new QueryClient();
    await client.fetchQuery(
      adminProjectHintsQueryOptions("organization", "project", filters),
    );
    expect(list).toHaveBeenLastCalledWith(
      {
        organizationId: "organization",
        projectId: "project",
        ...filters,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      adminProjectHintsQueryOptions("organization", "project", filters)
        .queryKey,
    ).not.toEqual(
      adminProjectHintsQueryOptions("organization", "project").queryKey,
    );
    client.clear();
  });
  it("keeps project and organization caches distinct", () => {
    expect(adminProjectHintsQueryOptions("a", "p").queryKey).not.toEqual(
      adminProjectHintsQueryOptions("b", "p").queryKey,
    );
    expect(adminProjectHintsQueryOptions("a", "p").queryKey).not.toEqual(
      adminProjectHintsQueryOptions("a", "q").queryKey,
    );
  });
});
