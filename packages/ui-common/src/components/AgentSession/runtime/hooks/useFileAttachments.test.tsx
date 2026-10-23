import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileAttachments } from "./useFileAttachments";
import type { FileAttachmentDestination } from "./runAttachmentDrop";
import type { LocalCliForSessionState } from "./useLocalCliForSession";
import { LocalRunAttachmentUploadError } from "../directoryBindingApi";
const mocks = vi.hoisted(() => ({
  stage: vi.fn(),
  upload: vi.fn(),
  local: { status: "local", machineId: "owner" } as LocalCliForSessionState,
}));
vi.mock("./useLocalCliForSession", () => ({
  useLocalCliForSession: () => mocks.local,
}));
vi.mock("../directoryBindingApi", async (original) => ({
  ...(await original<typeof import("../directoryBindingApi")>()),
  createDirectoryBindingApi: () => ({
    uploadLocalStagedRunAttachment: mocks.stage,
    uploadLocalRunAttachment: mocks.upload,
  }),
}));
const target: FileAttachmentDestination = {
  kind: "pre-run",
  machineId: "owner",
};
const resultFor = (name: string) => ({
  result: { attachment: { attachmentId: name, fileName: name, sizeBytes: 1 } },
});
beforeEach(() => {
  mocks.stage.mockReset();
  mocks.upload.mockReset();
  mocks.local = { status: "local", machineId: "owner" };
});
describe("transient file staging", () => {
  it("keeps pending files named, uploads independently, preserves typed failures, and permits removal", async () => {
    let finish: (value: ReturnType<typeof resultFor>) => void = () => undefined;
    mocks.stage.mockImplementation((_machine, file: File) =>
      file.name === "good.txt"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.reject(
            new LocalRunAttachmentUploadError("Too large", "FILE_TOO_LARGE"),
          ),
    );
    const { result } = renderHook(() =>
      useFileAttachments(target, "session", true),
    );
    act(() =>
      result.current.drop([
        new File(["a"], "good.txt"),
        new File(["b"], "bad.txt"),
      ]),
    );
    expect(result.current.entries[0]).toMatchObject({
      fileName: "good.txt",
      status: "uploading",
    });
    expect(result.current.blocked).toBe(true);
    await waitFor(() =>
      expect(result.current.entries[1]).toMatchObject({
        status: "error",
        code: "FILE_TOO_LARGE",
      }),
    );
    await act(async () => finish(resultFor("good.txt")));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.stage).toHaveBeenCalledTimes(2);
    expect(result.current.references).toEqual([
      { attachmentId: "good.txt", fileName: "good.txt" },
    ]);
    act(() => result.current.remove(result.current.entries[1].key));
    expect(result.current.blocked).toBe(false);
    act(() => result.current.clearSubmitted(result.current.references));
    expect(result.current.entries).toEqual([]);
  });
  it("ignores results after removal and after changing destination", async () => {
    const finishes: ((value: ReturnType<typeof resultFor>) => void)[] = [];
    mocks.stage.mockImplementation(
      () => new Promise((resolve) => finishes.push(resolve)),
    );
    const { result, rerender } = renderHook(
      ({ destination }) => useFileAttachments(destination, "session", true),
      { initialProps: { destination: target } },
    );
    act(() => result.current.drop([new File([], "removed.txt")]));
    act(() => result.current.remove(result.current.entries[0].key));
    await act(async () => finishes[0](resultFor("removed.txt")));
    expect(result.current.entries).toEqual([]);
    act(() => result.current.drop([new File([], "old.txt")]));
    rerender({ destination: { kind: "pre-run", machineId: "other" } });
    await act(async () => finishes[1](resultFor("old.txt")));
    expect(result.current.entries).toEqual([]);
    rerender({ destination: target });
    expect(result.current.entries).toEqual([]);
  });
  it.each<LocalCliForSessionState>([
    { status: "checking" },
    { status: "local", machineId: "wrong" },
    { status: "unavailable", reason: "cli-unreachable" },
  ])("rejects unavailable destinations without uploading: $status", (local) => {
    mocks.local = local;
    const { result } = renderHook(() =>
      useFileAttachments(target, "session", true),
    );
    act(() => result.current.drop([new File([], "a.txt")]));
    expect(result.current.rejection).toBeTruthy();
    expect(result.current.entries).toEqual([]);
    expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("rejects workflow drops visibly", () => {
    const { result } = renderHook(() =>
      useFileAttachments(
        target,
        "session",
        "File attachments are unavailable for workflow methods.",
      ),
    );
    act(() => result.current.drop([new File([], "a.txt")]));
    expect(result.current.rejection).toContain("workflow");
    expect(mocks.stage).not.toHaveBeenCalled();
  });
});
