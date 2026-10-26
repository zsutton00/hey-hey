import isEqual from "lodash/isEqual.js";
import type {
  FeatureRequirementRecord,
  ProposalReconciliationState,
} from "../../api";
import { readFeatureRequirementsSection } from "../../utils/featureRequirementsSection";
import { serializeFeatureRequirementsSection } from "../../utils/featureRequirementsEditing";
import {
  isContentRecord,
  threeWayFields,
  threeWayValue,
  equivalentContent,
  type ThreeWayProjection,
} from "./threeWayProjection";

export interface ResolutionItem {
  path: string;
  requirementId?: string;
  current: unknown;
  proposed: unknown;
}
export function records(
  value: unknown,
): readonly FeatureRequirementRecord[] | undefined {
  const parsed = readFeatureRequirementsSection(value);
  return parsed.status === "valid" || parsed.status === "valid-empty"
    ? parsed.records
    : parsed.status === "absent"
      ? []
      : undefined;
}
/** Pending corrections can retain reconciliation status without detailed overlap entries. */
export function resolutionConflictPaths(
  projection: ThreeWayProjection,
  state: Pick<
    ProposalReconciliationState,
    "overlaps" | "conflictingPaths" | "status"
  >,
): string[] {
  const paths = [
    ...new Set([
      ...state.conflictingPaths,
      ...state.overlaps.map((overlap) => overlap.path),
    ]),
  ];
  if (
    paths.length ||
    !["RECONCILIATION_REQUIRED", "AGENT_FIX_REQUIRED"].includes(state.status)
  )
    return paths;
  // Keep changed live content available for an explicit choice; this does not classify
  // new conflicts or alter API-owned application eligibility.
  return threeWayFields(projection).filter(
    (path) =>
      !equivalentContent(
        threeWayValue(projection.original, path),
        threeWayValue(projection.live, path),
      ),
  );
}
export function resolutionItems(
  projection: ThreeWayProjection,
  conflicts: readonly string[] = [],
): ResolutionItem[] {
  return threeWayFields(projection).flatMap((path): ResolutionItem[] => {
    if (
      (projection.live?.type ?? projection.intended?.type) === "FEATURE" &&
      ["priority", "assigneeId", "dueDate", "status"].includes(path)
    )
      return [];
    const original = threeWayValue(projection.original, path);
    const current = threeWayValue(projection.live, path);
    const proposed = threeWayValue(projection.intended, path);
    if (path === "sections.requirements") {
      const before = records(original),
        now = records(current),
        after = records(proposed);
      if (before && now && after) {
        const ids = new Set([...before, ...after].map((record) => record.id));
        return [...ids]
          .filter(
            (id) =>
              !isEqual(
                before.find((r) => r.id === id),
                after.find((r) => r.id === id),
              ) ||
              (conflicts.some((conflict) => conflict.startsWith(path)) &&
                !isEqual(
                  before.find((r) => r.id === id),
                  now.find((r) => r.id === id),
                )),
          )
          .map((id) => ({
            path,
            requirementId: id,
            current: now.find((r) => r.id === id),
            proposed: after.find((r) => r.id === id),
          }));
      }
    }
    return isEqual(original, proposed) &&
      !conflicts.some(
        (conflict) => conflict === path || conflict.startsWith(`${path}.`),
      )
      ? []
      : [{ path, current, proposed }];
  });
}
export function writeResolution(
  result: Record<string, unknown>,
  item: ResolutionItem,
  value: unknown,
): Record<string, unknown> {
  if (!item.path.startsWith("sections.")) {
    const next = { ...result };
    if (value === undefined) delete next[item.path];
    else next[item.path] = value;
    return next;
  }
  const key = item.path.slice(9);
  const existing = Array.isArray(result.sections)
    ? result.sections.find((s) => isContentRecord(s) && s.key === key)
        ?.materializedMarkdown
    : isContentRecord(result.sections)
      ? result.sections[key]
      : undefined;
  let content = value;
  if (item.requirementId) {
    const all = records(existing) ?? [];
    const replacement = records({ records: value ? [value] : [] });
    if (!replacement) return result;
    const next = all.flatMap((record) =>
      record.id === item.requirementId ? replacement : [record],
    );
    if (!all.some((record) => record.id === item.requirementId))
      next.push(...replacement);
    content = serializeFeatureRequirementsSection(next);
  }
  if (Array.isArray(result.sections)) {
    const sections = result.sections
      .filter(
        (s) => !(isContentRecord(s) && s.key === key && content === undefined),
      )
      .map((s) =>
        isContentRecord(s) && s.key === key
          ? {
              ...s,
              materializedMarkdown:
                typeof content === "string" ? content : JSON.stringify(content),
            }
          : s,
      );
    if (
      content !== undefined &&
      !sections.some((s) => isContentRecord(s) && s.key === key)
    ) {
      sections.push({
        key,
        materializedMarkdown:
          typeof content === "string" ? content : JSON.stringify(content),
      });
    }
    return { ...result, sections };
  }
  const sections = {
    ...(isContentRecord(result.sections) ? result.sections : {}),
  };
  if (content === undefined) delete sections[key];
  else sections[key] = content;
  return { ...result, sections };
}

/** Keep live-only requirement edits even when another row in the section conflicts. */
export function preserveUnaffectedRequirements(
  result: Record<string, unknown>,
  projection: ThreeWayProjection,
): Record<string, unknown> {
  const path = "sections.requirements";
  const before = records(threeWayValue(projection.original, path));
  const current = records(threeWayValue(projection.live, path));
  const proposed = records(threeWayValue(projection.intended, path));
  if (!before || !current || !proposed) return result;
  let next = result;
  for (const id of new Set(
    [...before, ...current].map((record) => record.id),
  )) {
    const original = before.find((record) => record.id === id);
    const intended = proposed.find((record) => record.id === id);
    if (isEqual(original, intended))
      next = writeResolution(
        next,
        { path, requirementId: id, current: undefined, proposed: undefined },
        current.find((record) => record.id === id),
      );
  }
  return next;
}
