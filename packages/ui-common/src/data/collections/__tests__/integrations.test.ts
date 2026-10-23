import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { integrationsQueryOptions } from "../integrations";
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { findAllIntegrations: read },
}));
describe("integrations queries", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shares reads and preserves the dataset projection", async () => {
    read.mockResolvedValue({ data: { data: [{ id: "integration" }] } });
    const client = new QueryClient();
    const options = integrationsQueryOptions("org", "project", {
      page: 2,
      limit: 10,
      sortOrder: "asc",
    });
    const [first, second] = await Promise.all([
      client.fetchQuery(options),
      client.fetchQuery(options),
    ]);
    expect(first).toEqual([{ id: "integration" }]);
    expect(second).toBe(first);
    await client.fetchQuery(options);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org" }),
      {}
    );
    client.clear();
  });
  it("does not retry a client failure", async () => {
    read.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 })
    );
    const client = new QueryClient();
    await expect(
      client.fetchQuery(
        integrationsQueryOptions("org", "project", {
          page: 2,
          limit: 10,
          sortOrder: "asc",
        })
      )
    ).rejects.toThrow("forbidden");
    expect(read).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
