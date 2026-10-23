import type { ReportDto } from "../../../api";

type QueryValue =
  | boolean
  | number
  | string
  | null
  | QueryValue[]
  | { [key: string]: QueryValue };

export interface EvidencePipelineReportEvidenceItemSummary {
  entityId: string;
  entityType: string;
  score?: number;
  source?: "semantic_search" | "unified_search";
  hintType?: string;
}

export interface EvidencePipelineReportSearchStep {
  query: QueryValue;
  why: string;
  queryPerspective: string;
  tool: string;
}

export interface EvidencePipelineReportSearchResult {
  query: QueryValue;
  why: string;
  queryPerspective: string;
  fromCache: boolean;
  evidenceItems: EvidencePipelineReportEvidenceItemSummary[];
}

export interface EvidencePipelineReportPlannerInput {
  messageCount: number;
  optionKeys: string[];
  maxRounds: number;
  scaffoldedQaAnswerFocus: boolean;
}

export interface EvidencePipelineReportExecution {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  totalSearchSteps: number;
  cachedStepCount: number;
  uncachedStepCount: number;
  errorCount: number;
}

export interface EvidencePipelineReportPayload {
  plannerInput: EvidencePipelineReportPlannerInput;
  searchSteps: EvidencePipelineReportSearchStep[];
  searchResults: EvidencePipelineReportSearchResult[];
  selectedEvidenceKeys: string[];
  excludedEvidenceKeys: string[];
  hydratedEvidenceKeys: string[];
  implementationHintSearchEnabled: boolean;
  implementationHintSearchServiceId?: string;
  implementationHintSearchSteps: EvidencePipelineReportSearchStep[];
  implementationHintSearchResults: EvidencePipelineReportSearchResult[];
  implementationHints: EvidencePipelineReportEvidenceItemSummary[];
  finalEvidence: EvidencePipelineReportEvidenceItemSummary[];
  execution: EvidencePipelineReportExecution;
}

export interface EvidenceItemGroup {
  entityType: string;
  items: EvidencePipelineReportEvidenceItemSummary[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isQueryValue = (value: unknown): value is QueryValue => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isQueryValue(item));
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((item) => isQueryValue(item));
};

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const readStringArray = (value: unknown): string[] | null => {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return null;
  }

  return value;
};

const parseEvidenceItemSummary = (
  value: unknown
): EvidencePipelineReportEvidenceItemSummary | null => {
  if (!isRecord(value)) {
    return null;
  }

  const entityId = readString(value.entityId);
  const entityType = readString(value.entityType);
  if (!entityId || !entityType) {
    return null;
  }

  const score = readNumber(value.score) ?? undefined;
  const sourceValue = readString(value.source);
  const source =
    sourceValue === "semantic_search" || sourceValue === "unified_search"
      ? sourceValue
      : undefined;
  const hintType =
    readString(value.hint_type) ?? readString(value.hintType) ?? undefined;

  return {
    entityId,
    entityType,
    score,
    source,
    hintType,
  };
};

const parseSearchStep = (
  value: unknown
): EvidencePipelineReportSearchStep | null => {
  if (!isRecord(value)) {
    return null;
  }

  const query = value.query;
  const why = readString(value.why);
  const queryPerspective = readString(value.queryPerspective);
  const tool = readString(value.tool);

  if (!isQueryValue(query) || !why || !queryPerspective || !tool) {
    return null;
  }

  return {
    query,
    why,
    queryPerspective,
    tool,
  };
};

const parseEvidenceItemArray = (
  value: unknown
): EvidencePipelineReportEvidenceItemSummary[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value
    .map((item) => parseEvidenceItemSummary(item))
    .filter(
      (item): item is EvidencePipelineReportEvidenceItemSummary => item !== null
    );

  return items.length === value.length ? items : null;
};

const parseSearchResult = (
  value: unknown
): EvidencePipelineReportSearchResult | null => {
  if (!isRecord(value)) {
    return null;
  }

  const query = value.query;
  const why = readString(value.why);
  const queryPerspective = readString(value.queryPerspective);
  const fromCache = readBoolean(value.fromCache);
  const evidenceItems = parseEvidenceItemArray(value.evidenceItems);

  if (
    !isQueryValue(query) ||
    !why ||
    !queryPerspective ||
    fromCache === null ||
    evidenceItems === null
  ) {
    return null;
  }

  return {
    query,
    why,
    queryPerspective,
    fromCache,
    evidenceItems,
  };
};

const parseSearchResultArray = (
  value: unknown
): EvidencePipelineReportSearchResult[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value
    .map((item) => parseSearchResult(item))
    .filter(
      (item): item is EvidencePipelineReportSearchResult => item !== null
    );

  return items.length === value.length ? items : null;
};

const parseSearchStepArray = (
  value: unknown
): EvidencePipelineReportSearchStep[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value
    .map((item) => parseSearchStep(item))
    .filter((item): item is EvidencePipelineReportSearchStep => item !== null);

  return items.length === value.length ? items : null;
};

