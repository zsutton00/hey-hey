import type { WorkItemTypeDefinitionDto } from "../api";

export type ComparisonStatus = "unchanged" | "changed" | "added" | "removed";

/** The named subtabs the type form groups definition axes into. */
export type ComparisonGroupId =
  | "Overview"
  | "Content"
  | "Lifecycle"
  | "Relationships"
  | "Capabilities"
  | "Agent guidance";

export interface ComparisonEntry {
  id: string;
  label: string;
  status: ComparisonStatus;
  /** Project value as display text, one value per line; undefined when absent. */
  project: string | undefined;
  /** Canonical value as display text, one value per line; undefined when absent. */
  canonical: string | undefined;
  /** Prose fields get a line-level diff; short values are shown side by side. */
  longText: boolean;
}

export interface ComparisonGroup {
  id: ComparisonGroupId;
  entries: ComparisonEntry[];
  changedCount: number;
}

export interface DefinitionComparison {
  groups: ComparisonGroup[];
  hasDifferences: boolean;
}

export type FieldLabeler = (field: string) => string;

function isAbsent(value: string | undefined): boolean {
  return value === undefined || value === "";
}

function entry(
  id: string,
  label: string,
  project: string | undefined,
  canonical: string | undefined,
  longText = false,
): ComparisonEntry {
  const projectValue = isAbsent(project) ? undefined : project;
  const canonicalValue = isAbsent(canonical) ? undefined : canonical;
  let status: ComparisonStatus = "unchanged";
  if (projectValue !== canonicalValue) {
    if (canonicalValue === undefined) {
      status = "added";
    } else if (projectValue === undefined) {
      status = "removed";
    } else {
      status = "changed";
    }
  }

  return {
    id,
    label,
    status,
    project: projectValue,
    canonical: canonicalValue,
    longText,
  };
}

function scalarText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

/** Order-insensitive list: values are compared as a set. */
function setText(values: readonly string[] | undefined): string | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  return [...new Set(values)].sort().join("\n");
}

function orderedText(
  values: readonly string[] | undefined,
): string | undefined {
  return values && values.length > 0 ? values.join("\n") : undefined;
}

function keysOf(
  project: Record<string, unknown> | undefined,
  canonical: Record<string, unknown> | undefined,
): string[] {
  return [
    ...new Set([
      ...Object.keys(project ?? {}),
      ...Object.keys(canonical ?? {}),
    ]),
  ];
}

