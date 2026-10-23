import { parseActivityHistoryFilter } from "@hey-hey/ui-common/components";
import type {
  CrossProjectActivityFilterParams,
  CrossProjectActivityMetricParams,
  CrossProjectActivityHistoryParams,
} from "@hey-hey/ui-common/data";
import type { ActivityMetricContinuationDto } from "@hey-hey/ui-common/api";
import {
  ActivityCorrelationActivityType,
  ActivityActorScopeMode,
  ActivityCorrelationMode,
  ActivityCorrelationSource,
  EntityType,
  ProjectMetricIdentity,
} from "@hey-hey/ui-common/api";

type OrganizationActivityQuery =
  | Omit<CrossProjectActivityFilterParams, "organizationId">
  | Omit<CrossProjectActivityMetricParams, "organizationId">
  | Omit<CrossProjectActivityHistoryParams, "organizationId">;

export type ParsedOrganizationActivityQuery =
  | {
      kind: "valid";
      query: OrganizationActivityQuery;
      viewScope?: "project" | "organization";
    }
  | { kind: "invalid"; message: string };

const readOptionalStringParam = (
  searchParams: URLSearchParams,
  key: string,
): string | undefined => {
  const value = searchParams.get(key);
  if (value === null) {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : undefined;
};

const parseEnumListParam = <T extends string>(
  searchParams: URLSearchParams,
  key: string,
  allowedValues: readonly T[],
): { value?: T[]; error?: string } => {
  const rawValues = searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (rawValues.length === 0) {
    return {};
  }

  const values: T[] = [];
  for (const rawValue of rawValues) {
    const matchingValue = allowedValues.find(
      (allowedValue) => allowedValue === rawValue,
    );
    if (matchingValue === undefined) {
      return { error: `Unsupported ${key} filter` };
    }
    if (!values.includes(matchingValue)) {
      values.push(matchingValue);
    }
  }

  return { value: values };
};

const parseOptionalBooleanParam = (
  searchParams: URLSearchParams,
  key: string,
): { value?: boolean; error?: string } => {
  const value = searchParams.get(key);
  if (value === null) {
    return {};
  }

  if (value === "true") {
    return { value: true };
  }
  if (value === "false") {
    return { value: false };
  }

  return { error: `Invalid ${key} filter` };
};

const parseOptionalNonNegativeIntegerParam = (
  searchParams: URLSearchParams,
  key: string,
  minimum: number,
): { value?: number; error?: string } => {
  const value = searchParams.get(key);
  if (value === null) {
    return {};
  }

  if (!/^\d+$/.test(value)) {
    return { error: `Invalid ${key} pagination value` };
  }

  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimum) {
    return { error: `Invalid ${key} pagination value` };
  }

  return { value: parsedValue };
};

