import {
  describeStatusMeaning,
  isFinishedMeaning,
  isInProgressMeaning,
} from "../workItemStatusMeaning";

describe("status meanings", () => {
  it("reads Completed and Cancelled as finished and In progress as underway", () => {
    expect(isFinishedMeaning({ kind: "COMPLETED" })).toBe(true);
    expect(isFinishedMeaning({ kind: "CANCELLED" })).toBe(true);
    expect(isFinishedMeaning({ kind: "IN_PROGRESS" })).toBe(false);
    expect(isFinishedMeaning({ kind: "CUSTOM", text: "Finished" })).toBe(false);
    expect(isFinishedMeaning(undefined)).toBe(false);
    expect(isInProgressMeaning({ kind: "IN_PROGRESS" })).toBe(true);
    expect(isInProgressMeaning({ kind: "CUSTOM", text: "In progress" })).toBe(
      false,
    );
  });

  it("describes a meaning in the user's own words for custom ones", () => {
    expect(describeStatusMeaning({ kind: "CUSTOM", text: "Weighing it" })).toBe(
      "Weighing it",
    );
    expect(describeStatusMeaning({ kind: "COMPLETED" })).toBe("Completed");
  });
});
