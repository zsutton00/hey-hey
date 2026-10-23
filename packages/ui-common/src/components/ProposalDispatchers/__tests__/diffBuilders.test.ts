import { describe, expect, it } from "vitest";
import {
  type TaskResponseDto,
  type UpdateTaskDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { buildTaskDiff } from "../diffBuilders";
import type { UpdateTaskProposalUpdates } from "../types";

function makeExisting(
  sections: Array<{ key: string; materializedMarkdown: string }>,
): TaskResponseDto {
  return {
    id: "task-1",
    name: "Existing",
    sections: sections.map((s, i) => ({
      id: `section-${i}`,
      key: s.key,
      order: i,
      materializedMarkdown: s.materializedMarkdown,
    })),
  } as unknown as TaskResponseDto;
}

const definition = (
  sections: Array<{ key: string; label: string }>,
): WorkItemTypeDefinitionDto =>
  ({
    key: "CUSTOM",
    name: "Custom",
    sections,
    allowedStatuses: [],
  }) as unknown as WorkItemTypeDefinitionDto;

describe("buildTaskDiff section labels", () => {
  it.each([
    ["description", "Description"],
    ["acceptanceCriteria", "Acceptance Criteria"],
    ["requirements", "Requirements"],
  ])("labels %s as %s", (key, label) => {
    const existing = makeExisting([{ key, materializedMarkdown: "old body" }]);
    const updates: UpdateTaskDto = {
      sections: [{ key, content: "new body" }],
    };

    const { oldContent, newContent } = buildTaskDiff(
      existing,
      updates,
      {},
      definition([{ key, label }]),
    );

    expect(oldContent).toContain(`### ${label}\nold body`);
    expect(newContent).toContain(`### ${label}\nnew body`);
  });
});

it("renders custom sections in registry order with registry labels", () => {
  const existing = makeExisting([
    { key: "summary", materializedMarkdown: "Old summary" },
    { key: "audience", materializedMarkdown: "Old audience" },
  ]);
  const updates: UpdateTaskDto = {
    sections: [
      { key: "summary", content: "New summary" },
      { key: "undeclared", content: "Hidden" },
      { key: "audience", content: "New audience" },
    ],
  };

  const { oldContent, newContent } = buildTaskDiff(
    existing,
    updates,
    {},
    definition([
      { key: "audience", label: "Intended Audience" },
      { key: "summary", label: "Executive Summary" },
    ]),
  );

  expect(newContent.indexOf("### Intended Audience")).toBeLessThan(
    newContent.indexOf("### Executive Summary"),
  );
  expect(oldContent).toContain("### Intended Audience\nOld audience");
  expect(newContent).toContain("### Executive Summary\nNew summary");
  expect(newContent).not.toContain("Hidden");
});

describe("buildTaskDiff assignee updates", () => {
  it("renders a cleared assignee as none", () => {
    const updates: UpdateTaskDto = { assigneeId: null };

    const { newContent } = buildTaskDiff(makeExisting([]), updates);

    expect(newContent).toContain("**Assignee:** (none)");
  });
});

describe("buildTaskDiff service assignment updates", () => {
  it("renders the current and proposed service sets as resolved names", () => {
    const updates: UpdateTaskProposalUpdates = {
      serviceIds: ["service-api", "service-ui"],
    };

    const { oldContent, newContent } = buildTaskDiff(
      makeExisting([]),
      updates,
      {
        existingServiceNames: ["Legacy API"],
        newServiceNames: ["API", "Web App"],
      },
    );

    expect(oldContent).toContain("**Services:** Legacy API");
    expect(newContent).toContain("**Services:** API, Web App");
    expect(oldContent).not.toContain("service-api");
    expect(newContent).not.toContain("service-ui");
  });

  it("renders an empty proposed service set as none", () => {
    const updates: UpdateTaskProposalUpdates = { serviceIds: [] };

    const { newContent } = buildTaskDiff(makeExisting([]), updates, {
      existingServiceNames: ["API"],
      newServiceNames: [],
    });

    expect(newContent).toContain("**Services:** (none)");
  });
});

it("rejects section diffs without a registry definition", () => {
  expect(() =>
    buildTaskDiff(makeExisting([]), {
      sections: [{ key: "description", content: "Authored description" }],
    }),
  ).toThrow("Task section diffs require the work-item type definition.");
});