export const parseOrganizationActivityQuery = (
  searchParams: URLSearchParams,
): ParsedOrganizationActivityQuery => {
  const supportedKeys = new Set([
    "viewScope",
    "historyFilter",
    "projectId",
    "userId",
    "entityType",
    "activityMode",
    "activityType",
    "source",
    "serviceId",
    "since",
    "until",
    "affectsMe",
    "sinceLastVisit",
    "metric",
    "projectIds",
    "windowStart",
    "windowEnd",
    "actorScope",
    "actorUserId",
    "limit",
    "offset",
  ]);
  const unsupportedKey = [...new Set(searchParams.keys())].find(
    (key) => !supportedKeys.has(key),
  );
  if (unsupportedKey) {
    return {
      kind: "invalid",
      message: `Unsupported Activity query parameter: ${unsupportedKey}`,
    };
  }
  const viewScope = searchParams.get("viewScope");
  if (
    viewScope !== null &&
    viewScope !== "project" &&
    viewScope !== "organization"
  ) {
    return { kind: "invalid", message: "Unsupported Activity view scope" };
  }
  const parsedViewScope: { viewScope?: "project" | "organization" } =
    viewScope === null ? {} : { viewScope };

  const metricKeys = [
    "metric",
    "projectIds",
    "windowStart",
    "windowEnd",
    "actorScope",
    "actorUserId",
  ];
  const hasMetricState = metricKeys.some((key) => searchParams.has(key));
  const limit = parseOptionalNonNegativeIntegerParam(searchParams, "limit", 1);
  const offset = parseOptionalNonNegativeIntegerParam(
    searchParams,
    "offset",
    0,
  );

  if (limit.error || offset.error) {
    return {
      kind: "invalid",
      message: limit.error ?? offset.error ?? "Invalid pagination",
    };
  }

  const historyJson = searchParams.get("historyFilter");
  if (historyJson !== null) {
    if (
      [...searchParams.keys()].some(
        (key) =>
          !["historyFilter", "limit", "offset", "viewScope"].includes(key),
      )
    ) {
      return {
        kind: "invalid",
        message: "History filters cannot be combined with other query modes",
      };
    }
    try {
      const historyFilter = parseActivityHistoryFilter(JSON.parse(historyJson));
      return {
        kind: "valid",
        query: { historyFilter, limit: limit.value, offset: offset.value },
        ...parsedViewScope,
      };
    } catch {
      return {
        kind: "invalid",
        message: "This history filter is incomplete or invalid",
      };
    }
  }

  if (hasMetricState) {
    const ordinaryFilterKeys = [
      "projectId",
      "userId",
      "entityType",
      "activityMode",
      "activityType",
      "source",
      "serviceId",
      "since",
      "until",
      "affectsMe",
      "sinceLastVisit",
    ];
    if (ordinaryFilterKeys.some((key) => searchParams.has(key))) {
      return {
        kind: "invalid",
        message: "Metric evidence links cannot also contain ordinary filters",
      };
    }

    const metric = searchParams.get("metric");
    const matchingMetric = Object.values(ProjectMetricIdentity).find(
      (candidate) => candidate === metric,
    );
    const rawProjectIds = searchParams
      .getAll("projectIds")
      .flatMap((value) => value.split(","));
    const projectIds = rawProjectIds.filter(
      (projectId) => projectId.length > 0,
    );
    const hasEmptyProjectId = rawProjectIds.some(
      (projectId) => projectId.length === 0,
    );
    const hasProjectIdsParam = searchParams.has("projectIds");
    const windowStart = searchParams.get("windowStart");
    const windowEnd = searchParams.get("windowEnd");
    const actorScope = searchParams.get("actorScope");
    const actorUserId = searchParams.get("actorUserId")?.trim();

    if (
      matchingMetric === undefined ||
      !hasProjectIdsParam ||
      windowStart === null ||
      windowStart.length === 0 ||
      windowEnd === null ||
      windowEnd.length === 0 ||
      (actorScope !== ActivityActorScopeMode.Organization &&
        actorScope !== ActivityActorScopeMode.Personal) ||
      (actorScope === ActivityActorScopeMode.Personal && !actorUserId) ||
      (actorScope === ActivityActorScopeMode.Organization &&
        actorUserId !== undefined) ||
      (actorScope === ActivityActorScopeMode.Personal &&
        matchingMetric?.startsWith("PROJECT_INFO_")) ||
      (hasEmptyProjectId && projectIds.length > 0)
    ) {
      return {
        kind: "invalid",
        message: "This metric evidence link is incomplete or invalid",
      };
    }

    const metricContinuation: ActivityMetricContinuationDto = {
      metric: matchingMetric,
      projectIds,
      windowStart,
      windowEnd,
      actorScope:
        actorScope === ActivityActorScopeMode.Personal
          ? { mode: "PERSONAL", userId: actorUserId as string }
          : { mode: "ORGANIZATION" },
    };

    return {
      kind: "valid",
      ...parsedViewScope,
      query: {
        metricContinuation,
        limit: limit.value,
        offset: offset.value,
      },
    };
  }

  const entityType = parseEnumListParam(
    searchParams,
    "entityType",
    Object.values(EntityType),
  );
  const activityMode = parseEnumListParam(
    searchParams,
    "activityMode",
    Object.values(ActivityCorrelationMode),
  );
  const activityType = parseEnumListParam(
    searchParams,
    "activityType",
    Object.values(ActivityCorrelationActivityType),
  );
  const source = parseEnumListParam(
    searchParams,
    "source",
    Object.values(ActivityCorrelationSource),
  );
  const affectsMe = parseOptionalBooleanParam(searchParams, "affectsMe");
  const sinceLastVisit = parseOptionalBooleanParam(
    searchParams,
    "sinceLastVisit",
  );
  const enumError =
    entityType.error ??
    activityMode.error ??
    activityType.error ??
    source.error ??
    affectsMe.error ??
    sinceLastVisit.error;

  if (enumError || (activityMode.value && activityMode.value.length > 1)) {
    return {
      kind: "invalid",
      message: enumError ?? "Only one activity mode can be selected",
    };
  }

  const query: Omit<CrossProjectActivityFilterParams, "organizationId"> = {
    projectId: readOptionalStringParam(searchParams, "projectId"),
    userId: readOptionalStringParam(searchParams, "userId"),
    entityType: entityType.value,
    activityMode: activityMode.value?.[0],
    activityType: activityType.value,
    source: source.value,
    serviceId: readOptionalStringParam(searchParams, "serviceId"),
    since: readOptionalStringParam(searchParams, "since"),
    until: readOptionalStringParam(searchParams, "until"),
    affectsMe: affectsMe.value,
    sinceLastVisit: sinceLastVisit.value,
    limit: limit.value,
    offset: offset.value,
  };

  return { kind: "valid", query, ...parsedViewScope };
};
