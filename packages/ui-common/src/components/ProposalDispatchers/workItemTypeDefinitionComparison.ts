import type {
  WorkItemTypeDefinitionDto,
  WorkItemTypeSectionDefinition,
} from "../../api";

export interface DefinitionFieldComparison {
  label: string;
  before: string;
  after: string;
}
interface SectionDeclarationComparison {
  key: string;
  label: string;
  change: "added" | "removed" | "modified" | "unchanged";
  fields: DefinitionFieldComparison[];
}
export interface WorkItemTypeDefinitionComparison {
  fields: DefinitionFieldComparison[];
  sections: SectionDeclarationComparison[];
  order: DefinitionFieldComparison | null;
}

// Object insertion order is representation; array order can carry policy.
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}
function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string"
    ? value
    : JSON.stringify(canonicalValue(value), null, 2);
}
function compareFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): DefinitionFieldComparison[] {
  return Object.keys(before).map((label) => ({
    label,
    before: display(before[label]),
    after: display(after[label]),
  }));
}
function sectionFields(
  section: WorkItemTypeSectionDefinition | undefined,
): Record<string, unknown> {
  return {
    Label: section?.label,
    Kind: section ? (section.kind ?? "markdown") : undefined,
    "Section writing standard": section?.writingStandard ?? "",
    "Schema reference": section?.schemaRef ?? "",
    Required: section ? (section.required ?? true) : undefined,
  };
}
function definitionFields(
  d: WorkItemTypeDefinitionDto,
): Record<string, unknown> {
  return {
    Key: d.key,
    Name: d.name,
    Role: d.role,
    Icon: d.iconKey,
    Color: d.colorKey,
    Purpose: d.description ?? "",
    "Semantic guidance": d.agentGuidance && {
      ...d.agentGuidance,
      ...(d.agentGuidance.contexts === undefined
        ? {}
        : {
            contexts: d.agentGuidance.contexts.map((context) => ({
              ...context,
              // Focal types are membership, not priority. Normalize only for review;
              // keep the submitted definition and all example/context order intact.
              focalTypeKeys: [...context.focalTypeKeys].sort(),
            })),
          }),
    },
    "Maintenance guidance": d.maintenanceGuidance ?? "",
    "Required scalars": d.requiredScalars ?? [],
    "Forbidden scalars": d.forbiddenScalars ?? [],
    "Allowed statuses": d.allowedStatuses,
    "Allowed parent types": d.allowedParentTypes ?? [],
    "Edge targets": d.edgeTargets ?? [],
    "Allowed parent entity types": d.allowedParentEntityTypes ?? [],
    "Tracking source entity types": d.tracking?.allowedSourceEntityTypes ?? [],
    "Tracking source task types": d.tracking?.allowedSourceTaskTypes ?? [],
    "Agent-settable statuses": d.agentSettableStatuses ?? [],
    "Anchorable report types": d.anchorableReportTypes ?? [],
    "Writing standard — Create": d.writingStandards?.create ?? "",
    "Writing standard — Edit": d.writingStandards?.edit ?? "",
    Capabilities: {
      requiresParent: false,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: false,
      ...d.capabilities,
    },
  };
}
function indexSections(
  sections: WorkItemTypeSectionDefinition[],
): Map<string, WorkItemTypeSectionDefinition> {
  const result = new Map<string, WorkItemTypeSectionDefinition>();
  for (const section of sections) {
    if (!section.key || !section.label || result.has(section.key))
      throw new Error("Invalid section identity");
    result.set(section.key, section);
  }
  return result;
}
function pairSections(
  before: ReadonlyMap<string, WorkItemTypeSectionDefinition>,
  after: ReadonlyMap<string, WorkItemTypeSectionDefinition>,
): SectionDeclarationComparison[] {
  const keys = [
    ...after.keys(),
    ...[...before.keys()].filter((key) => !after.has(key)),
  ];
  return keys.map((key): SectionDeclarationComparison => {
    const oldSection = before.get(key);
    const newSection = after.get(key);
    const fields = compareFields(
      sectionFields(oldSection),
      sectionFields(newSection),
    );
    return {
      key,
      label: (newSection ?? oldSection)!.label,
      fields,
      change: !oldSection
        ? "added"
        : !newSection
          ? "removed"
          : fields.some((f) => f.before !== f.after)
            ? "modified"
            : "unchanged",
    };
  });
}

function compareSectionOrder(
  current: WorkItemTypeDefinitionDto,
  proposed: WorkItemTypeDefinitionDto,
  before: ReadonlyMap<string, WorkItemTypeSectionDefinition>,
  after: ReadonlyMap<string, WorkItemTypeSectionDefinition>,
): DefinitionFieldComparison | null {
  const retainedBefore = [...before.keys()].filter((key) => after.has(key));
  const retainedAfter = [...after.keys()].filter((key) => before.has(key));
  const reordered = retainedBefore.some(
    (key, index) => key !== retainedAfter[index],
  );
  return reordered
    ? {
        label: "Section order",
        before: current.sections.map((s) => s.label).join("\n"),
        after: proposed.sections.map((s) => s.label).join("\n"),
      }
    : null;
}

export function compareWorkItemTypeDefinitions(
  current: WorkItemTypeDefinitionDto,
  proposed: WorkItemTypeDefinitionDto,
): WorkItemTypeDefinitionComparison {
  if (current.key !== proposed.key) throw new Error("Type identity changed");
  const before = indexSections(current.sections);
  const after = indexSections(proposed.sections);
  return {
    fields: compareFields(
      definitionFields(current),
      definitionFields(proposed),
    ).filter((f) => f.before !== f.after),
    sections: pairSections(before, after),
    order: compareSectionOrder(current, proposed, before, after),
  };
}
