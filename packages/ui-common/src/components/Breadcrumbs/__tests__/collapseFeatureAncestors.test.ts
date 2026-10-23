import { describe, expect, it } from "vitest";
import type { BreadcrumbItem } from "../../../utils/breadcrumbs";
import { collapseFeatureAncestors } from "../collapseFeatureAncestors";

const feature = (label: string): BreadcrumbItem => ({ label, kind: "feature" });
describe("collapseFeatureAncestors", () => {
  it("leaves short runs and non-feature items visible", () => {
    const items = [
      feature("A"),
      feature("B"),
      { label: "Plan" },
      feature("C"),
      feature("D"),
      { label: "Current" },
    ];
    expect(collapseFeatureAncestors(items).map((entry) => entry.kind)).toEqual(
      items.map(() => "item")
    );
  });
  it("keeps the leaf feature outside its ancestor run", () => {
    const items = [
      feature("A"),
      feature("B"),
      feature("C"),
      feature("Current"),
    ];
    expect(collapseFeatureAncestors(items)).toEqual([
      { kind: "item", item: items[0], index: 0 },
      { kind: "collapsed", items: [items[1]], index: 1 },
      { kind: "item", item: items[2], index: 2 },
      { kind: "item", item: items[3], index: 3 },
    ]);
  });
  it("never hides an explicitly current feature or an unclassified feature", () => {
    const items = [
      feature("A"),
      { ...feature("Current"), isCurrent: true },
      feature("B"),
      { label: "Other", type: "feature" },
      { label: "Session" },
    ];
    expect(collapseFeatureAncestors(items).map((entry) => entry.kind)).toEqual(
      items.map(() => "item")
    );
  });
});
