import { useTheme } from "@mui/material";
import { useMemo } from "react";
import {
  type DiagramElementMetadata,
  type WorkItemTypeSectionDefinition,
  WorkItemTypeSectionDefinitionKindEnum,
} from "../../api";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import {
  selectInlineWorkItemSections,
  selectWorkItemSections,
} from "../../utils/workItemSections";
import {
  getHtmlCssThumbnailSize,
  getStructuredMockupThumbnailSize,
  type ThumbnailSize,
} from "./mockupThumbnailSize";
import { MOCKUP_TYPE_KEY } from "./visualArtifacts";

const TEMPORARY_IDENTITY_PREFIX = "temporary:";
const SCREEN_NAME_LINE_CLAMP = 2;
export const SCREEN_NAME_LINE_HEIGHT = 1.25;
const SCREEN_NAME_GAP = 4;
const REM_PX = 16;
// The card frame draws a 1px border, 2px when highlighted; size against the
// larger one so the screen never exceeds the card's content box.
const CARD_BORDER_ALLOWANCE = 4;

type ReferenceSection = {
  key: string;
  materializedMarkdown?: string;
  content?: unknown;
};

/**
 * Content of a canonical target that is part of the displayed graph
 * projection. Takes precedence over any committed read of the same item.
 */
export interface ProjectedReferenceTarget {
  type: string;
  name: string;
  sections: readonly ReferenceSection[] | undefined;
}

export interface DiagramScreenLayout {
  /** Box the whole screen is fitted into. */
  areaWidth: number;
  areaHeight: number;
  nameHeight: number;
  gap: number;
  /** Frame-relative offset of the area's top-left corner. */
  areaTop: number;
  nameLineClamp: number;
}

interface DiagramScreenLayoutInput {
  nodeSize: number;
  cardPadding: number;
  titleFontSize: string;
}

/**
 * Splits the existing card footprint into a screen area and the name below
 * it. Depends only on the density config, never on loaded content, so content
 * arriving later cannot change the footprint.
 */
export const getDiagramScreenLayout = (
  { nodeSize, cardPadding, titleFontSize }: DiagramScreenLayoutInput,
  spacingPx: number,
): DiagramScreenLayout => {
  const padding = cardPadding * spacingPx;
  const inner = nodeSize - CARD_BORDER_ALLOWANCE - padding * 2;
  const nameHeight = Math.ceil(
    SCREEN_NAME_LINE_CLAMP *
      SCREEN_NAME_LINE_HEIGHT *
      parseFloat(titleFontSize) *
      REM_PX,
  );
  return {
    areaWidth: inner,
    areaHeight: Math.max(0, inner - nameHeight - SCREEN_NAME_GAP),
    nameHeight,
    gap: SCREEN_NAME_GAP,
    areaTop: 1 + padding,
    nameLineClamp: SCREEN_NAME_LINE_CLAMP,
  };
};

/** Layout for the density the node is drawn at; stable across renders. */
export const useDiagramScreenLayout = ({
  nodeSize,
  cardPadding,
  titleFontSize,
}: DiagramScreenLayoutInput): DiagramScreenLayout => {
  const theme = useTheme();
  const spacingPx = parseFloat(theme.spacing(1));
  return useMemo(
    () =>
      getDiagramScreenLayout(
        { nodeSize, cardPadding, titleFontSize },
        spacingPx,
      ),
    [nodeSize, cardPadding, titleFontSize, spacingPx],
  );
};

interface ScreenSection {
  definition: WorkItemTypeSectionDefinition;
  content: unknown;
  box: ThumbnailSize;
}

export type DiagramElementScreenState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      mockupName: string;
      section: ScreenSection;
      layout: DiagramScreenLayout;
    };

const NO_SCREEN: DiagramElementScreenState = { kind: "none" };
const LOADING_SCREEN: DiagramElementScreenState = { kind: "loading" };
const UNAVAILABLE_SCREEN: DiagramElementScreenState = { kind: "unavailable" };

const getSectionValue = (
  sections: readonly ReferenceSection[] | undefined,
  key: string,
): unknown => {
  const section = sections?.find((candidate) => candidate.key === key);
  if (!section) return undefined;
  return section.materializedMarkdown ?? section.content;
};

const isPopulated = (value: unknown): boolean =>
  typeof value === "string" ? value.trim().length > 0 : value != null;

const SCREEN_SECTION_SIZERS = {
  [WorkItemTypeSectionDefinitionKindEnum.HtmlCss]: getHtmlCssThumbnailSize,
  [WorkItemTypeSectionDefinitionKindEnum.StructuredMockup]:
    getStructuredMockupThumbnailSize,
} as const;

