import type {
  MaterializedWorkItemSection,
  TaskSectionInput,
  WorkItemTypeDefinitionDto,
  WorkItemTypeSectionDefinition,
  WorkItemSectionInput,
  WorkItemHtmlCssSectionContent,
  WorkItemHtmlCssAnnotation,
  WorkItemStructuredMockupComponent,
  WorkItemStructuredMockupWidth,
  WorkItemStructuredMockupHeight,
  WorkItemStructuredMockupContainerProps,
  WorkItemStructuredMockupAnnotation,
  WorkItemStructuredMockupSectionContentV3,
  WorkItemStructuredMockupComponentV5 as ApiWorkItemStructuredMockupComponentV5,
  WorkItemStructuredMockupSectionContentV5,
} from "../api";

// V1/V2 are retired API schemas, but persisted documents can still contain
// their legacy container vocabulary. Keep this read-only compatibility shape
// local to the decoder instead of reintroducing retired generated API types.
type LegacyStructuredMockupContainerProps = {
  id: string;
  width: WorkItemStructuredMockupWidth;
  height: WorkItemStructuredMockupHeight;
  gap: number;
  padding: number;
  align: "start" | "center" | "end" | "spread";
  surface?: "plain" | "panel" | "muted" | "dashed";
};

type LegacyStructuredMockupLeafComponent = Exclude<
  WorkItemStructuredMockupComponent,
  { children: unknown }
>;

type LegacyStructuredMockupRow = {
  type: "row";
  props: LegacyStructuredMockupContainerProps;
  children: LegacyStructuredMockupComponent[];
};

type LegacyStructuredMockupColumn = {
  type: "column";
  props: LegacyStructuredMockupContainerProps;
  children: LegacyStructuredMockupComponent[];
};

type LegacyStructuredMockupComponent =
  | LegacyStructuredMockupLeafComponent
  | LegacyStructuredMockupRow
  | LegacyStructuredMockupColumn;

export type WorkItemStructuredMockupComponentV4 =
  | Exclude<WorkItemStructuredMockupComponent, { children: unknown }>
  | {
      type: "row" | "column";
      props: WorkItemStructuredMockupContainerProps;
      children: WorkItemStructuredMockupComponentV4[];
    }
  | {
      type: "slot";
      props: {
        id: string;
        width: WorkItemStructuredMockupWidth;
        height: WorkItemStructuredMockupHeight;
        name: string;
        surface?: "plain" | "panel" | "muted" | "dashed";
      };
    }
  | {
      type: "icon";
      props: {
        id: string;
        width: WorkItemStructuredMockupWidth;
        height: WorkItemStructuredMockupHeight;
        iconKey: string;
        accessibleLabel: string;
      };
    }
  | {
      type: "mockup-occurrence";
      props: {
        id: string;
        width: WorkItemStructuredMockupWidth;
        height: WorkItemStructuredMockupHeight;
        sourceMockupId: string;
        slotAssignments: Array<{
          slotName: string;
          children: WorkItemStructuredMockupComponentV4[];
        }>;
      };
    };
export type WorkItemStructuredMockupComponentV5 =
  ApiWorkItemStructuredMockupComponentV5;
export interface WorkItemStructuredMockupSectionContentV4 {
  schemaVersion: "work-item-structured-mockup.v4";
  revision: number;
  content: WorkItemStructuredMockupComponentV4[];
  annotations: WorkItemStructuredMockupAnnotation[];
  sizeKey?: string;
}
export type NormalizedWorkItemStructuredMockupDocument =
  | WorkItemStructuredMockupSectionContentV3
  | WorkItemStructuredMockupSectionContentV4
  | WorkItemStructuredMockupSectionContentV5;
import { WorkItemTypeSectionDefinitionKindEnum } from "../api";
import type { MultiLevelContent } from "./workItemContent";
import { isStructuredMockupIconKey } from "./entityIcons";

export const WORK_ITEM_SECTION_KEYS = [
  "description",
  "acceptanceCriteria",
] as const;

export type WorkItemSectionKey = (typeof WORK_ITEM_SECTION_KEYS)[number];

type WorkItemSectionLike = MaterializedWorkItemSection | WorkItemSectionInput;
type TaskSectionLike = MaterializedWorkItemSection | TaskSectionInput;

// These keys remain useful for legacy callers that explicitly request the
// built-in markdown sections. They are not the set of keys a task may own.
export const TASK_SECTION_KEYS = [
  "description",
  "acceptanceCriteria",
  "requirements",
] as const satisfies readonly TaskSectionInput["key"][];

