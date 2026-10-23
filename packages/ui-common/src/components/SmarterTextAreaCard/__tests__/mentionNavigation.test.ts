import { describe, it, expect } from "vitest";
import { computeNextMentionIndex } from "../mentionNavigation";

describe("computeNextMentionIndex", () => {
  it("returns -1 when the list is empty", () => {
    expect(computeNextMentionIndex("down", -1, 0)).toBe(-1);
    expect(computeNextMentionIndex("up", 0, 0)).toBe(-1);
  });

  it("starts at 0 on the first ArrowDown when nothing is selected", () => {
    expect(computeNextMentionIndex("down", -1, 5)).toBe(0);
  });

  it("moves forward and wraps from last to first on ArrowDown", () => {
    expect(computeNextMentionIndex("down", 0, 5)).toBe(1);
    expect(computeNextMentionIndex("down", 4, 5)).toBe(0);
  });

  it("jumps to the last entry on ArrowUp from nothing or from the first item", () => {
    expect(computeNextMentionIndex("up", -1, 5)).toBe(4);
    expect(computeNextMentionIndex("up", 0, 5)).toBe(4);
  });

  it("wraps across the combined list so up from index 0 lands on the last common-match", () => {
    const standardCount = 3;
    const commonCount = 2;
    const combinedLength = standardCount + commonCount;
    expect(computeNextMentionIndex("up", 0, combinedLength)).toBe(
      combinedLength - 1
    );
  });
});
