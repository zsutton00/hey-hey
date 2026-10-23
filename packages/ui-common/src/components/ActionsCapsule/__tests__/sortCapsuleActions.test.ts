import { describe, expect, it } from "vitest";
import { sortCapsuleActions } from "../sortCapsuleActions";
import type { CapsuleActionRegistration, CapsuleActionTier } from "../types";

const createAction = (
  id: string,
  tier: CapsuleActionTier,
  order: number,
  actionGroup: "page" | "conceptual" = tier === "page" ? "page" : "conceptual"
): CapsuleActionRegistration => ({
  id,
  label: id,
  behavior: "click",
  actionGroup,
  tier,
  order,
  onClick: () => {},
});

describe("sortCapsuleActions", () => {
  it("sorts by tier before in-tier order", () => {
    const actions = [
      createAction("tab-first", "tab", 0),
      createAction("page-first", "page", 0),
      createAction("site-first", "site", 999),
    ];

    const sorted = sortCapsuleActions(actions);

    expect(sorted.map((action) => action.id)).toEqual([
      "tab-first",
      "page-first",
      "site-first",
    ]);
  });

  it("sorts by order within the same tier", () => {
    const actions = [
      createAction("page-third", "page", 30),
      createAction("page-first", "page", 10),
      createAction("page-second", "page", 20),
    ];

    const sorted = sortCapsuleActions(actions);

    expect(sorted.map((action) => action.id)).toEqual([
      "page-first",
      "page-second",
      "page-third",
    ]);
  });

  it("places Discuss first among ordinary actions regardless of tier or order", () => {
    const actions = [
      createAction("page-first", "page", 0),
      createAction("tab-first", "tab", 0),
      createAction("discuss", "page", 90),
      createAction("site-search", "site", 20),
    ];

    const sorted = sortCapsuleActions(actions);

    expect(sorted.map((action) => action.id)).toEqual([
      "discuss",
      "tab-first",
      "page-first",
      "site-search",
    ]);
  });

  it("places page actions before conceptual actions within the same tier", () => {
    const actions = [
      createAction("site-conceptual-first", "site", 0, "conceptual"),
      createAction("site-page-last-order", "site", 999, "page"),
    ];

    const sorted = sortCapsuleActions(actions);

    expect(sorted.map((action) => action.id)).toEqual([
      "site-page-last-order",
      "site-conceptual-first",
    ]);
  });

  it("preserves registration order when tier and order tie", () => {
    const actions = [
      createAction("same-a", "site", 0),
      createAction("same-b", "site", 0),
      createAction("same-c", "site", 0),
    ];

    const sorted = sortCapsuleActions(actions);

    expect(sorted.map((action) => action.id)).toEqual([
      "same-a",
      "same-b",
      "same-c",
    ]);
  });
});