export type BuiltInTaskSectionKey = (typeof TASK_SECTION_KEYS)[number];
export type TaskSectionKey = string;

export const isBuiltInTaskSectionKey = (
  key: string
): key is BuiltInTaskSectionKey =>
  (TASK_SECTION_KEYS as readonly string[]).includes(key);

export const isTaskSectionKey = (key: string): key is TaskSectionKey =>
  key.trim().length > 0;

export interface ResolvedWorkItemSectionSelection {
  status: "resolved";
  typeKey: string;
  sections: readonly WorkItemTypeSectionDefinition[];
}

export interface UnavailableWorkItemSectionSelection {
  status: "unavailable";
  reason: "missing-type" | "loading" | "unresolved";
}

export type WorkItemSectionSelection =
  | ResolvedWorkItemSectionSelection
  | UnavailableWorkItemSectionSelection;

export const selectWorkItemSections = (input: {
  typeKey: string | null | undefined;
  definition: WorkItemTypeDefinitionDto | undefined;
  isFetched: boolean;
}): WorkItemSectionSelection => {
  if (!input.typeKey) {
    return { status: "unavailable", reason: "missing-type" };
  }

  if (!input.isFetched) {
    return { status: "unavailable", reason: "loading" };
  }

  if (!input.definition || input.definition.key !== input.typeKey) {
    return { status: "unavailable", reason: "unresolved" };
  }

  return {
    status: "resolved",
    typeKey: input.definition.key,
    sections: input.definition.sections,
  };
};

export const selectInlineWorkItemSections = (
  selection: WorkItemSectionSelection
): WorkItemSectionSelection => {
  if (selection.status === "unavailable") {
    return selection;
  }

  const visualSections = selection.sections.filter(
    (section) =>
      section.kind === WorkItemTypeSectionDefinitionKindEnum.HtmlCss ||
      section.kind === WorkItemTypeSectionDefinitionKindEnum.StructuredMockup
  );

  return {
    ...selection,
    sections: visualSections,
  };
};

export const getSelectedSectionKeys = (
  selection: WorkItemSectionSelection
): readonly string[] =>
  selection.status === "resolved"
    ? selection.sections.map((section) => section.key)
    : [];

export const hasSelectedSection = (
  selection: WorkItemSectionSelection,
  key: string
): boolean => getSelectedSectionKeys(selection).includes(key);

const isMaterializedSection = (
  section: WorkItemSectionLike
): section is MaterializedWorkItemSection => "materializedMarkdown" in section;

const getSectionMarkdown = (section: WorkItemSectionLike): string =>
  isMaterializedSection(section)
    ? section.materializedMarkdown
    : section.content;

const isMaterializedTaskSection = (
  section: TaskSectionLike
): section is MaterializedWorkItemSection => "materializedMarkdown" in section;

const getTaskSectionMarkdown = (section: TaskSectionLike): string => {
  const value = isMaterializedTaskSection(section)
    ? section.materializedMarkdown
    : section.content;
  return typeof value === "string" ? value : "";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean => Object.keys(value).every((key) => keys.includes(key));

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

const isHtmlCssAnnotation = (
  value: unknown,
  annotationIds: Set<string>
): value is WorkItemHtmlCssAnnotation => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "note",
      "author",
      "category",
      "lifecycle",
      "authoredProposalId",
      "authoredSizeKey",
      "target",
    ]) ||
    !isUuid(value.id) ||
    annotationIds.has(value.id) ||
    typeof value.note !== "string" ||
    value.note.length === 0 ||
    value.note.length > 4000 ||
    !["context", "suggestion", "question", "issue"].includes(
      String(value.category)
    ) ||
    !["open", "resolved"].includes(String(value.lifecycle)) ||
    !isUuid(value.authoredProposalId) ||
    typeof value.authoredSizeKey !== "string" ||
    value.authoredSizeKey.length === 0 ||
    !isRecord(value.author) ||
    !isRecord(value.target)
  ) {
    return false;
  }
  const validAuthor =
    (value.author.type === "human" &&
      hasOnlyKeys(value.author, ["type", "userId"]) &&
      isUuid(value.author.userId)) ||
    (value.author.type === "agent" &&
      hasOnlyKeys(value.author, ["type", "agentSessionId"]) &&
      isUuid(value.author.agentSessionId));
  const validTarget =
    (value.target.type === "element" &&
      hasOnlyKeys(value.target, ["type", "nodeId"]) &&
      typeof value.target.nodeId === "string" &&
      value.target.nodeId.length > 0) ||
    (value.target.type === "position" &&
      hasOnlyKeys(value.target, ["type", "x", "y", "sizeKey"]) &&
      typeof value.target.x === "number" &&
      value.target.x >= 0 &&
      value.target.x <= 1 &&
      typeof value.target.y === "number" &&
      value.target.y >= 0 &&
      value.target.y <= 1 &&
      typeof value.target.sizeKey === "string" &&
      value.target.sizeKey.length > 0);
  if (!validAuthor || !validTarget) return false;
  annotationIds.add(value.id);
  return true;
};

