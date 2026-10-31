import { describe, expect, it } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../../api/api";
import { buildDefaultStatusTabs } from "../entityCollectionStatusTabs";

const recipe = {
  key: "RECIPE",
  name: "Recipe",
  statuses: [
    { name: "Idea", meaning: "NOT_STARTED" },
    { name: "Cooking", meaning: "IN_PROGRESS" },
    { name: "Made", meaning: "FINISHED" },
  ],
} as WorkItemTypeDefinitionDto;

describe("buildDefaultStatusTabs", () => {
  it("keeps a custom type's configured order and ends with an unfiltered tab", () => {
    const tabs = buildDefaultStatusTabs(recipe);

    expect(tabs.map(({ label }) => label)).toEqual([
      "Idea",
      "Cooking",
      "Made",
      "Archived",
      "All",
    ]);
    expect(tabs.at(-1)?.statuses).toEqual([]);
  });
});
