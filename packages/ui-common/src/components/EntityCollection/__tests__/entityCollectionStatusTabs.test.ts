import { describe, expect, it } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../../api/api";
import {
  ALL_STATUSES_TAB_ID,
  buildDefaultStatusTabs,
} from "../entityCollectionStatusTabs";

const recipe = {
  key: "RECIPE",
  name: "Recipe",
  statuses: [
    { name: "Idea", meaning: { kind: "CUSTOM" as const, text: "Not started" } },
    { name: "Cooking", meaning: { kind: "IN_PROGRESS" as const } },
    { name: "Made", meaning: { kind: "COMPLETED" as const } },
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

  it("keeps the All tab distinct from a status named like its id and sends the saved name", () => {
    const tabs = buildDefaultStatusTabs({
      ...recipe,
      statuses: [
        {
          name: "__all__",
          meaning: { kind: "CUSTOM" as const, text: "Not started" },
        },
        { name: "all", meaning: { kind: "IN_PROGRESS" as const } },
        {
          name: "Ready, pending sign-off",
          meaning: { kind: "COMPLETED" as const },
        },
      ],
    } as WorkItemTypeDefinitionDto);

    expect(new Set(tabs.map(({ id }) => id)).size).toBe(tabs.length);
    expect(tabs.filter(({ id }) => id === ALL_STATUSES_TAB_ID)).toEqual([
      expect.objectContaining({ statuses: [] }),
    ]);
    expect(tabs.flatMap(({ statuses }) => statuses)).toEqual(
      expect.arrayContaining(["__all__", "all", "Ready, pending sign-off"]),
    );
  });
});