/** First populated screen section, in registry order, that can be rendered. */
const pickScreenSection = (
  definitions: readonly WorkItemTypeSectionDefinition[],
  sections: readonly ReferenceSection[] | undefined,
  layout: DiagramScreenLayout,
): ScreenSection | null => {
  for (const definition of definitions) {
    const sizer =
      SCREEN_SECTION_SIZERS[
        definition.kind as keyof typeof SCREEN_SECTION_SIZERS
      ];
    if (!sizer) continue;
    const content = getSectionValue(sections, definition.key);
    if (!isPopulated(content)) continue;
    const box = sizer(content, definition, layout.areaWidth, layout.areaHeight);
    if (box) return { definition, content, box };
  }
  return null;
};

interface UseDiagramElementScreenInput {
  canonicalReference: DiagramElementMetadata["canonicalReference"];
  organizationId: string | undefined;
  projectId: string | undefined;
  projectedTarget: ProjectedReferenceTarget | undefined;
  layout: DiagramScreenLayout;
}

/**
 * Resolves what an element's card body shows. Only the element's explicit
 * canonical task reference can select a screen, and only when the referenced
 * item's registry type is the canonical Mockup type.
 */
export const useDiagramElementScreen = ({
  canonicalReference,
  organizationId,
  projectId,
  projectedTarget,
  layout,
}: UseDiagramElementScreenInput): DiagramElementScreenState => {
  const hasScope = Boolean(organizationId && projectId);
  const targetId =
    canonicalReference?.entityType === "TASK"
      ? canonicalReference.entityId
      : undefined;
  // A temporary identity has no committed item to read.
  const shouldRead =
    hasScope &&
    Boolean(targetId) &&
    !projectedTarget &&
    !targetId?.startsWith(TEMPORARY_IDENTITY_PREFIX);
  const read = useWorkItem(organizationId ?? "", "task", targetId ?? "", {
    projectId,
    enabled: shouldRead,
  });

  const targetType = projectedTarget?.type ?? read.workItem?.type;
  const isMockup = targetType === MOCKUP_TYPE_KEY;
  const typeQuery = useWorkItemTypeByKey(
    hasScope && isMockup ? organizationId : undefined,
    hasScope && isMockup ? projectId : undefined,
    isMockup ? targetType : undefined,
  );

  const sections = projectedTarget
    ? projectedTarget.sections
    : read.workItem?.sections;
  const mockupName = projectedTarget?.name ?? read.workItem?.name ?? "";
  const definition = typeQuery.workItemTypeDefinition;
  const typeFetched = typeQuery.isFetched;
  const typeFailed = Boolean(typeQuery.error);

  return useMemo(() => {
    if (!hasScope || !targetId) return NO_SCREEN;
    if (!projectedTarget) {
      if (!shouldRead) return NO_SCREEN;
      if (read.error) return UNAVAILABLE_SCREEN;
      if (!read.isFetched) return LOADING_SCREEN;
      if (!read.workItem) return UNAVAILABLE_SCREEN;
    }
    if (!isMockup) return NO_SCREEN;

    // Screen-specific rendering waits on the registry; section keys are never
    // guessed.
    if (typeFailed) return UNAVAILABLE_SCREEN;
    const selection = selectInlineWorkItemSections(
      selectWorkItemSections({
        typeKey: targetType,
        definition,
        isFetched: typeFetched,
      }),
    );
    if (selection.status === "unavailable") {
      return selection.reason === "loading"
        ? LOADING_SCREEN
        : UNAVAILABLE_SCREEN;
    }
    const section = pickScreenSection(selection.sections, sections, layout);
    return section
      ? { kind: "ready", mockupName, section, layout }
      : UNAVAILABLE_SCREEN;
  }, [
    hasScope,
    targetId,
    projectedTarget,
    shouldRead,
    read.error,
    read.isFetched,
    read.workItem,
    isMockup,
    typeFailed,
    targetType,
    definition,
    typeFetched,
    sections,
    layout,
    mockupName,
  ]);
};

export interface DiagramScreenPlacement {
  /** Frame-relative left offset of the rendered screen. */
  left: number;
  /** Frame-relative top offset of the rendered screen. */
  top: number;
  width: number;
  height: number;
}

/** Where the rendered screen sits inside the node frame. */
export const getDiagramScreenPlacement = (
  nodeSize: number,
  state: Extract<DiagramElementScreenState, { kind: "ready" }>,
): DiagramScreenPlacement => {
  const { box } = state.section;
  return {
    left: (nodeSize - box.width) / 2,
    top: state.layout.areaTop + (state.layout.areaHeight - box.height) / 2,
    width: box.width,
    height: box.height,
  };
};