export const decodeHtmlCssSectionContent = (
  value: unknown
): WorkItemHtmlCssSectionContent | null => {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      return null;
    }
  }
  if (
    !isRecord(decoded) ||
    !hasOnlyKeys(decoded, ["html", "css", "sizeKey", "annotations"]) ||
    typeof decoded.html !== "string" ||
    typeof decoded.css !== "string" ||
    (decoded.sizeKey !== undefined &&
      (typeof decoded.sizeKey !== "string" || decoded.sizeKey.length === 0)) ||
    (decoded.annotations !== undefined && !Array.isArray(decoded.annotations))
  ) {
    return null;
  }
  const annotationIds = new Set<string>();
  if (
    Array.isArray(decoded.annotations) &&
    !decoded.annotations.every((annotation) =>
      isHtmlCssAnnotation(annotation, annotationIds)
    )
  ) {
    return null;
  }
  return {
    html: decoded.html,
    css: decoded.css,
    ...(typeof decoded.sizeKey === "string"
      ? { sizeKey: decoded.sizeKey }
      : {}),
    ...(Array.isArray(decoded.annotations)
      ? { annotations: decoded.annotations }
      : {}),
  };
};

export const serializeHtmlCssSectionContent = (value: unknown): string => {
  const decoded = decodeHtmlCssSectionContent(value);
  return decoded ? JSON.stringify(decoded) : "";
};

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && typeof value === "number" && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && typeof value === "number" && value >= 0;

const isStructuredMockupWidth = (value: unknown): boolean => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["mode", "value"])) return false;
  return value.mode === "fixed"
    ? isPositiveInteger(value.value)
    : (value.mode === "fit" || value.mode === "fill") &&
        value.value === undefined;
};

const isStructuredMockupHeight = (value: unknown): boolean => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["mode", "value"])) return false;
  return value.mode === "fixed"
    ? isPositiveInteger(value.value)
    : value.mode === "content" && value.value === undefined;
};

interface StructuredMockupBasePropsRecord extends Record<string, unknown> {
  id: string;
}

const isStructuredMockupBaseProps = (
  value: unknown
): value is StructuredMockupBasePropsRecord =>
  isRecord(value) &&
  typeof value.id === "string" &&
  value.id.length > 0 &&
  isStructuredMockupWidth(value.width) &&
  isStructuredMockupHeight(value.height);

const STRUCTURED_MOCKUP_SEMANTIC_ROLES = [
  "button",
  "heading",
  "img",
  "link",
  "list",
  "listitem",
  "navigation",
  "region",
  "status",
  "separator",
  "textbox",
  "none",
  "presentation",
] as const;
const STRUCTURED_MOCKUP_COLORS = [
  "primary",
  "secondary",
  "success",
  "warning",
  "error",
  "info",
  "neutral",
  "muted",
  "surface",
  "transparent",
] as const;
const STRUCTURED_MOCKUP_OVERFLOW = ["visible", "hidden"] as const;
const STRUCTURED_MOCKUP_CARET_DIRECTIONS = [
  "up",
  "right",
  "down",
  "left",
] as const;
const STRUCTURED_MOCKUP_SHAPE_KINDS = [
  "circle",
  "square",
  "rounded",
  "pill",
  "diamond",
  "triangle",
] as const;
const STRUCTURED_MOCKUP_DIVIDER_ORIENTATIONS = [
  "horizontal",
  "vertical",
] as const;
const STRUCTURED_MOCKUP_V5_APPEARANCE_KEYS = [
  "role",
  "description",
  "color",
  "opacity",
  "overflow",
] as const;

