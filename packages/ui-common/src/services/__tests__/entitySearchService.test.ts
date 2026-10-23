import { beforeEach, describe, expect, it, vi } from "vitest";

import { EntitySearchService } from "../entitySearchService";

const { searchEntities } = vi.hoisted(() => ({ searchEntities: vi.fn() }));

vi.mock("../../clients", () => ({
  getApiRuntime: () => ({ clients: { search: { searchEntities } } }),
}));

describe("EntitySearchService", () => {
  beforeEach(() => {
    searchEntities.mockReset();
  });

  it("uses the configured generated search client and typed entity filters", async () => {
    searchEntities.mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            entityId: "task-1",
            entityType: "TASK",
            entityName: "Search result",
          },
        ],
      },
    });

    const result = await new EntitySearchService("org-1").searchEntities(
      "search",
      "task,design_doc,unsupported",
    );

    expect(searchEntities).toHaveBeenCalledWith({
      organizationId: "org-1",
      query: "search",
      limit: 10,
      entityTypes: ["TASK", "DESIGN_DOC"],
    });
    expect(result).toEqual([
      {
        id: "task-1",
        type: "task",
        name: "Search result",
        description: undefined,
      },
    ]);
  });
});
