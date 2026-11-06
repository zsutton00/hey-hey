import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  EvalCaseCodingSection,
  isFreeFormEvalCase,
  summarizeDiff,
} from "./EvalCaseCodingSection";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  testCommands: ["pnpm test settings"],
  knownGoodDiff: "diff --git good",
  knownBadDiff: "diff --git bad",
});

describe("EvalCaseCodingSection", () => {
  it("shows the service, commit, test commands and hidden-from-agent note, and reveals diffs on demand", () => {
    render(
      <EvalCaseCodingSection
        content={content}
        organizationId="org"
        projectId="project"
      />,
    );

    expect(screen.getByText("hey-hey")).toBeTruthy();
    expect(screen.getByText("Add settings page")).toBeTruthy();
    expect(screen.getByText("pnpm test settings")).toBeTruthy();
    for (const id of [
      "coding-service",
      "coding-commit",
      "coding-test-commands",
      "coding-tests-note",
      "coding-known-good",
      "coding-known-bad",
      "coding-hidden-note",
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.queryByText("diff --git good")).toBeNull();

    fireEvent.click(
      screen.getAllByRole("button", { name: "eval.case.coding.viewDiff" })[0]!,
    );
    expect(screen.getByText("diff --git good")).toBeTruthy();
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
});
