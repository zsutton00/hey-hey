import { describe, it, expect } from "vitest";
import { sortFeaturesFirst } from "../sortFeaturesFirst";
import type { SearchEntity } from "../types";

const entity = (id: string, type: string): SearchEntity => ({
  id,
  type,
  name: `${type} ${id}`,
});

describe("sortFeaturesFirst", () => {
  it("floats features to the top of a mixed list", () => {
    const input = [
      entity("t1", "task"),
      entity("f1", "feature"),
      entity("s1", "service"),
      entity("f2", "feature"),
    ];
    expect(sortFeaturesFirst(input).map((e) => e.id)).toEqual([
      "f1",
      "f2",
      "t1",
      "s1",
    ]);
  });

  it("preserves relative order within the feature group and within the rest", () => {
    const input = [
      entity("t1", "task"),
      entity("f1", "feature"),
      entity("d1", "design_doc"),
      entity("f2", "feature"),
      entity("t2", "task"),
    ];
    expect(sortFeaturesFirst(input).map((e) => e.id)).toEqual([
      "f1",
      "f2",
      "t1",
      "d1",
      "t2",
    ]);
  });

  it("returns an all-non-feature list unchanged", () => {
    const input = [
      entity("t1", "task"),
      entity("s1", "service"),
      entity("d1", "design_doc"),
    ];
    expect(sortFeaturesFirst(input).map((e) => e.id)).toEqual([
      "t1",
      "s1",
      "d1",
    ]);
  });

  it("returns an all-feature list unchanged", () => {
    const input = [
      entity("f1", "feature"),
      entity("f2", "feature"),
      entity("f3", "feature"),
    ];
    expect(sortFeaturesFirst(input).map((e) => e.id)).toEqual([
      "f1",
      "f2",
      "f3",
    ]);
  });

  it("handles assorted non-task types without disturbing their order", () => {
    const input = [
      entity("p1", "project"),
      entity("f1", "feature"),
      entity("i1", "initiative"),
      entity("c1", "conversation"),
    ];
    expect(sortFeaturesFirst(input).map((e) => e.id)).toEqual([
      "f1",
      "p1",
      "i1",
      "c1",
    ]);
  });

  it("handles empty input", () => {
    expect(sortFeaturesFirst([])).toEqual([]);
  });
});