const isStructuredMockupV5Appearance = (
  value: Record<string, unknown>
): boolean =>
  (value.role === undefined ||
    (typeof value.role === "string" &&
      STRUCTURED_MOCKUP_SEMANTIC_ROLES.includes(
        value.role as (typeof STRUCTURED_MOCKUP_SEMANTIC_ROLES)[number]
      ))) &&
  (value.description === undefined ||
    (typeof value.description === "string" && value.description.length > 0)) &&
  (value.color === undefined ||
    (typeof value.color === "string" &&
      STRUCTURED_MOCKUP_COLORS.includes(
        value.color as (typeof STRUCTURED_MOCKUP_COLORS)[number]
      ))) &&
  (value.opacity === undefined ||
    (typeof value.opacity === "number" &&
      Number.isFinite(value.opacity) &&
      value.opacity >= 0 &&
      value.opacity <= 1)) &&
  (value.overflow === undefined ||
    (typeof value.overflow === "string" &&
      STRUCTURED_MOCKUP_OVERFLOW.includes(
        value.overflow as (typeof STRUCTURED_MOCKUP_OVERFLOW)[number]
      )));

const isStructuredMockupComponent = (
  value: unknown,
  ids: Set<string>,
  vocabulary: "legacy" | "latest" | "composition" | "v5"
): boolean => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["type", "props", "children"])) {
    return false;
  }
  if (!isStructuredMockupBaseProps(value.props) || ids.has(value.props.id)) {
    return false;
  }
  ids.add(value.props.id);
  const props = value.props;
  const layoutKeys = ["id", "width", "height"] as const;
  const appearanceKeys =
    vocabulary === "v5" ? STRUCTURED_MOCKUP_V5_APPEARANCE_KEYS : [];
  const appearanceValid =
    vocabulary !== "v5" || isStructuredMockupV5Appearance(props);
  switch (value.type) {
    case "text":
      return (
        value.children === undefined &&
        hasOnlyKeys(props, [
          ...layoutKeys,
          ...appearanceKeys,
          "text",
          "variant",
        ]) &&
        appearanceValid &&
        (props.variant === undefined ||
          (typeof props.variant === "string" &&
            ["body", "heading", "caption", "label", "badge"].includes(
              String(props.variant)
            ))) &&
        typeof props.text === "string"
      );
    case "button":
      return (
        value.children === undefined &&
        hasOnlyKeys(props, [...layoutKeys, ...appearanceKeys, "label"]) &&
        appearanceValid &&
        typeof props.label === "string"
      );
    case "input":
      return (
        value.children === undefined &&
        hasOnlyKeys(props, [
          ...layoutKeys,
          ...appearanceKeys,
          "label",
          "placeholder",
          "value",
          "multiline",
        ]) &&
        appearanceValid &&
        typeof props.label === "string" &&
        typeof props.placeholder === "string" &&
        (props.multiline === undefined ||
          typeof props.multiline === "boolean") &&
        (props.value === undefined || typeof props.value === "string")
      );
    case "card":
    case "rectangle":
      return (
        value.children === undefined &&
        hasOnlyKeys(props, [...layoutKeys, ...appearanceKeys, "label"]) &&
        appearanceValid &&
        (props.label === undefined || typeof props.label === "string")
      );
    case "image-placeholder":
      return (
        value.children === undefined &&
        hasOnlyKeys(props, [...layoutKeys, ...appearanceKeys, "altText"]) &&
        appearanceValid &&
        typeof props.altText === "string"
      );
    case "divider":
      return (
        value.children === undefined &&
        (vocabulary === "v5"
          ? hasOnlyKeys(props, [
              ...layoutKeys,
              ...appearanceKeys,
              "orientation",
            ]) &&
            appearanceValid &&
            typeof props.orientation === "string" &&
            STRUCTURED_MOCKUP_DIVIDER_ORIENTATIONS.includes(
              props.orientation as (typeof STRUCTURED_MOCKUP_DIVIDER_ORIENTATIONS)[number]
            )
          : hasOnlyKeys(props, layoutKeys))
      );
    case "row":
    case "column":
      return (
        hasOnlyKeys(props, [
          ...layoutKeys,
          ...appearanceKeys,
          "gap",
          "padding",
          ...(vocabulary !== "legacy" ? ["justify"] : []),
          "align",
          "surface",
        ]) &&
        appearanceValid &&
        (props.surface === undefined ||
          (typeof props.surface === "string" &&
            ["plain", "panel", "muted", "dashed"].includes(
              String(props.surface)
            ))) &&
        isNonNegativeInteger(props.gap) &&
        isNonNegativeInteger(props.padding) &&
        (vocabulary !== "legacy"
          ? ["start", "center", "end", "spread"].includes(
              String(props.justify)
            ) &&
            ["start", "center", "end", "stretch"].includes(String(props.align))
          : ["start", "center", "end", "spread"].includes(
              String(props.align)
            )) &&
        Array.isArray(value.children) &&
        value.children.every((child) =>
          isStructuredMockupComponent(child, ids, vocabulary)
        )
      );
    case "slot":
      return (
        (vocabulary === "composition" || vocabulary === "v5") &&
        value.children === undefined &&
        hasOnlyKeys(props, [
          ...layoutKeys,
          ...appearanceKeys,
          "name",
          "surface",
        ]) &&
        appearanceValid &&
        typeof props.name === "string" &&
        props.name.length > 0 &&
        (props.surface === undefined ||
          ["plain", "panel", "muted", "dashed"].includes(String(props.surface)))
      );
    case "icon":
      return (
        (vocabulary === "composition" || vocabulary === "v5") &&
        value.children === undefined &&
        hasOnlyKeys(props, [
          ...layoutKeys,
          ...appearanceKeys,
          "iconKey",
          "accessibleLabel",
        ]) &&
        appearanceValid &&
        typeof props.iconKey === "string" &&
        props.iconKey.length > 0 &&
        typeof props.accessibleLabel === "string" &&
        props.accessibleLabel.length > 0 &&
        (vocabulary !== "v5" || isStructuredMockupIconKey(props.iconKey))
      );
    case "caret":
      return (
        vocabulary === "v5" &&
        value.children === undefined &&
        hasOnlyKeys(props, [...layoutKeys, ...appearanceKeys, "direction"]) &&
        appearanceValid &&
        typeof props.direction === "string" &&
        STRUCTURED_MOCKUP_CARET_DIRECTIONS.includes(
          props.direction as (typeof STRUCTURED_MOCKUP_CARET_DIRECTIONS)[number]
        )
      );
    case "shape":
      return (
        vocabulary === "v5" &&
        value.children === undefined &&
        hasOnlyKeys(props, [...layoutKeys, ...appearanceKeys, "kind"]) &&
        appearanceValid &&
        typeof props.kind === "string" &&
        STRUCTURED_MOCKUP_SHAPE_KINDS.includes(
          props.kind as (typeof STRUCTURED_MOCKUP_SHAPE_KINDS)[number]
        )
      );
    case "mockup-occurrence": {
      if (
        (vocabulary !== "composition" && vocabulary !== "v5") ||
        value.children !== undefined ||
        !hasOnlyKeys(props, [
          ...layoutKeys,
          ...appearanceKeys,
          "sourceMockupId",
          "slotAssignments",
        ]) ||
        !appearanceValid ||
        !isUuid(props.sourceMockupId) ||
        props.sourceMockupId === props.id ||
        !Array.isArray(props.slotAssignments)
      )
        return false;
      const names = new Set<string>();
      return props.slotAssignments.every((assignment) => {
        if (
          !isRecord(assignment) ||
          !hasOnlyKeys(assignment, ["slotName", "children"]) ||
          typeof assignment.slotName !== "string" ||
          assignment.slotName.length === 0 ||
          names.has(assignment.slotName) ||
          !Array.isArray(assignment.children)
        )
          return false;
        names.add(assignment.slotName);
        return assignment.children.every((child) =>
          isStructuredMockupComponent(child, ids, vocabulary)
        );
      });
    }
    default:
      return false;
  }
};

