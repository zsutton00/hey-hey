import type { WorkItemTypeDefinitionDto } from "@hey-hey/ui-common/api";

export interface FieldPresentation {
  label: string;
  help: string;
}

export type WorkItemTypeFormField =
  | keyof Pick<
      WorkItemTypeDefinitionDto,
      | "key"
      | "name"
      | "role"
      | "description"
      | "sections"
      | "requiredScalars"
      | "forbiddenScalars"
      | "allowedStatuses"
      | "agentSettableStatuses"
      | "allowedParentTypes"
      | "allowedParentEntityTypes"
      | "edgeTargets"
      | "tracking"
      | "anchorableReportTypes"
      | "writingStandards"
      | "agentGuidance"
      | "maintenanceGuidance"
      | "sessionRoleGuidance"
      | "capabilities"
    >
  | "sections.key"
  | "sections.label"
  | "sections.writingStandard"
  | "scalarMembership"
  | "edgeTargets.edgeType"
  | "edgeTargets.targetTypeKeys"
  | "tracking.allowedSourceTaskTypes"
  | "writingStandards.create"
  | "writingStandards.edit"
  | "agentGuidance.overview"
  | "agentGuidance.examples"
  | "agentGuidance.contexts"
  | "agentGuidance.contexts.focalTypeKeys"
  | "agentGuidance.contexts.guidance"
  | "agentGuidance.contexts.examples"
  | "capabilities.key";

export const WORK_ITEM_TYPE_FIELD_PRESENTATION = {
  key: {
    label: "Type key",
    help: "Stable identifier stored on work items and used for registry lookup. It cannot change after creation.",
  },
  name: {
    label: "Display name",
    help: "Human-readable type name shown in creation and review surfaces.",
  },
  role: {
    label: "Role",
    help: "Classifies the type by purpose without defining lifecycle or execution behavior.",
  },
  description: {
    label: "Purpose",
    help: "Explain what work this type represents and when people should use it.",
  },
  sections: {
    label: "Content sections",
    help: "Ordered sections that define the content shape for this work-item type.",
  },
  "sections.key": {
    label: "Section key",
    help: "Stable storage key for this section; it must be unique within the type.",
  },
  "sections.label": {
    label: "Section heading",
    help: "Human-readable heading shown to authors and readers.",
  },
  "sections.writingStandard": {
    label: "Section writing standard",
    help: "Describe what belongs in this section and its expected quality bar.",
  },
  requiredScalars: {
    label: "Required fields",
    help: "Fields every item of this type must carry.",
  },
  forbiddenScalars: {
    label: "Unavailable fields",
    help: "Fields items of this type may not carry.",
  },
  scalarMembership: {
    label: "Availability",
    help: "Choose whether this field is optional, required, or unavailable for the type.",
  },
  allowedStatuses: {
    label: "Available statuses",
    help: "Statuses an item of this type may occupy. The first status is the default initial status.",
  },
  agentSettableStatuses: {
    label: "Agent-settable statuses",
    help: "Available statuses an agent may set directly; omit statuses reserved for system transitions.",
  },
  allowedParentTypes: {
    label: "Allowed parent work-item types",
    help: "Parent types this child may sit beneath. No selection means this type is top-level only.",
  },
  allowedParentEntityTypes: {
    label: "Allowed parent entity kinds",
    help: "Entity categories this type may be attached beneath, independently of work-item type compatibility.",
  },
  edgeTargets: {
    label: "Relationships",
    help: "Typed relationships an item of this type may originate.",
  },
  "edgeTargets.edgeType": {
    label: "Relationship type",
    help: "The relationship an item of this type may originate.",
  },
  "edgeTargets.targetTypeKeys": {
    label: "Allowed target types",
    help: "Choose All for any work-item type, or select the specific target types this relationship permits.",
  },
  tracking: {
    label: "Inbound tracking",
    help: "Choose which work-item types may track items of this target type. TRACKS sources are always work items.",
  },
  "tracking.allowedSourceTaskTypes": {
    label: "Tracking source work-item types",
    help: "Work-item types allowed to track an item of this type.",
  },
  anchorableReportTypes: {
    label: "Allowed report types",
    help: "Report types that may be anchored to an item of this type.",
  },
  writingStandards: {
    label: "Writing standards",
    help: "Type-level standards agents read before creating or editing an item.",
  },
  agentGuidance: {
    label: "Semantic guidance",
    help: "Optional meaning, recognition examples, and focal context guidance. Separate from the type purpose and creation or editing writing standards.",
  },
  sessionRoleGuidance: {
    label: "Session-role guidance",
    help: "Optional instructions for implementation, research, planning and review sessions. Session role describes the work being performed, separately from the type’s classification role, create/edit writing standards, semantic meaning and maintenance advice.",
  },
  maintenanceGuidance: {
    label: "Maintenance guidance",
    help: "Optional advice agents read when nearby project work changes. Describe what evidence warrants reviewing an existing item of this type; discovery and review timing belong to the workflow.",
  },
  "writingStandards.create": {
    label: "Writing standard — Create",
    help: "Type-level writing standard an agent reads before creating an item of this type.",
  },
  "writingStandards.edit": {
    label: "Writing standard — Edit",
    help: "Type-level writing standard an agent reads before editing an item of this type.",
  },
  "agentGuidance.overview": {
    label: "Overview",
    help: "Explain the meaning of this type and how to recognize it.",
  },
  "agentGuidance.examples": {
    label: "Examples",
    help: "General examples that help recognize this type.",
  },
  "agentGuidance.contexts": {
    label: "Contextual guidance",
    help: "Guidance that applies when working with selected focal types.",
  },
  "agentGuidance.contexts.focalTypeKeys": {
    label: "Focal types",
    help: "Work-item types for which this context applies.",
  },
  "agentGuidance.contexts.guidance": {
    label: "Contextual guidance",
    help: "Explain how this type relates to the selected focal types.",
  },
  "agentGuidance.contexts.examples": {
    label: "Context examples",
    help: "Examples specific to these focal types.",
  },
  capabilities: {
    label: "Capabilities",
    help: "Behavior the type supports. Structural parentage is declared through allowed parent types.",
  },
  "capabilities.key": {
    label: "Capability",
    help: "A supported behavior switch carried by this work-item type.",
  },
} as const satisfies Record<WorkItemTypeFormField, FieldPresentation>;

