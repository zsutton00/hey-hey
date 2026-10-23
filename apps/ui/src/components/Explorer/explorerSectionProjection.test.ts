import { describe, expect, it } from "vitest";
import type { ExplorerSection } from "./types";
import {
  filterExplorerSections,
  flattenExplorerSections,
} from "./explorerSectionProjection";

const makeNode = (id: string, name: string, sectionKey: string) => ({
  id,
  name,
  sectionKey,
  type: "work-item" as const,
  hasChildren: false,
  depth: 0,
});

const sections: ExplorerSection[] = [
  {
    key: "work-item:FEATURE",
    label: "Features",
    nodes: [makeNode("feature-1", "Explorer Sidebar", "work-item:FEATURE")],
    count: 1,
  },
  {
    key: "work-item:PLAN",
    label: "Plans",
    nodes: [makeNode("plan-1", "Search plan", "work-item:PLAN")],
    count: 1,
  },
  {
    key: "services",
    label: "Services",
    nodes: [makeNode("service-1", "Search API", "services")],
    count: 1,
  },
];

describe("filterExplorerSections", () => {
  it("matches trimmed, case-insensitive labels within their owning sections", () => {
    const filtered = filterExplorerSections(sections, "  SEARCH ");

    expect(filtered.map((section) => section.key)).toEqual([
      "work-item:FEATURE",
      "work-item:PLAN",
      "services",
    ]);
    expect(filtered.map((section) => section.nodes.map((node) => node.id))).toEqual([
      [],
      ["plan-1"],
      ["service-1"],
    ]);
    expect(filtered.map((section) => section.count)).toEqual([0, 1, 1]);
  });

  it("keeps empty filtered sections and restores the original projection for blank queries", () => {
    const filtered = filterExplorerSections(sections, "missing");

    expect(filtered).toHaveLength(sections.length);
    expect(filtered.every((section) => section.nodes.length === 0)).toBe(true);
    expect(filterExplorerSections(sections, "  ")).toBe(sections);
  });
});

describe("flattenExplorerSections", () => {
  it("preserves section order and row ownership", () => {
    expect(
      flattenExplorerSections(filterExplorerSections(sections, "search")).map(
        (node) => [node.id, node.sectionKey],
      ),
    ).toEqual([
      ["plan-1", "work-item:PLAN"],
      ["service-1", "services"],
    ]);
  });
});