const migrateLegacyStructuredMockupComponent = (
  component: LegacyStructuredMockupComponent
): WorkItemStructuredMockupComponent => {
  if (component.type !== "row" && component.type !== "column") {
    return component;
  }
  return {
    type: component.type,
    props: {
      ...component.props,
      justify: component.props.align,
      align: "stretch",
    },
    children: component.children.map(migrateLegacyStructuredMockupComponent),
  };
};

const isStructuredMockupAnnotation = (
  value: unknown,
  annotationIds: Set<string>
): value is WorkItemStructuredMockupAnnotation => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "note",
      "author",
      "category",
      "lifecycle",
      "authoredProposalId",
      "authoredSizeKey",
      "target",
    ]) ||
    !isUuid(value.id) ||
    annotationIds.has(value.id) ||
    typeof value.note !== "string" ||
    value.note.length === 0 ||
    value.note.length > 4000 ||
    !["context", "suggestion", "question", "issue"].includes(
      String(value.category)
    ) ||
    !["open", "resolved"].includes(String(value.lifecycle)) ||
    !isUuid(value.authoredProposalId) ||
    typeof value.authoredSizeKey !== "string" ||
    value.authoredSizeKey.length === 0 ||
    !isRecord(value.author) ||
    !isRecord(value.target)
  ) {
    return false;
  }
  const validAuthor =
    (value.author.type === "human" &&
      hasOnlyKeys(value.author, ["type", "userId"]) &&
      isUuid(value.author.userId)) ||
    (value.author.type === "agent" &&
      hasOnlyKeys(value.author, ["type", "agentSessionId"]) &&
      isUuid(value.author.agentSessionId));
  const validTarget =
    (value.target.type === "component" &&
      hasOnlyKeys(value.target, ["type", "componentId"]) &&
      typeof value.target.componentId === "string" &&
      value.target.componentId.length > 0) ||
    (value.target.type === "position" &&
      hasOnlyKeys(value.target, ["type", "x", "y"]) &&
      typeof value.target.x === "number" &&
      value.target.x >= 0 &&
      value.target.x <= 1 &&
      typeof value.target.y === "number" &&
      value.target.y >= 0 &&
      value.target.y <= 1);
  if (!validAuthor || !validTarget) return false;
  annotationIds.add(value.id);
  return true;
};

