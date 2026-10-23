import type {
  FeatureRequirementRecord,
  FeatureRequirementStoredCitation,
  FeatureRequirementsSection,
  MaterializedWorkItemSection,
  WorkItemTypeSectionDefinition,
} from "../api";

export const FEATURE_REQUIREMENTS_SECTION_KEY = "requirements" as const;
export const FEATURE_REQUIREMENTS_SCHEMA_REF =
  "#/components/schemas/FeatureRequirementsSection" as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUP_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 -]*[A-Za-z0-9])?$/;

type SectionDefinitionShape = Pick<
  WorkItemTypeSectionDefinition,
  "key" | "kind" | "schemaRef"
>;

// Persisted citations carry the cited entity's title, captured when the
// requirements were written, so records render without name lookups.
export type FeatureRequirementCitationWithName =
  FeatureRequirementStoredCitation;

export type FeatureRequirementRecordWithNames = FeatureRequirementRecord;

export type FeatureRequirementsSectionWithNames = FeatureRequirementsSection;

export type FeatureRequirementsSectionState =
  | { status: "absent" }
  | {
      status: "valid-empty";
      value: FeatureRequirementsSectionWithNames;
      records: readonly [];
    }
  | {
      status: "valid";
      value: FeatureRequirementsSectionWithNames;
      records: readonly FeatureRequirementRecordWithNames[];
    }
  | {
      status: "invalid";
      reason: string;
      issues: readonly string[];
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean => Object.keys(value).every((key) => allowedKeys.includes(key));

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

const isGroup = (value: unknown): value is string =>
  typeof value === "string" && GROUP_PATTERN.test(value);

const isCitation = (
  value: unknown,
): value is FeatureRequirementStoredCitation =>
  isRecord(value) &&
  hasOnlyKeys(value, ["entityType", "entityId", "entityTitle"]) &&
  typeof value.entityType === "string" &&
  isUuid(value.entityId) &&
  typeof value.entityTitle === "string";

const readCitationArray = (
  value: unknown,
  path: string,
): { value: FeatureRequirementStoredCitation[]; issues: string[] } => {
  if (!Array.isArray(value)) {
    return { value: [], issues: [`${path} must be an array`] };
  }

  const issues: string[] = [];
  const citations: FeatureRequirementStoredCitation[] = [];
  value.forEach((candidate, index) => {
    if (!isCitation(candidate)) {
      issues.push(
        `${path}[${index}] must contain an entityType, UUID entityId and entityTitle`,
      );
      return;
    }
    citations.push(candidate);
  });
  return { value: citations, issues };
};

const readRecord = (
  value: unknown,
  index: number,
): { value?: FeatureRequirementRecordWithNames; issues: string[] } => {
  const path = `records[${index}]`;
  if (!isRecord(value)) {
    return { issues: [`${path} must be an object`] };
  }
  if (
    !hasOnlyKeys(value, [
      "id",
      "statement",
      "group",
      "designedBy",
      "fulfilledBy",
      "contracts",
    ])
  ) {
    return { issues: [`${path} contains an unsupported field`] };
  }

  const issues: string[] = [];
  if (!isUuid(value.id)) issues.push(`${path}.id must be a UUID`);
  if (typeof value.statement !== "string") {
    issues.push(`${path}.statement must be a string`);
  }
  if (value.group !== undefined && !isGroup(value.group)) {
    issues.push(`${path}.group must be a valid group label`);
  }

  const designedBy = readCitationArray(value.designedBy, `${path}.designedBy`);
  const fulfilledBy = readCitationArray(
    value.fulfilledBy,
    `${path}.fulfilledBy`,
  );
  const contracts = readCitationArray(value.contracts, `${path}.contracts`);
  issues.push(...designedBy.issues, ...fulfilledBy.issues, ...contracts.issues);

  designedBy.value.forEach((citation, citationIndex) => {
    if (
      citation.entityType !== "DESIGN_DOC" &&
      citation.entityType !== "MOCKUP" &&
      citation.entityType !== "DIAGRAM"
    ) {
      issues.push(
        `${path}.designedBy[${citationIndex}].entityType must be DESIGN_DOC, MOCKUP, or DIAGRAM`,
      );
    }
  });
  contracts.value.forEach((citation, citationIndex) => {
    if (citation.entityType !== "CONTRACT") {
      issues.push(
        `${path}.contracts[${citationIndex}].entityType must be CONTRACT`,
      );
    }
  });
  fulfilledBy.value.forEach((citation, citationIndex) => {
    if (citation.entityType !== "TASK" && citation.entityType !== "PLAN") {
      issues.push(
        `${path}.fulfilledBy[${citationIndex}].entityType must be TASK or PLAN`,
      );
    }
  });

  if (issues.length > 0 || !isUuid(value.id) || typeof value.statement !== "string") {
    return { issues };
  }

  return {
    value: {
      id: value.id,
      statement: value.statement,
      ...(typeof value.group === "string" ? { group: value.group } : {}),
      designedBy: designedBy.value as FeatureRequirementRecordWithNames["designedBy"],
      fulfilledBy:
        fulfilledBy.value as FeatureRequirementRecordWithNames["fulfilledBy"],
      contracts: contracts.value as FeatureRequirementRecordWithNames["contracts"],
    },
    issues: [],
  };
};

const decodeJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

/** Validates a decoded or serialized FeatureRequirementsSection. */
export const readFeatureRequirementsSection = (
  input: unknown,
): FeatureRequirementsSectionState => {
  if (input === undefined || input === null) return { status: "absent" };

  const decoded = decodeJson(input);
  if (decoded === undefined) {
    return {
      status: "invalid",
      reason: "Requirements content is not valid JSON.",
      issues: ["Requirements content is not valid JSON."],
    };
  }
  if (!isRecord(decoded)) {
    return {
      status: "invalid",
      reason: "Requirements content must be an object.",
      issues: ["Requirements content must be an object."],
    };
  }
  if (!hasOnlyKeys(decoded, ["records"]) || !Array.isArray(decoded.records)) {
    return {
      status: "invalid",
      reason: "Requirements content must contain only a records array.",
      issues: ["Requirements content must contain only a records array."],
    };
  }

  const issues: string[] = [];
  const records: FeatureRequirementRecordWithNames[] = [];
  const ids = new Set<string>();
  decoded.records.forEach((candidate, index) => {
    const result = readRecord(candidate, index);
    issues.push(...result.issues);
    if (!result.value) return;
    if (ids.has(result.value.id)) {
      issues.push(`records[${index}].id duplicates another requirement UUID`);
      return;
    }
    ids.add(result.value.id);
    records.push(result.value);
  });

  if (issues.length > 0) {
    return {
      status: "invalid",
      reason: "Requirements content does not match the canonical schema.",
      issues,
    };
  }

  const section: FeatureRequirementsSectionWithNames = { records };
  return records.length === 0
    ? { status: "valid-empty", value: section, records: [] }
    : { status: "valid", value: section, records };
};

const FEATURE_REQUIREMENTS_SCHEMA_NAME = "FeatureRequirementsSection";

/**
 * Registry definitions may spell the component reference in several forms
 * (`#/components/schemas/X`, a file-relative `./tasks.yaml#/X`, or the bare
 * component name). Compare by the referenced component name so a spelling
 * difference never drops canonical records into the raw JSON fallback.
 */
const referencesFeatureRequirementsSchema = (
  schemaRef: string | null | undefined,
): boolean => {
  if (schemaRef === undefined || schemaRef === null || schemaRef === "") {
    return true;
  }
  const name = schemaRef.split(/[#/]/).filter(Boolean).pop();
  return name === FEATURE_REQUIREMENTS_SCHEMA_NAME;
};

export const isCanonicalFeatureRequirementsDefinition = (
  typeKey: string | null | undefined,
  definition: SectionDefinitionShape | undefined,
): boolean =>
  typeKey === "FEATURE" &&
  definition?.key === FEATURE_REQUIREMENTS_SECTION_KEY &&
  definition.kind === "json" &&
  referencesFeatureRequirementsSchema(definition.schemaRef);

export const adaptFeatureRequirementsSection = (input: {
  typeKey: string | null | undefined;
  definition: SectionDefinitionShape | undefined;
  value?: unknown;
  section?: MaterializedWorkItemSection | null;
}): FeatureRequirementsSectionState => {
  if (
    !isCanonicalFeatureRequirementsDefinition(input.typeKey, input.definition)
  ) {
    return {
      status: "invalid",
      reason: "The effective work-item definition is not the canonical FEATURE requirements schema.",
      issues: [
        "The effective work-item definition is not the canonical FEATURE requirements schema.",
      ],
    };
  }

  const value =
    input.value !== undefined
      ? input.value
      : input.section === undefined || input.section === null
      ? undefined
      : input.section.materializedMarkdown;
  return readFeatureRequirementsSection(value);
};

export const adaptFeatureRequirementsFromSections = (input: {
  typeKey: string | null | undefined;
  definition: SectionDefinitionShape | undefined;
  sections: readonly MaterializedWorkItemSection[] | undefined;
}): FeatureRequirementsSectionState =>
  adaptFeatureRequirementsSection({
    typeKey: input.typeKey,
    definition: input.definition,
    section: input.sections?.find(
      (section) => section.key === FEATURE_REQUIREMENTS_SECTION_KEY,
    ),
  });
