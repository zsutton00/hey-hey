import { describe, expect, it } from "vitest";
import type {
  WorkItemTypeDefinitionDto,
  WorkItemTypeSectionDefinition,
} from "../../../api";
import type { EditorTemplate } from "../../../types/editorTemplate";
import { createProgressiveTemplate } from "../progressiveTemplate";

// The four core seeded work-item types ship sections matching the editor's
// prior hand-coded templates. These fixtures mirror those seeded rows; if the
// backend seed is changed, these fixtures must be updated to match — that is
// the byte-for-byte parity contract this file enforces.
const REQUIREMENTS_WRITING_STANDARD =
  "Requirements are feature-scope invariants — statements that must remain true regardless of which task implements this feature. They differ from a task's Acceptance Criteria, which describe when a specific implementation task is complete.";

const SAMPLE_CONTENT = {
  description: "desc text",
  acceptanceCriteria: "ac text",
  requirements: "req text",
};

const buildDefinition = (
  key: string,
  name: string,
  description: string,
  sections: WorkItemTypeSectionDefinition[]
): WorkItemTypeDefinitionDto => ({
  key,
  name,
  description,
  sections,
  allowedStatuses: [],
});

const STANDARD_DEFINITION = buildDefinition(
  "STANDARD",
  "Standard",
  "Standard task",
  [
    { key: "description", label: "Description" },
    { key: "acceptanceCriteria", label: "Acceptance Criteria" },
  ]
);

const BUG_DEFINITION = buildDefinition("BUG", "Bug", "Bug task", [
  { key: "description", label: "Description" },
]);

const FEATURE_DEFINITION = buildDefinition(
  "FEATURE",
  "Feature",
  "Feature task",
  [
    { key: "description", label: "Description" },
    {
      key: "requirements",
      label: "Requirements",
      writingStandard: REQUIREMENTS_WRITING_STANDARD,
    },
  ]
);

// Snapshots of the prior switch output. Read by createProgressiveTemplate-callers
// downstream of this builder; any divergence here changes editor behavior.
const PRIOR_STANDARD_SECTIONS: EditorTemplate["sections"] = [
  {
    id: "description",
    kind: "markdown",
    definition: { key: "description", label: "Description" },
    header: { text: "Description", level: 2, editable: false },
    content: {
      initialText: "desc text",
      showAsSkeleton: false,
      skeletonConfig: {
        type: "text",
        lines: 3,
        width: "full",
        animated: false,
      },
    },
    editable: true,
    required: true,
  },
  {
    id: "acceptanceCriteria",
    kind: "markdown",
    definition: {
      key: "acceptanceCriteria",
      label: "Acceptance Criteria",
    },
    header: { text: "Acceptance Criteria", level: 2, editable: false },
    content: {
      initialText: "ac text",
      showAsSkeleton: false,
      skeletonConfig: {
        type: "text",
        lines: 3,
        width: "partial",
        animated: false,
      },
    },
    editable: true,
    required: false,
  },
];

const PRIOR_BUG_SECTIONS: EditorTemplate["sections"] = [
  {
    id: "description",
    kind: "markdown",
    definition: { key: "description", label: "Description" },
    header: { text: "Description", level: 2, editable: false },
    content: {
      initialText: "desc text",
      showAsSkeleton: false,
      skeletonConfig: {
        type: "text",
        lines: 3,
        width: "full",
        animated: false,
      },
    },
    editable: true,
    required: true,
  },
];

const PRIOR_FEATURE_SECTIONS: EditorTemplate["sections"] = [
  {
    id: "description",
    kind: "markdown",
    definition: { key: "description", label: "Description" },
    header: { text: "Description", level: 2, editable: false },
    content: {
      initialText: "desc text",
      showAsSkeleton: false,
      skeletonConfig: {
        type: "text",
        lines: 3,
        width: "full",
        animated: false,
      },
    },
    editable: true,
    required: true,
  },
  {
    id: "requirements",
    kind: "markdown",
    definition: {
      key: "requirements",
      label: "Requirements",
      writingStandard: REQUIREMENTS_WRITING_STANDARD,
    },
    header: { text: "Requirements", level: 2, editable: false },
    helperText: REQUIREMENTS_WRITING_STANDARD,
    content: {
      initialText: "req text",
      showAsSkeleton: false,
      skeletonConfig: {
        type: "text",
        lines: 3,
        width: "partial",
        animated: false,
      },
    },
    editable: true,
    required: false,
  },
];

describe("createProgressiveTemplate — core type parity", () => {
  it("STANDARD definition yields the prior STANDARD section output", () => {
    const template = createProgressiveTemplate({
      entityType: "task",
      definition: STANDARD_DEFINITION,
      content: SAMPLE_CONTENT,
    });
    expect(template.sections).toEqual(PRIOR_STANDARD_SECTIONS);
    expect(template.id).toBe("progressive-task-standard");
  });

  it("BUG definition yields the prior BUG section output", () => {
    const template = createProgressiveTemplate({
      entityType: "task",
      definition: BUG_DEFINITION,
      content: SAMPLE_CONTENT,
    });
    expect(template.sections).toEqual(PRIOR_BUG_SECTIONS);
    expect(template.id).toBe("progressive-task-bug");
  });

  it("FEATURE definition yields the prior FEATURE section output", () => {
    const template = createProgressiveTemplate({
      entityType: "task",
      definition: FEATURE_DEFINITION,
      content: SAMPLE_CONTENT,
    });
    expect(template.sections).toEqual(PRIOR_FEATURE_SECTIONS);
    expect(template.id).toBe("progressive-task-feature");
  });

  it("falls back to description-only when no definition is provided", () => {
    const template = createProgressiveTemplate({
      entityType: "task",
      content: SAMPLE_CONTENT,
    });
    expect(template.sections).toHaveLength(1);
    expect(template.sections[0]?.id).toBe("description");
    expect(template.id).toBe("progressive-fallback");
  });

  it("uses fallback for initiative entityType", () => {
    const template = createProgressiveTemplate({
      entityType: "initiative",
      definition: STANDARD_DEFINITION,
      content: SAMPLE_CONTENT,
    });
    expect(template.id).toBe("progressive-fallback");
    expect(template.sections).toHaveLength(1);
  });
});