export const decodeStructuredMockupSectionContent = (
  value: unknown
): NormalizedWorkItemStructuredMockupDocument | null => {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      return null;
    }
  }
  if (
    !isRecord(decoded) ||
    !hasOnlyKeys(decoded, [
      "schemaVersion",
      "revision",
      "content",
      "sizeKey",
      "annotations",
    ]) ||
    (decoded.schemaVersion !== "work-item-structured-mockup.v1" &&
      decoded.schemaVersion !== "work-item-structured-mockup.v2" &&
      decoded.schemaVersion !== "work-item-structured-mockup.v3" &&
      decoded.schemaVersion !== "work-item-structured-mockup.v4" &&
      decoded.schemaVersion !== "work-item-structured-mockup.v5") ||
    !Array.isArray(decoded.content) ||
    (decoded.sizeKey !== undefined &&
      (typeof decoded.sizeKey !== "string" || decoded.sizeKey.length === 0))
  ) {
    return null;
  }
  const ids = new Set<string>();
  const vocabulary =
    decoded.schemaVersion === "work-item-structured-mockup.v5"
      ? "v5"
      : decoded.schemaVersion === "work-item-structured-mockup.v4"
      ? "composition"
      : decoded.schemaVersion === "work-item-structured-mockup.v3"
      ? "latest"
      : "legacy";
  if (
    !decoded.content.every((item) =>
      isStructuredMockupComponent(item, ids, vocabulary)
    )
  ) {
    return null;
  }
  if (decoded.schemaVersion !== "work-item-structured-mockup.v1") {
    if (
      !isPositiveInteger(decoded.revision) ||
      !Array.isArray(decoded.annotations)
    ) {
      return null;
    }
    const annotationIds = new Set<string>();
    const annotations: WorkItemStructuredMockupAnnotation[] = [];
    for (const annotation of decoded.annotations) {
      if (
        isRecord(annotation) &&
        "authoredRevision" in annotation &&
        !("authoredProposalId" in annotation)
      ) {
        continue;
      }
      if (!isStructuredMockupAnnotation(annotation, annotationIds)) return null;
      annotations.push(annotation);
    }
    const normalized = {
      revision: decoded.revision,
      content:
        vocabulary === "v5"
          ? (decoded.content as WorkItemStructuredMockupComponentV5[])
          : vocabulary === "composition"
          ? (decoded.content as WorkItemStructuredMockupComponentV4[])
          : vocabulary === "latest"
          ? (decoded.content as WorkItemStructuredMockupComponent[])
          : (decoded.content as LegacyStructuredMockupComponent[]).map(
              migrateLegacyStructuredMockupComponent
            ),
      annotations,
      ...(typeof decoded.sizeKey === "string"
        ? { sizeKey: decoded.sizeKey }
        : {}),
    };
    return vocabulary === "v5"
      ? {
          ...normalized,
          schemaVersion: "work-item-structured-mockup.v5",
          content: normalized.content as WorkItemStructuredMockupComponentV5[],
        }
      : vocabulary === "composition"
      ? {
          ...normalized,
          schemaVersion: "work-item-structured-mockup.v4",
          content: normalized.content as WorkItemStructuredMockupComponentV4[],
        }
      : {
          ...normalized,
          schemaVersion: "work-item-structured-mockup.v3",
          content: normalized.content as WorkItemStructuredMockupComponent[],
        };
  }
  return {
    schemaVersion: "work-item-structured-mockup.v3",
    revision: 1,
    content: (decoded.content as LegacyStructuredMockupComponent[]).map(
      migrateLegacyStructuredMockupComponent
    ),
    annotations: [],
    ...(typeof decoded.sizeKey === "string"
      ? { sizeKey: decoded.sizeKey }
      : {}),
  };
};

