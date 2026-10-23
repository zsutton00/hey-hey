import { describe, expect, it } from "vitest";
import { prepareInitialPromptSubmission } from "../prepareInitialPromptSubmission";
import type { RunAttachmentEntry } from "../../hooks/runAttachmentDrop";
const reference = { attachmentId: "file", fileName: "notes.md" };
const ready: RunAttachmentEntry = {
  key: "ready",
  status: "ready",
  fileName: "notes.md",
  reference,
};
const input = {
  prompt: "  Keep this text unchanged.\n",
  machineId: "owner",
  handlerDriven: true,
};
describe("initial prompt submission", () => {
  it("snapshots unchanged text and only remaining ready references", () => {
    expect(
      prepareInitialPromptSubmission({ ...input, entries: [ready] }),
    ).toEqual({
      ok: true,
      prompt: input.prompt,
      machineId: "owner",
      attachments: [reference],
    });
    expect(
      prepareInitialPromptSubmission({ ...input, entries: [] }),
    ).toMatchObject({ ok: true, attachments: [] });
  });
  it.each<RunAttachmentEntry>([
    { key: "upload", status: "uploading", fileName: "pending.txt" },
    {
      key: "error",
      status: "error",
      fileName: "failed.txt",
      code: "FILE_TOO_LARGE",
      message: "Too large",
    },
  ])("blocks submission with $status files", (entry) => {
    expect(
      prepareInitialPromptSubmission({ ...input, entries: [ready, entry] }).ok,
    ).toBe(false);
  });
  it("rejects workflow attachments and missing machine before any side effects", () => {
    expect(
      prepareInitialPromptSubmission({
        ...input,
        entries: [ready],
        handlerDriven: false,
      }).ok,
    ).toBe(false);
    expect(
      prepareInitialPromptSubmission({
        ...input,
        entries: [],
        handlerDriven: false,
      }).ok,
    ).toBe(true);
    expect(
      prepareInitialPromptSubmission({ ...input, entries: [], machineId: null })
        .ok,
    ).toBe(false);
  });
});
