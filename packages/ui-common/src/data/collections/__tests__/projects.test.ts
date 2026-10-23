import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectsQueryOptions } from "../projects";
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../clients/serviceClients", () => ({
  platformClient: { findAllProjects: read },
}));
describe("projects queries", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shares reads and preserves the dataset projection", async () => {
    read.mockResolvedValue({
      data: {
        data: [
          { id: "kept", deletedAt: null },
          { id: "deleted", deletedAt: "today" },
        ],
      },
    });
    const client = new QueryClient();
    const options = projectsQueryOptions("org");
    const [first, second] = await Promise.all([
      client.fetchQuery(options),
      client.fetchQuery(options),
    ]);
    expect(first).toEqual([{ id: "kept", deletedAt: null }]);
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
      client.fetchQuery(projectsQueryOptions("org"))
    ).rejects.toThrow("forbidden");
    expect(read).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