function sectionSettings(
  section: WorkItemTypeDefinitionDto["sections"][number] | undefined,
): string | undefined {
  if (!section) {
    return undefined;
  }

  const { key: _key, writingStandard: _writingStandard, ...settings } = section;
  return Object.entries(settings)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(
      ([name, value]) =>
        `${name}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    )
    .sort()
    .join("\n");
}

function overviewEntries(
  p: WorkItemTypeDefinitionDto,
  c: WorkItemTypeDefinitionDto,
  label: FieldLabeler,
): ComparisonEntry[] {
  return [
    entry("name", label("name"), scalarText(p.name), scalarText(c.name)),
    entry("role", label("role"), scalarText(p.role), scalarText(c.role)),
    entry("iconKey", "Icon", scalarText(p.iconKey), scalarText(c.iconKey)),
    entry("colorKey", "Color", scalarText(p.colorKey), scalarText(c.colorKey)),
    entry(
      "description",
      label("description"),
      scalarText(p.description),
      scalarText(c.description),
      true,
    ),
    entry(
      "acceptedConfigKinds",
      "Accepted launch configuration",
      setText(p.acceptedConfigKinds),
      setText(c.acceptedConfigKinds),
    ),
  ];
}

/** Sections are matched by key so reordering or one addition stays local. */
function contentEntries(
  p: WorkItemTypeDefinitionDto,
  c: WorkItemTypeDefinitionDto,
  label: FieldLabeler,
): ComparisonEntry[] {
  const projectSections = new Map(p.sections.map((s) => [s.key, s]));
  const canonicalSections = new Map(c.sections.map((s) => [s.key, s]));
  const keys = [
    ...new Set([...projectSections.keys(), ...canonicalSections.keys()]),
  ];
  const entries: ComparisonEntry[] = [
    entry(
      "sections.order",
      "Section order",
      orderedText(p.sections.map((s) => s.key)),
      orderedText(c.sections.map((s) => s.key)),
    ),
  ];

  for (const key of keys) {
    const ps = projectSections.get(key);
    const cs = canonicalSections.get(key);
    entries.push(
      entry(
        `sections.${key}.label`,
        `${key} — ${label("sections.label")}`,
        scalarText(ps?.label),
        scalarText(cs?.label),
      ),
      entry(
        `sections.${key}.settings`,
        `${key} — Settings`,
        sectionSettings(ps),
        sectionSettings(cs),
      ),
      entry(
        `sections.${key}.writingStandard`,
        `${key} — ${label("sections.writingStandard")}`,
        scalarText(ps?.writingStandard),
        scalarText(cs?.writingStandard),
        true,
      ),
    );
  }

  return entries;
}

function lifecycleEntries(
  p: WorkItemTypeDefinitionDto,
  c: WorkItemTypeDefinitionDto,
  label: FieldLabeler,
): ComparisonEntry[] {
  const entries: ComparisonEntry[] = [
    entry(
      "allowedStatuses",
      label("allowedStatuses"),
      setText(p.allowedStatuses),
      setText(c.allowedStatuses),
    ),
  ];
  const statusOrder = entry(
    "allowedStatuses.order",
    "Status order",
    orderedText(p.allowedStatuses),
    orderedText(c.allowedStatuses),
  );
  // Order is only worth a separate entry when the set of statuses is the same.
  if (entries[0].status === "unchanged") {
    entries.push(statusOrder);
  }

  entries.push(
    entry(
      "agentSettableStatuses",
      label("agentSettableStatuses"),
      setText(p.agentSettableStatuses),
      setText(c.agentSettableStatuses),
    ),
    entry(
      "requiredScalars",
      label("requiredScalars"),
      setText(p.requiredScalars),
      setText(c.requiredScalars),
    ),
    entry(
      "forbiddenScalars",
      label("forbiddenScalars"),
      setText(p.forbiddenScalars),
      setText(c.forbiddenScalars),
    ),
    entry(
      "allowedParentTypes",
      label("allowedParentTypes"),
      setText(p.allowedParentTypes),
      setText(c.allowedParentTypes),
    ),
    entry(
      "allowedParentEntityTypes",
      label("allowedParentEntityTypes"),
      setText(p.allowedParentEntityTypes),
      setText(c.allowedParentEntityTypes),
    ),
  );

  return entries;
}

/** Links are matched by relationship type. */
function relationshipEntries(
  p: WorkItemTypeDefinitionDto,
  c: WorkItemTypeDefinitionDto,
  label: FieldLabeler,
): ComparisonEntry[] {
  const projectEdges = new Map(
    (p.edgeTargets ?? []).map((e) => [e.edgeType, e.targetTypeKeys]),
  );
  const canonicalEdges = new Map(
    (c.edgeTargets ?? []).map((e) => [e.edgeType, e.targetTypeKeys]),
  );
  const edgeTypes = [
    ...new Set([...projectEdges.keys(), ...canonicalEdges.keys()]),
  ];
  const entries = edgeTypes.map((edgeType) => {
    const render = (targets: readonly string[] | undefined) =>
      targets === undefined
        ? undefined
        : targets.length === 0
          ? "Any type"
          : setText(targets);
    return entry(
      `edgeTargets.${edgeType}`,
      `${label("edgeTargets")} — ${edgeType}`,
      render(projectEdges.get(edgeType)),
      render(canonicalEdges.get(edgeType)),
    );
  });

  entries.push(
    entry(
      "tracking.allowedSourceEntityTypes",
      `${label("tracking")} — source entity kinds`,
      setText(p.tracking?.allowedSourceEntityTypes),
      setText(c.tracking?.allowedSourceEntityTypes),
    ),
    entry(
      "tracking.allowedSourceTaskTypes",
      label("tracking.allowedSourceTaskTypes"),
      setText(p.tracking?.allowedSourceTaskTypes),
      setText(c.tracking?.allowedSourceTaskTypes),
    ),
    entry(
      "anchorableReportTypes",
      label("anchorableReportTypes"),
      setText(p.anchorableReportTypes),
      setText(c.anchorableReportTypes),
    ),
  );

  return entries;
}

function capabilityEntries(
  p: WorkItemTypeDefinitionDto,
  c: WorkItemTypeDefinitionDto,
  formatCapability: (key: string) => string,
): ComparisonEntry[] {
  const projectCaps = (p.capabilities ?? {}) as Record<string, unknown>;
  const canonicalCaps = (c.capabilities ?? {}) as Record<string, unknown>;

  return keysOf(projectCaps, canonicalCaps).map((key) =>
    entry(
      `capabilities.${key}`,
      formatCapability(key),
      scalarText(projectCaps[key]),
      scalarText(canonicalCaps[key]),
    ),
  );
}

function guidanceEntries(
  p: WorkItemTypeDefinitionDto,
  c: WorkItemTypeDefinitionDto,
  label: FieldLabeler,
): ComparisonEntry[] {
  const projectRoles = (p.sessionRoleGuidance ?? {}) as Record<string, string>;
  const canonicalRoles = (c.sessionRoleGuidance ?? {}) as Record<
    string,
    string
  >;
  const roleEntries = keysOf(projectRoles, canonicalRoles).map((role) =>
    entry(
      `sessionRoleGuidance.${role}`,
      `${label("sessionRoleGuidance")} — ${role}`,
      projectRoles[role],
      canonicalRoles[role],
      true,
    ),
  );

  return [
    entry(
      "writingStandards.create",
      label("writingStandards.create"),
      p.writingStandards?.create,
      c.writingStandards?.create,
      true,
    ),
    entry(
      "writingStandards.edit",
      label("writingStandards.edit"),
      p.writingStandards?.edit,
      c.writingStandards?.edit,
      true,
    ),
    entry(
      "maintenanceGuidance",
      label("maintenanceGuidance"),
      p.maintenanceGuidance,
      c.maintenanceGuidance,
      true,
    ),
    ...roleEntries,
  ];
}

/**
 * Compares a project's definition with the current canonical definition, field
 * by field, grouped like the type form's subtabs. Keyed collections (sections,
 * links, capabilities, guidance roles) match by key and unordered lists compare
 * as sets, so reordering or a single addition never marks a whole list changed.
 * Read-only: neither definition is modified or merged.
 */
export function compareWorkItemTypeDefinitions(
  project: WorkItemTypeDefinitionDto,
  canonical: WorkItemTypeDefinitionDto,
  label: FieldLabeler,
  formatCapability: (key: string) => string,
): DefinitionComparison {
  const entriesByGroup: Array<[ComparisonGroupId, ComparisonEntry[]]> = [
    ["Overview", overviewEntries(project, canonical, label)],
    ["Content", contentEntries(project, canonical, label)],
    ["Lifecycle", lifecycleEntries(project, canonical, label)],
    ["Relationships", relationshipEntries(project, canonical, label)],
    ["Capabilities", capabilityEntries(project, canonical, formatCapability)],
    ["Agent guidance", guidanceEntries(project, canonical, label)],
  ];
  const groups = entriesByGroup.map(([id, entries]) => ({
    id,
    entries,
    changedCount: entries.filter((e) => e.status !== "unchanged").length,
  }));

  return {
    groups,
    hasDifferences: groups.some((group) => group.changedCount > 0),
  };
}