export const serializeStructuredMockupSectionContent = (
  value: unknown
): string => {
  const decoded = decodeStructuredMockupSectionContent(value);
  return decoded ? JSON.stringify(decoded) : "";
};

const getSectionOrder = (section: { order?: number }): number =>
  typeof section.order === "number" ? section.order : 0;

export const getWorkItemSectionContent = (
  sections: WorkItemSectionLike[] | undefined,
  key: WorkItemSectionKey
): string => {
  if (!sections?.length) {
    return "";
  }

  const match = sections.find((section) => section.key === key);
  return match ? getSectionMarkdown(match) : "";
};

export const getTaskSectionContent = (
  sections: readonly TaskSectionLike[] | undefined,
  key: string
): string => {
  if (!sections?.length) {
    return "";
  }

  const match = sections.find((section) => section.key === key);
  return match ? getTaskSectionMarkdown(match) : "";
};

export type WorkItemSectionContent = Pick<
  MultiLevelContent,
  "description" | "acceptanceCriteria"
>;

export const getWorkItemContentFromSections = (
  sections: WorkItemSectionLike[] | undefined
): WorkItemSectionContent => ({
  description: getWorkItemSectionContent(sections, "description"),
  acceptanceCriteria: getWorkItemSectionContent(sections, "acceptanceCriteria"),
});

export const contentToSectionInputs = (
  content: WorkItemSectionContent,
  options: { includeEmpty?: boolean } = {}
): TaskSectionInput[] => {
  const includeEmpty = options.includeEmpty ?? true;
  const inputs: TaskSectionInput[] = [];

  WORK_ITEM_SECTION_KEYS.forEach((key, index) => {
    const value = content[key] ?? "";
    if (!includeEmpty && !value.trim()) {
      return;
    }

    inputs.push({
      key,
      content: value,
      order: index,
    });
  });

  return inputs;
};

export interface TaskSectionContent extends Record<string, string> {
  description: string;
  acceptanceCriteria: string;
  requirements: string;
}

export const getTaskContentFromSections = (
  sections: readonly TaskSectionLike[] | undefined,
  selection?: WorkItemSectionSelection
): TaskSectionContent => {
  const content: TaskSectionContent = {
    description: "",
    acceptanceCriteria: "",
    requirements: "",
  };

  const selectedKeys =
    selection?.status === "resolved"
      ? new Set(selection.sections.map((section) => section.key))
      : undefined;

  for (const section of sections ?? []) {
    if (selectedKeys && !selectedKeys.has(section.key)) {
      continue;
    }
    const definition =
      selection?.status === "resolved"
        ? selection.sections.find(({ key }) => key === section.key)
        : undefined;
    const rawValue = isMaterializedTaskSection(section)
      ? section.materializedMarkdown
      : section.content;
    content[section.key] =
      definition?.kind === WorkItemTypeSectionDefinitionKindEnum.HtmlCss
        ? serializeHtmlCssSectionContent(rawValue)
        : definition?.kind ===
          WorkItemTypeSectionDefinitionKindEnum.StructuredMockup
        ? serializeStructuredMockupSectionContent(rawValue)
        : getTaskSectionMarkdown(section);
  }

  return content;
};

export const taskContentToSectionInputs = (
  content: Readonly<Record<string, string>>,
  options: {
    includeEmpty?: boolean;
    selection: WorkItemSectionSelection;
  }
): TaskSectionInput[] => {
  const includeEmpty = options.includeEmpty ?? true;
  if (options.selection.status !== "resolved") {
    return [];
  }

  const inputs: TaskSectionInput[] = [];

  options.selection.sections.forEach((section, index) => {
    const value = content[section.key] ?? "";
    if (!includeEmpty && !value.trim()) {
      return;
    }

    const encodedContent =
      section.kind === WorkItemTypeSectionDefinitionKindEnum.HtmlCss
        ? decodeHtmlCssSectionContent(value)
        : section.kind ===
          WorkItemTypeSectionDefinitionKindEnum.StructuredMockup
        ? decodeStructuredMockupSectionContent(value)
        : value;
    if (
      (section.kind === WorkItemTypeSectionDefinitionKindEnum.HtmlCss ||
        section.kind ===
          WorkItemTypeSectionDefinitionKindEnum.StructuredMockup) &&
      !encodedContent
    ) {
      return;
    }
    // An unset schema-backed JSON section is absent rather than an empty
    // document; "" would fail server validation, e.g. a MODE whose optional
    // settings section has never been chosen.
    if (
      section.kind === WorkItemTypeSectionDefinitionKindEnum.Json &&
      !value.trim()
    ) {
      return;
    }
    inputs.push({
      key: section.key,
      content: encodedContent,
      order: index,
    });
  });

  return inputs;
};

