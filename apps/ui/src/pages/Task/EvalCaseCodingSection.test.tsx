import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDiffViewerLayoutShims } from "../../../../../packages/ui-common/src/components/AgentSession/CollatedFileDiffModal/__tests__/diffViewerLayoutShims";

import {
  EvalCaseCodingSection,
  isFreeFormEvalCase,
  splitDiffFiles,
  summarizeDiff,
} from "./EvalCaseCodingSection";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: { service: () => "/service" },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useService: () => ({ data: { name: "hey-hey" } }),
}));

const content = JSON.stringify({
  serviceId: "44444444-4444-4444-8444-444444444444",
  pinnedCommit: { sha: "a".repeat(40), shortMessage: "Add settings page" },
  knownGoodDiff: [
    "diff --git a/src/good.ts b/src/good.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/good.ts",
    "@@ -0,0 +1,2 @@",
    "+export const good = true;",
    "+console.log(good);",
    "",
    "diff --git a/src/changed.js b/src/changed.js",
    "--- a/src/changed.js",
    "+++ b/src/changed.js",
    "@@ -1,1 +1,1 @@",
    "-const value = 1;",
    "+const value = 2;",
    "@@ -20,1 +20,1 @@",
    "-const later = 1;",
    "+const later = 2;",
    "",
  ].join("\n"),
  knownBadDiff: [
    "diff --git a/src/bad.ts b/src/bad.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/bad.ts",
    "@@ -0,0 +1,1 @@",
    "+export const bad = true;",
  ].join("\n"),
});

describe("EvalCaseCodingSection", () => {
  let diffViewerLayout: ReturnType<typeof installDiffViewerLayoutShims> | null =
    null;

  afterEach(() => {
    diffViewerLayout?.restore();
    diffViewerLayout = null;
    cleanup();
  });

  it("reads a section saved with test commands and shows no test commands", () => {
    render(
      <EvalCaseCodingSection
        content={JSON.stringify({
          ...JSON.parse(content),
          testCommands: ["pnpm test settings"],
        })}
        organizationId="org"
        projectId="project"
      />,
    );

    expect(screen.getByText("Add settings page")).toBeTruthy();
    expect(screen.queryByText("pnpm test settings")).toBeNull();
  });

  it("shows the service, commit and hidden-from-agent note, and reveals diffs on demand", () => {
    diffViewerLayout = installDiffViewerLayoutShims();
    render(
      <EvalCaseCodingSection
        content={content}
        organizationId="org"
        projectId="project"
      />,
    );

    expect(screen.getByText("hey-hey")).toBeTruthy();
    expect(screen.getByText("Add settings page")).toBeTruthy();
    for (const id of [
      "coding-service",
      "coding-commit",
      "coding-known-good",
      "coding-known-bad",
      "coding-hidden-note",
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.queryByTestId("coding-test-commands")).toBeNull();
    expect(screen.queryByText("export const good = true;")).toBeNull();

    fireEvent.click(
      screen.getAllByRole("button", { name: "eval.case.coding.viewDiff" })[0]!,
    );
    expect(
      screen.getByTestId("coding-known-good-diff-src/good.ts"),
    ).toBeTruthy();
    const goodViewer = screen.getByTestId("coding-known-good-diff-src/good.ts");
    expect(
      within(goodViewer).getByTestId("full-file-split-view"),
    ).toHaveAttribute("data-language-id", "typescript");
    expect(
      within(goodViewer).getByTestId("full-file-split-pane-new"),
    ).toHaveTextContent("export const good = true;");
    expect(
      within(goodViewer).getByTestId("full-file-split-pane-new"),
    ).toHaveTextContent(/\+export const good = true;/);

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "eval.case.coding.viewDiff",
      })[0]!,
    );
    expect(
      screen.getByTestId("coding-known-good-diff-src/changed.js"),
    ).toBeTruthy();
    const changedViewer = screen.getByTestId(
      "coding-known-good-diff-src/changed.js",
    );
    expect(
      within(changedViewer).getByTestId("full-file-split-view"),
    ).toHaveAttribute("data-language-id", "javascript");
    expect(
      within(changedViewer).getAllByTestId("diff-omitted-lines")[0],
    ).toHaveTextContent("18 unchanged lines omitted");
    const secondHunkLine = within(changedViewer)
      .getByTestId("full-file-split-pane-old")
      .querySelector('[data-index="2"] code > span:first-child');
    expect(secondHunkLine).toHaveTextContent("20");
  });

  it("shows an error instead of crashing when the stored section is not a Coding section", () => {
    render(
      <EvalCaseCodingSection
        content={JSON.stringify({ serviceId: 42 })}
        organizationId="org"
        projectId="project"
      />,
    );

    expect(screen.getByText("eval.case.coding.invalid")).toBeTruthy();
    expect(screen.queryByTestId("coding-hidden-note")).toBeNull();
  });

  it("applies only to a case whose handler is free_form", () => {
    const withHandler = (handler: string) => [
      { key: "handler", materializedMarkdown: handler },
    ];

    expect(isFreeFormEvalCase(withHandler("free_form"))).toBe(true);
    expect(isFreeFormEvalCase(withHandler("entity_conversation"))).toBe(false);
    expect(isFreeFormEvalCase([])).toBe(false);
  });
});

describe("summarizeDiff", () => {
  it("counts content lines that look like headers, and files without git headers", () => {
    const withGitHeaders = [
      "diff --git a/q.sql b/q.sql",
      "--- a/q.sql",
      "+++ b/q.sql",
      "@@ -1,2 +1,2 @@",
      " select 1;",
      "--- drop comment",
      "+++ added comment",
      "diff --git a/n.txt b/n.txt",
      "--- /dev/null",
      "+++ b/n.txt",
      "@@ -0,0 +1 @@",
      "+hello",
    ].join("\n");
    const withoutGitHeaders = withGitHeaders
      .split("\n")
      .filter((line) => !line.startsWith("diff --git"))
      .join("\n");

    expect(summarizeDiff(withGitHeaders)).toEqual({
      files: 2,
      added: 2,
      removed: 1,
    });
    expect(summarizeDiff(withoutGitHeaders)).toEqual({
      files: 2,
      added: 2,
      removed: 1,
    });
  });

  it("splits standard unified diffs into one viewable file per header pair", () => {
    const diff = [
      "--- a/src/first.ts",
      "+++ b/src/first.ts",
      "@@ -1 +1 @@",
      "-const first = 1;",
      "+const first = 2;",
      "--- a/src/second.js",
      "+++ b/src/second.js",
      "@@ -1 +1 @@",
      "-const second = 1;",
      "+const second = 2;",
    ].join("\n");

    expect(splitDiffFiles(diff).map(({ filePath }) => filePath)).toEqual([
      "src/first.ts",
      "src/second.js",
    ]);
  });
});
