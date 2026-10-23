import { describe, expect, it } from "vitest";
import {
  attachmentDropRejection,
  attachmentReferences,
  isFileDrop,
} from "./runAttachmentDrop";

describe("Run attachment admission", () => {
  const target = { runId: "run", machineId: "owner" };
  it("only captures Files drags and leaves entity drags alone", () => {
    expect(isFileDrop({ types: ["Files", "text/plain"] })).toBe(true);
    expect(
      isFileDrop({ types: ["application/heyhey-entity", "text/plain"] })
    ).toBe(false);
  });
  it("requires verified matching loopback identity and available composer", () => {
    expect(
      attachmentDropRejection(
        target,
        { status: "local", machineId: "owner" },
        true
      )
    ).toBeNull();
    expect(
      attachmentDropRejection(
        target,
        { status: "local", machineId: "foreign" },
        true
      )
    ).toBeTruthy();
    expect(
      attachmentDropRejection(target, { status: "checking" }, true)
    ).toBeTruthy();
    expect(
      attachmentDropRejection(
        target,
        { status: "unavailable", reason: "cli-unreachable" },
        true
      )
    ).toBeTruthy();
    expect(
      attachmentDropRejection(
        null,
        { status: "local", machineId: "owner" },
        true
      )
    ).toBeTruthy();
    expect(
      attachmentDropRejection(
        target,
        { status: "local", machineId: "owner" },
        false
      )
    ).toBeTruthy();
  });
  it("sends only successful references", () => {
    const reference = { attachmentId: "attachment", fileName: "good.txt" };
    expect(
      attachmentReferences([
        { key: "a", status: "ready", fileName: "good.txt", reference },
        { key: "b", status: "uploading", fileName: "pending.txt" },
        {
          key: "c",
          status: "error",
          fileName: "failed.txt",
          code: null,
          message: "Failed",
        },
      ])
    ).toEqual([reference]);
    expect(attachmentReferences([])).toEqual([]);
  });
});
