import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EvalRecordedChanges } from "@hey-hey/contracts/api/models";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useService: () => ({ data: { name: "Fixture App" } }),
}));

import { OpenAttemptOutput } from "./OpenAttemptOutput";
import { joinSavedPatch } from "./joinSavedPatch";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const startPoint = { serviceId: "svc-1", sha: SHA, shortMessage: "base" };

const textPatch = (path: string) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+x\n`;

const changes = (
  files: Array<{ path: string; patch: string }>,
): EvalRecordedChanges => ({
  files: files.map((file) => ({
    ...file,
    status: "added" as const,
    additions: 1,
    deletions: 0,
  })),
});

const renderPanel = (
  overrides: Partial<React.ComponentProps<typeof OpenAttemptOutput>> = {},
) => {
  render(
    <OpenAttemptOutput
      organizationId="org"
      attemptName="attempt-ab12cd34"
      startPoint={startPoint}
      target={null}
      changes={changes([{ path: "src/a.ts", patch: textPatch("src/a.ts") }])}
      {...overrides}
    />,
  );
  fireEvent.click(screen.getByTestId("open-output-button"));
};

describe("OpenAttemptOutput", () => {
  it("shows the commit and commands that each depend on the one before, ending in the target directory", () => {
    renderPanel({
      target: { kind: "NEW", path: "src" },
      changes: changes([{ path: "src/a.ts", patch: textPatch("src/a.ts") }]),
    });

    expect(screen.getByTestId("open-output-source")).toHaveTextContent(SHA);
    expect(screen.getByTestId("open-output-commands").textContent).toBe(
      [
        `git worktree add ../attempt-ab12cd34 ${SHA} &&`,
        "cd ../attempt-ab12cd34 &&",
        "git apply ~/Downloads/attempt-ab12cd34.patch &&",
        "cd src",
      ].join("\n"),
    );
    expect(screen.getByTestId("download-patch")).toBeEnabled();
  });

  it("names the saved file when the target matches it exactly, even for a name without an extension", () => {
    renderPanel({
      target: { kind: "NEW", path: "Dockerfile" },
      changes: changes([
        { path: "Dockerfile", patch: textPatch("Dockerfile") },
      ]),
    });

    const source = screen.getByTestId("open-output-source");
    expect(source).toHaveTextContent("opening.file");
    expect(source).toHaveTextContent("Dockerfile");
    expect(screen.getByTestId("open-output-commands").textContent).not.toMatch(
      /cd Dockerfile/u,
    );
  });

  it("treats a dotted target as a directory when saved files sit inside it", () => {
    renderPanel({
      target: { kind: "NEW", path: "app.v2" },
      changes: changes([
        { path: "app.v2/x.ts", patch: textPatch("app.v2/x.ts") },
      ]),
    });

    expect(screen.getByTestId("open-output-commands").textContent).toMatch(
      /cd app\.v2$/u,
    );
  });

  it("names the only output file when the case has no target", () => {
    renderPanel({ target: null });

    expect(screen.getByTestId("open-output-source")).toHaveTextContent(
      "src/a.ts",
    );
    expect(screen.getByTestId("open-output-commands").textContent).not.toMatch(
      /\bcd src/u,
    );
  });

  it("shows an ambiguous target without guessing a cd command", () => {
    renderPanel({ target: { kind: "NEW", path: "elsewhere" } });

    expect(screen.getByTestId("open-output-source")).toHaveTextContent(
      "elsewhere",
    );
    expect(screen.getByTestId("open-output-commands").textContent).not.toMatch(
      /cd elsewhere/u,
    );
  });

  it("says nothing can be opened when no changes were saved", () => {
    render(
      <OpenAttemptOutput
        organizationId="org"
        attemptName="a"
        startPoint={startPoint}
        target={null}
        changes={null}
      />,
    );

    expect(screen.getByTestId("open-output-none")).toBeInTheDocument();
    expect(screen.queryByTestId("open-output-button")).toBeNull();
  });

  it("leaves a binary change out of the patch and names it", () => {
    const binary = {
      path: "logo.png",
      patch:
        "diff --git a/logo.png b/logo.png\nnew file mode 100644\nindex 0000000..1111111\nBinary files /dev/null and b/logo.png differ\n",
    };
    const text = { path: "src/a.ts", patch: textPatch("src/a.ts") };

    expect(joinSavedPatch([binary, text])).toEqual({
      patch: text.patch,
      binaryPaths: ["logo.png"],
    });

    renderPanel({ changes: changes([binary, text]) });
    expect(screen.getByTestId("open-output-binary")).toHaveTextContent(
      "logo.png",
    );
  });

  it("offers no apply instructions when the only change is binary", () => {
    renderPanel({
      changes: changes([
        {
          path: "logo.png",
          patch:
            "diff --git a/logo.png b/logo.png\nnew file mode 100644\nBinary files /dev/null and b/logo.png differ\n",
        },
      ]),
    });

    expect(screen.getByTestId("open-output-binary")).toHaveTextContent(
      "logo.png",
    );
    expect(screen.getByTestId("download-patch")).toBeDisabled();
    expect(screen.getByTestId("open-output-no-patch")).toBeInTheDocument();
    expect(screen.queryByTestId("open-output-commands")).toBeNull();
    expect(screen.queryByTestId("open-output-copy")).toBeNull();
  });

  it("ends each joined patch with a newline, including older trimmed ones", () => {
    const joined = joinSavedPatch([
      { path: "a", patch: textPatch("a").trimEnd() },
      { path: "empty", patch: "" },
      { path: "b", patch: textPatch("b") },
    ]);

    expect(joined.patch).toBe(textPatch("a") + textPatch("b"));
  });
});
