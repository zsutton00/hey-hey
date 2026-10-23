import type { WorkItemGraphNodePresentationValue } from "../../api";

export const WORKFLOW_STEP_GRAPH_PRESENTATION_SECTION_KEY =
  "graphPresentation" as const;
export const WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION =
  "work-item-graph-node-presentation.v1" as const;

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsePresentationValue = (
  content: unknown
): WorkItemGraphNodePresentationValue | null => {
  let value = content;
  if (typeof content === "string") {
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      return null;
    }
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION
  ) {
    return null;
  }
  return value as unknown as WorkItemGraphNodePresentationValue;
};

export const getAuthoredWorkflowStepColor = (
  sections:
    | readonly {
        key: string;
        content?: unknown;
        materializedMarkdown?: string;
      }[]
    | undefined
): string | undefined => {
  const section = sections?.find(
    (candidate) =>
      candidate.key === WORKFLOW_STEP_GRAPH_PRESENTATION_SECTION_KEY
  );
  if (!section) return undefined;
  const presentation = parsePresentationValue(
    "materializedMarkdown" in section
      ? section.materializedMarkdown
      : section.content
  );
  return presentation?.color && HEX_COLOR_PATTERN.test(presentation.color)
    ? presentation.color
    : undefined;
};

export const buildAuthoredWorkflowStepPresentation = (
  color: string
): WorkItemGraphNodePresentationValue => ({
  schemaVersion: WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION,
  color,
});

export const isWorkflowStepGraphPresentationSection = (section: {
  key: string;
  schemaRef?: string | null;
}): boolean => section.key === WORKFLOW_STEP_GRAPH_PRESENTATION_SECTION_KEY;