export const applySectionInputsToMaterialized = (
  existing: MaterializedWorkItemSection[] | undefined,
  updates: WorkItemSectionInput[] | undefined
): MaterializedWorkItemSection[] | undefined => {
  if (!updates?.length) {
    return existing;
  }

  const existingSections = existing ?? [];
  const byKey = new Map<string, MaterializedWorkItemSection>(
    existingSections.map((section) => [section.key, section])
  );

  const maxOrder = existingSections.reduce(
    (max, section) => Math.max(max, section.order),
    -1
  );
  let nextOrder = maxOrder + 1;

  updates.forEach((update) => {
    if (!(WORK_ITEM_SECTION_KEYS as readonly string[]).includes(update.key)) {
      return;
    }

    const key = update.key;
    const current = byKey.get(key);
    if (current) {
      byKey.set(key, {
        ...current,
        materializedMarkdown: update.content,
        order: update.order ?? current.order,
      });
      return;
    }

    const order = update.order ?? nextOrder;
    if (update.order === undefined) {
      nextOrder += 1;
    }

    byKey.set(key, {
      id: `temp-${key}`,
      key,
      order,
      materializedMarkdown: update.content,
      materializedProposalId: "",
      crdtSnapshotSeq: null,
    });
  });

  return Array.from(byKey.values()).sort(
    (a, b) => getSectionOrder(a) - getSectionOrder(b)
  );
};

const materializeTaskSectionContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  const serialized = JSON.stringify(content);
  if (serialized === undefined) {
    throw new Error("Task section content must be JSON-serializable.");
  }
  return serialized;
};

export const applyTaskSectionInputsToMaterialized = (
  existing: MaterializedWorkItemSection[] | undefined,
  updates: TaskSectionInput[] | undefined,
  selection?: WorkItemSectionSelection
): MaterializedWorkItemSection[] | undefined => {
  if (!updates?.length) {
    return existing;
  }

  if (selection?.status === "unavailable") {
    return existing;
  }

  const existingSections = existing ?? [];
  const declaredKeys =
    selection?.status === "resolved"
      ? new Set(selection.sections.map((section) => section.key))
      : undefined;
  const byKey = new Map<string, MaterializedWorkItemSection>(
    existingSections.map((section) => [section.key, section])
  );

  if (declaredKeys) {
    for (const key of byKey.keys()) {
      if (!declaredKeys.has(key)) {
        byKey.delete(key);
      }
    }
  }

  const maxOrder = existingSections.reduce(
    (max, section) => Math.max(max, section.order),
    -1
  );
  let nextOrder = maxOrder + 1;

  updates.forEach((update) => {
    if (declaredKeys && !declaredKeys.has(update.key)) {
      return;
    }

    const key = update.key;
    const materializedMarkdown = materializeTaskSectionContent(update.content);
    const current = byKey.get(key);
    if (current) {
      byKey.set(key, {
        ...current,
        materializedMarkdown,
        order: update.order ?? current.order,
      });
      return;
    }

    const order = update.order ?? nextOrder;
    if (update.order === undefined) {
      nextOrder += 1;
    }

    byKey.set(key, {
      id: `temp-${key}`,
      key,
      order,
      materializedMarkdown,
      materializedProposalId: "",
      crdtSnapshotSeq: null,
    });
  });

  if (selection?.status === "resolved") {
    const declaredOrder = new Map(
      selection.sections.map((section, index) => [section.key, index])
    );
    return Array.from(byKey.values())
      .map((section) => ({
        ...section,
        order: declaredOrder.get(section.key) ?? section.order,
      }))
      .sort((a, b) => getSectionOrder(a) - getSectionOrder(b));
  }

  return Array.from(byKey.values()).sort(
    (a, b) => getSectionOrder(a) - getSectionOrder(b)
  );
};
