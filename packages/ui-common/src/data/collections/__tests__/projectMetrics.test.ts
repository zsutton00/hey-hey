import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ActivityActorScopeMode } from "../../../api";
import {
  projectMetricsQueryOptions,
  buildProjectMetricsRequest,
} from "../projectMetrics";
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../clients/serviceClients", () => ({
  projectsClient: { getProjectMetrics: read },
}));
describe("metrics identity", () => {
  it("normalizes absent project and actor identities and separates server variants", () => {
    const base = projectMetricsQueryOptions({ organizationId: "org" }).queryKey;
    expect(
      projectMetricsQueryOptions({
        organizationId: "org",
        projectId: " ",
        actorUserId: " ",
      }).queryKey
    ).toEqual(base);
    expect(
      projectMetricsQueryOptions({
        organizationId: "org",
        projectId: " project ",
      }).queryKey
    ).not.toEqual(base);
    expect(
      projectMetricsQueryOptions({
        organizationId: "org",
        actorScope: ActivityActorScopeMode.Personal,
        actorUserId: "user",
      }).queryKey
    ).not.toEqual(base);
    expect(
      buildProjectMetricsRequest({ organizationId: "org", projectId: " " })
    ).toEqual({
      organizationId: "org",
      actorScope: ActivityActorScopeMode.Organization,
    });
  });
  it("passes normalized scope to the server and shares the result", async () => {
    read.mockResolvedValue({ data: { data: { id: "metrics" } } });
    const client = new QueryClient();
    const options = projectMetricsQueryOptions({
      organizationId: "org",
      projectId: " project ",
      actorScope: ActivityActorScopeMode.Personal,
      actorUserId: " user ",
    });
    const [first, second] = await Promise.all([
      client.fetchQuery(options),
      client.fetchQuery(options),
    ]);
    expect(first).toBe(second);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(
      {
        organizationId: "org",
        projectId: "project",
        actorScope: ActivityActorScopeMode.Personal,
        actorUserId: "user",
      },
      {}
    );
    client.clear();
  });
});