export const ALL_EDGE_TARGET_TYPES = "__all_edge_target_types__" as const;

export type EdgeTargetSelectionValue = typeof ALL_EDGE_TARGET_TYPES | string;

// The sentinel exists only inside form state; the generated DTO keeps [] as
// the canonical any-type representation in both create and edit proposals.
export function hydrateEdgeTargetSelection(
  targetTypeKeys: readonly string[],
): EdgeTargetSelectionValue[] {
  return targetTypeKeys.length === 0
    ? [ALL_EDGE_TARGET_TYPES]
    : [...targetTypeKeys];
}

export function reduceEdgeTargetSelection(
  current: readonly EdgeTargetSelectionValue[],
  requested: readonly EdgeTargetSelectionValue[],
): EdgeTargetSelectionValue[] {
  const currentIsAll = current.includes(ALL_EDGE_TARGET_TYPES);
  const requestedIncludesAll = requested.includes(ALL_EDGE_TARGET_TYPES);
  const explicitKeys = requested.filter(
    (value) => value !== ALL_EDGE_TARGET_TYPES,
  );

  if (requestedIncludesAll && !currentIsAll) {
    return [ALL_EDGE_TARGET_TYPES];
  }

  return explicitKeys.length > 0 ? explicitKeys : [ALL_EDGE_TARGET_TYPES];
}

export function serializeEdgeTargetSelection(
  selection: readonly EdgeTargetSelectionValue[],
): string[] {
  return selection.includes(ALL_EDGE_TARGET_TYPES)
    ? []
    : selection.filter((value) => value !== ALL_EDGE_TARGET_TYPES);
}

export function formatCapabilityKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();

  return spaced.length === 0
    ? WORK_ITEM_TYPE_FIELD_PRESENTATION["capabilities.key"].label
    : spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
