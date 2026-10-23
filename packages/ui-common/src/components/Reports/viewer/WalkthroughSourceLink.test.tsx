import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeWalkthroughExcerpt } from "../../../api";
import { WalkthroughSourceLink } from "./WalkthroughSourceLink";

vi.mock("../../EditorPreference/ExternalEditorPreferenceDialog", () => ({
  ExternalEditorPreferenceDialog: () => null,
}));
vi.mock("../../EditorPreference/editorPreference", () => ({
  readExternalEditorPreference: () => ({ kind: "vscode" }),
  buildExternalEditorUrl: (
    _preference: object,
    source: { path: string; line: number }
  ) => "vscode://file" + source.path + ":" + source.line,
}));
const excerpt: ChangeWalkthroughExcerpt = {
  serviceId: "11111111-1111-4111-8111-111111111111",
  file: "src/policy.ts",
  startLine: 7,
  endLine: 7,
  language: "typescript",
  code: "deny();",
  sourceVersion: { kind: "WORKSPACE" },
  verification: { status: "VERIFIED", checkedAt: "2026-10-15T00:00:00Z" },
};
const runId = "22222222-2222-4222-8222-222222222222";
afterEach(() => vi.unstubAllGlobals());

describe("walkthrough source navigation", () => {
  it("revalidates the Run and Service source on click and opens the returned worktree location", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("/repos")
          ? {
              machineId: "33333333-3333-4333-8333-333333333333",
              bindings: [
                {
                  serviceId: excerpt.serviceId,
                  repositoryPath: "/host/checkout",
                  createdAt: "2026-10-15T00:00:00Z",
                  updatedAt: "2026-10-15T00:00:00Z",
                },
              ],
            }
          : {
              runId,
              serviceId: excerpt.serviceId,
              file: excerpt.file,
              path: "/worktrees/review/src/policy.ts",
              line: 7,
              column: 1,
            },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<WalkthroughSourceLink excerpt={excerpt} runId={runId} />);
    const button = screen.getByTestId("walkthrough-source");
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "vscode://file/worktrees/review/src/policy.ts:7",
        "_self",
        "noopener,noreferrer"
      )
    );
    const sourceCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/walkthrough/source")
    );
    expect(sourceCalls).toHaveLength(2);
    expect(JSON.parse(sourceCalls[1][1].body).excerpt).toEqual(excerpt);
    open.mockRestore();
  });
  it("keeps unmapped sources visible without requesting an editor location", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        machineId: "33333333-3333-4333-8333-333333333333",
        bindings: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WalkthroughSourceLink excerpt={excerpt} runId={runId} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(
      screen.getByTestId("walkthrough-source").hasAttribute("disabled")
    ).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain("/repos");
  });

  it("keeps source opening disabled when revalidation is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    render(<WalkthroughSourceLink excerpt={excerpt} runId={runId} />);
    expect(
      screen.getByTestId("walkthrough-source").hasAttribute("disabled")
    ).toBe(true);
    await screen.findByText("Current source opening unavailable");
  });
});
