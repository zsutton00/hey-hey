import {
  AgentEdgeType,
  ProjectModeSelectionSchemaVersionEnum,
  WorkStatus,
} from "../../api";
import type { ProjectModeSelection, WorkItemTypeSummaryDto } from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { listSessionMethods } from "./sessionMethodRegistry";

export const PROJECT_MODE_TYPE_KEY = "MODE" as const;
export const PROJECT_MODE_DESCRIPTION_SECTION_KEY = "description" as const;
export const PROJECT_MODE_SETTINGS_SECTION_KEY = "settings" as const;

export interface ProjectModeCatalogEntry {
  selection: ProjectModeSelection;
  name: string;
  description: string;
}

export interface ProjectModeCatalogInput {
  projectId: string;
  effectiveWorkItemTypeKey: string | null;
  modeTypeSummary: WorkItemTypeSummaryDto | undefined;
  modeItems: readonly WorkItemResponseDto[];
  focalFeatureIds?: ReadonlySet<string> | null;
  reservedIdentities?: ReadonlySet<string>;
}

const isActiveMode = (mode: WorkItemResponseDto): boolean =>
  mode.type === PROJECT_MODE_TYPE_KEY &&
  mode.status === WorkStatus.Active &&
  (mode.archivedAt === undefined || mode.archivedAt === null);

const modeDescription = (mode: WorkItemResponseDto): string | null => {
  const descriptions = (
    Array.isArray(mode.sections) ? mode.sections : []
  ).filter((section) => section.key === PROJECT_MODE_DESCRIPTION_SECTION_KEY);
  if (descriptions.length !== 1) return null;
  const materializedMarkdown = descriptions[0]?.materializedMarkdown;
  const description =
    typeof materializedMarkdown === "string" ? materializedMarkdown.trim() : "";
  return description ? description : null;
};

const isActiveModeType = (
  modeTypeSummary: WorkItemTypeSummaryDto | undefined
): modeTypeSummary is WorkItemTypeSummaryDto =>
  modeTypeSummary !== undefined &&
  modeTypeSummary.status === "ACTIVE" &&
  modeTypeSummary.definition.key === PROJECT_MODE_TYPE_KEY;

/**
 * Reads the MODE's own eligible type list from its `settings` section.
 * Returns null when the MODE has no list (or the section is unreadable) so the
 * caller keeps the legacy type-level eligibility instead of widening access.
 */
export const readProjectModeEligibleWorkItemTypeKeys = (
  mode: WorkItemResponseDto
): string[] | null => {
  const content = (Array.isArray(mode.sections) ? mode.sections : []).find(
    (section) => section.key === PROJECT_MODE_SETTINGS_SECTION_KEY
  )?.materializedMarkdown;
  if (typeof content !== "string" || content.trim() === "") return null;
  try {
    const keys = (JSON.parse(content) as { eligibleWorkItemTypeKeys?: unknown })
      .eligibleWorkItemTypeKeys;
    return Array.isArray(keys) &&
      keys.every((key): key is string => typeof key === "string")
      ? keys
      : null;
  } catch {
    return null;
  }
};

/**
 * Shared per-MODE type predicate for the picker and the stale-selection
 * recheck. Mirrors the API's capture resolver: the MODE's own list wins, and
 * the shared MODE agent-guidance contexts apply only when the list is absent.
 */
const hasApplicableWorkItemType = (
  mode: WorkItemResponseDto,
  modeTypeSummary: WorkItemTypeSummaryDto,
  effectiveWorkItemTypeKey: string
): boolean => {
  const perMode = readProjectModeEligibleWorkItemTypeKeys(mode);
  if (perMode !== null) return perMode.includes(effectiveWorkItemTypeKey);
  return (modeTypeSummary.definition.agentGuidance?.contexts ?? []).some(
    (context) => context.focalTypeKeys.includes(effectiveWorkItemTypeKey)
  );
};

const hasApplicableFeature = (
  mode: WorkItemResponseDto,
  focalFeatureIds: ReadonlySet<string> | null | undefined
): boolean => {
  const featureDependencyIds = new Set(
    (mode.edges ?? [])
      .filter(
        (edge) =>
          edge.type === AgentEdgeType.DependsOn &&
          edge.sourceNodeId === mode.id &&
          edge.targetNodeType === "FEATURE"
      )
      .map((edge) => edge.targetNodeId)
  );
  return (
    featureDependencyIds.size === 0 ||
    (focalFeatureIds !== null &&
      focalFeatureIds !== undefined &&
      Array.from(featureDependencyIds).some((id) => focalFeatureIds.has(id)))
  );
};

const compareCatalogEntries = (
  left: ProjectModeCatalogEntry,
  right: ProjectModeCatalogEntry
): number => {
  const leftName = left.name.toLowerCase();
  const rightName = right.name.toLowerCase();
  if (leftName < rightName) return -1;
  if (leftName > rightName) return 1;
  if (left.selection.modeId < right.selection.modeId) return -1;
  if (left.selection.modeId > right.selection.modeId) return 1;
  return 0;
};

/**
 * Maps the project-scoped MODE collection into the bounded launch catalog.
 * The mapper deliberately consumes the effective MODE type definition rather
 * than merging canonical/project registry sources in the UI.
 */
export const mapProjectModeCatalog = ({
  projectId,
  effectiveWorkItemTypeKey,
  modeTypeSummary,
  modeItems,
  focalFeatureIds,
  reservedIdentities = new Set(listSessionMethods()),
}: ProjectModeCatalogInput): ProjectModeCatalogEntry[] => {
  if (!effectiveWorkItemTypeKey || !isActiveModeType(modeTypeSummary)) {
    return [];
  }

  const entries: ProjectModeCatalogEntry[] = [];
  const seenIds = new Set<string>();
  for (const mode of modeItems) {
    const modeId = typeof mode.id === "string" ? mode.id.trim() : "";
    if (
      !isActiveMode(mode) ||
      mode.projectId !== projectId ||
      !modeId ||
      modeId !== mode.id ||
      seenIds.has(modeId) ||
      !hasApplicableWorkItemType(
        mode,
        modeTypeSummary,
        effectiveWorkItemTypeKey
      ) ||
      !hasApplicableFeature(mode, focalFeatureIds) ||
      reservedIdentities.has(modeId)
    ) {
      continue;
    }
    const name = typeof mode.name === "string" ? mode.name.trim() : "";
    const description = modeDescription(mode);
    if (!name || !description) continue;

    seenIds.add(modeId);
    entries.push({
      selection: {
        schemaVersion:
          ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
        modeId,
      },
      name,
      description,
    });
  }

  return entries.sort(compareCatalogEntries);
};

export const isProjectModeSelectionEligible = (
  selection: ProjectModeSelection | null | undefined,
  catalog: readonly ProjectModeCatalogEntry[]
): boolean =>
  selection?.schemaVersion ===
    ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1 &&
  catalog.some((entry) => entry.selection.modeId === selection.modeId);
