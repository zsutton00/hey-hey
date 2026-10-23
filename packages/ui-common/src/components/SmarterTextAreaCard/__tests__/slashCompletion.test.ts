import { describe, it, expect } from "vitest";
import { computeSlashCompletion } from "../slashCommands/slashCompletion";

describe("computeSlashCompletion", () => {
  it("returns the highlighted name as a completed pick when highlightedName is set", () => {
    expect(
      computeSlashCompletion({
        query: "se",
        candidates: [{ name: "search" }, { name: "service" }],
        highlightedName: "service",
      })
    ).toEqual({ text: "service", completed: true });
  });

  it("returns the single candidate as a completed pick when there is exactly one match", () => {
    expect(
      computeSlashCompletion({
        query: "fea",
        candidates: [{ name: "feature" }],
        highlightedName: undefined,
      })
    ).toEqual({ text: "feature", completed: true });
  });

  it("returns an exact completion candidate before falling back to longest common prefix", () => {
    expect(
      computeSlashCompletion({
        query: "feature",
        candidates: [
          { name: "feature", completesOnExactMatch: true },
          { name: "feature-tree" },
        ],
        highlightedName: undefined,
      })
    ).toEqual({ text: "feature", completed: true });
  });

  it("ignores exact candidates that do not complete on exact match", () => {
    expect(
      computeSlashCompletion({
        query: "feature",
        candidates: [{ name: "feature" }, { name: "feature-tree" }],
        highlightedName: undefined,
      })
    ).toEqual({ text: "feature", completed: false });
  });

  it("returns the longest common prefix without committing when the LCP extends the query", () => {
    expect(
      computeSlashCompletion({
        query: "s",
        candidates: [{ name: "search" }, { name: "service" }],
        highlightedName: undefined,
      })
    ).toEqual({ text: "se", completed: false });
  });

  it("returns the query unchanged when multiple candidates share no prefix beyond the query", () => {
    expect(
      computeSlashCompletion({
        query: "se",
        candidates: [{ name: "search" }, { name: "service" }],
        highlightedName: undefined,
      })
    ).toEqual({ text: "se", completed: false });
  });

  it("returns the query unchanged when there are no candidates", () => {
    expect(
      computeSlashCompletion({
        query: "xyz",
        candidates: [],
        highlightedName: undefined,
      })
    ).toEqual({ text: "xyz", completed: false });
  });
});
