import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usersQueryOptions } from "../users";
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getOrganizationMembers: read },
}));
describe("users queries", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shares reads and preserves the dataset projection", async () => {
    read.mockResolvedValue({
      data: {
        data: [
          { id: "b", user: { name: "Zoe" } },
          { id: "a", user: { name: "Ada" } },
        ],
      },
    });
    const client = new QueryClient();
    const options = usersQueryOptions("org");
    const [first, second] = await Promise.all([
      client.fetchQuery(options),
      client.fetchQuery(options),
    ]);
    expect(first).toEqual([
      { id: "a", user: { name: "Ada" } },
      { id: "b", user: { name: "Zoe" } },
    ]);
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
    await expect(client.fetchQuery(usersQueryOptions("org"))).rejects.toThrow(
      "forbidden"
    );
    expect(read).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
