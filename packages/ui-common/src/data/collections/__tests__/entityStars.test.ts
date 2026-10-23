import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EntityType,
  type EntityStarDto,
  type ListStars200Response,
} from "../../../api";

const { listStars } = vi.hoisted(() => ({
  listStars: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  starsClient: {
    listStars,
  },
}));

import {
  entityStarKeys,
  entityStarsQueryOptions,
  fetchEntityStars,
  filterEntityStars,
} from "../entityStars";
import { dataLayerQueryPolicy } from "../../query/queryPolicy";

const listResponse = (
  ...args: [] | [ListStars200Response["data"] | undefined]
) => {
  const data = args.length === 0 ? [] : args[0];

  return {
    data: {
      success: true,
      message: "ok",
      timestamp: "now",
      statusCode: 200,
      data,
    },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  };
};

const star = (id: string, entityType: EntityType): EntityStarDto => ({
  id,
  organizationId: "org-1",
  userId: "user-1",
  entityType,
  entityId: `${id}-entity`,
  entityName: id,
  createdAt: "2026-01-01T00:00:00.000Z",
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("entity stars collection", () => {
  it("has one list key per organization", () => {
    expect(entityStarKeys.root()).toEqual(["entityStars"]);
    expect(entityStarKeys.all("org-1")).toEqual(["entityStars", "org-1"]);
    expect(entityStarKeys.list("org-1")).toEqual([
      "entityStars",
      "org-1",
      "list",
    ]);
    expect(entityStarsQueryOptions("org-1").queryKey).toEqual(
      entityStarKeys.list("org-1")
    );
    expect(entityStarsQueryOptions("org-1").staleTime).toBe(
      dataLayerQueryPolicy.staleTime
    );
  });

  it("requests only by organization, never by entity type", async () => {
    listStars.mockResolvedValue(listResponse());

    await fetchEntityStars("org-1", {});
    await new QueryClient().fetchQuery(entityStarsQueryOptions("org-2"));

    expect(listStars).toHaveBeenNthCalledWith(1, { organizationId: "org-1" }, {});
    expect(listStars).toHaveBeenNthCalledWith(
      2,
      { organizationId: "org-2" },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("fails when the generated response omits the list instead of masking it as empty", async () => {
    listStars.mockResolvedValue(listResponse(undefined));

    await expect(fetchEntityStars("org-1", {})).rejects.toThrow(
      "Stars response did not include a list"
    );
  });

  it("filters by entity type client-side", () => {
    const project = star("p", EntityType.Project);
    const task = star("t", EntityType.Task);

    expect(filterEntityStars([project, task], undefined)).toEqual([
      project,
      task,
    ]);
    expect(filterEntityStars([project, task], EntityType.Project)).toEqual([
      project,
    ]);
  });
});