const parsePlannerInput = (
  value: unknown
): EvidencePipelineReportPlannerInput | null => {
  if (!isRecord(value)) {
    return null;
  }

  const messageCount = readNumber(value.messageCount);
  const optionKeys = readStringArray(value.optionKeys);
  const maxRounds = readNumber(value.maxRounds);
  const scaffoldedQaAnswerFocus = readBoolean(value.scaffoldedQaAnswerFocus);

  if (
    messageCount === null ||
    optionKeys === null ||
    maxRounds === null ||
    scaffoldedQaAnswerFocus === null
  ) {
    return null;
  }

  return {
    messageCount,
    optionKeys,
    maxRounds,
    scaffoldedQaAnswerFocus,
  };
};

const parseExecution = (
  value: unknown
): EvidencePipelineReportExecution | null => {
  if (!isRecord(value)) {
    return null;
  }

  const startedAt = readString(value.startedAt);
  const completedAt = readString(value.completedAt);
  const durationMs = readNumber(value.durationMs);
  const totalSearchSteps = readNumber(value.totalSearchSteps);
  const cachedStepCount = readNumber(value.cachedStepCount);
  const uncachedStepCount = readNumber(value.uncachedStepCount);
  const errorCount = readNumber(value.errorCount);

  if (
    !startedAt ||
    !completedAt ||
    durationMs === null ||
    totalSearchSteps === null ||
    cachedStepCount === null ||
    uncachedStepCount === null ||
    errorCount === null
  ) {
    return null;
  }

  return {
    startedAt,
    completedAt,
    durationMs,
    totalSearchSteps,
    cachedStepCount,
    uncachedStepCount,
    errorCount,
  };
};

export const parseEvidencePipelineReportPayload = (
  payload: ReportDto["payload"]
): EvidencePipelineReportPayload | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const plannerInput = parsePlannerInput(payload.plannerInput);
  const searchSteps = parseSearchStepArray(payload.searchSteps);
  const searchResults = parseSearchResultArray(payload.searchResults);
  const selectedEvidenceKeys = readStringArray(payload.selectedEvidenceKeys);
  const excludedEvidenceKeys = readStringArray(payload.excludedEvidenceKeys);
  const hydratedEvidenceKeys = readStringArray(payload.hydratedEvidenceKeys);
  const implementationHintSearchEnabled =
    readBoolean(payload.implementationHintSearchEnabled) ?? false;
  const implementationHintSearchServiceId =
    readString(payload.implementationHintSearchServiceId) ?? undefined;
  const implementationHintSearchSteps =
    parseSearchStepArray(payload.implementationHintSearchSteps) ?? [];
  const implementationHintSearchResults =
    parseSearchResultArray(payload.implementationHintSearchResults) ?? [];
  const implementationHints = parseEvidenceItemArray(
    payload.implementationHints
  );
  const finalEvidence = parseEvidenceItemArray(payload.finalEvidence);
  const execution = parseExecution(payload.execution);

  if (
    plannerInput === null ||
    searchSteps === null ||
    searchResults === null ||
    selectedEvidenceKeys === null ||
    excludedEvidenceKeys === null ||
    hydratedEvidenceKeys === null ||
    implementationHints === null ||
    finalEvidence === null ||
    execution === null
  ) {
    return null;
  }

  return {
    plannerInput,
    searchSteps,
    searchResults,
    selectedEvidenceKeys,
    excludedEvidenceKeys,
    hydratedEvidenceKeys,
    implementationHintSearchEnabled,
    implementationHintSearchServiceId,
    implementationHintSearchSteps,
    implementationHintSearchResults,
    implementationHints,
    finalEvidence,
    execution,
  };
};

export const formatEntityTypeLabel = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    return "Unknown type";
  }

  const words = normalized
    .toLowerCase()
    .split("_")
    .filter((word) => word.length > 0);

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export const formatQueryValue = (value: QueryValue): string => {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
};

export const formatSearchStepTitle = (
  query: EvidencePipelineReportSearchResult["query"],
  index: number
): string => {
  const formattedQuery = formatQueryValue(query).trim();
  return formattedQuery.length > 0
    ? formattedQuery
    : `Search step ${index + 1}`;
};

export const groupEvidenceItemsByEntityType = (
  items: EvidencePipelineReportEvidenceItemSummary[]
): EvidenceItemGroup[] => {
  const groups = new Map<string, EvidencePipelineReportEvidenceItemSummary[]>();

  items.forEach((item) => {
    const groupItems = groups.get(item.entityType);
    if (groupItems) {
      groupItems.push(item);
      return;
    }

    groups.set(item.entityType, [item]);
  });

  return Array.from(groups.entries()).map(([entityType, groupItems]) => ({
    entityType,
    items: groupItems,
  }));
};
