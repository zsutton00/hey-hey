import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Skeleton,
  Stack,
} from "@mui/material";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DIAGRAM_TASK_TYPE } from "../../constants/taskTypes";
import { useProjectContext } from "../../contexts";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import {
  useMentionWorkItemTypeKey,
  useWorkItemTypeByKey,
} from "../../data/hooks/useWorkItemTypes";
import { resolvePreviewEntityType } from "../../utils/mentionFormatting";
import {
  selectInlineWorkItemSections,
  selectWorkItemSections,
  type ResolvedWorkItemSectionSelection,
} from "../../utils/workItemSections";
import { MentionEditorContext } from "../SmarterTextAreaCard/EditorContext";
import {
  MentionBadgeInner,
  type MentionMode,
} from "../SmarterTextAreaCard/MentionBadge";
import type { EntityMention } from "../SmarterTextAreaCard/types";
import { MentionArtifactCard } from "./MentionArtifactCard";
import {
  type MentionPresentation,
  useMentionExpansion,
} from "./MentionExpansionContext";
import { isVisualArtifactTypeKey } from "./visualArtifacts";
import { WorkItemReadView } from "./WorkItemReadView";
import { useOptionalConversationScrollPolicy } from "../Conversation/hooks/useConversationScrolling";

interface WorkItemMentionInlineRendererProps {
  mention: EntityMention;
  mode?: MentionMode;
  /**
   * Shared Diagram graph surface, injected by renderMentionNode to avoid a
   * circular import. Used once the registry resolves the item to a Diagram.
   */
  renderDiagram?: (
    mention: EntityMention,
    mode?: MentionMode,
  ) => React.ReactNode;
}

const InlineWorkItemMentionDepthContext = createContext(0);

const WORK_ITEM_MENTION_PRELOAD_ROOT_MARGIN = "1500px 0px";

interface InlineVisualSectionState {
  entityId: string;
  typeKey: string;
  sectionKey: string;
}

const hasMultipleVisualSections = (
  selection: ResolvedWorkItemSectionSelection,
): boolean =>
  selection.sections.filter(
    (section) =>
      section.kind === "html/css" || section.kind === "structured-mockup",
  ).length > 1;

const selectActiveInlineSection = (
  selection: ResolvedWorkItemSectionSelection,
  state: InlineVisualSectionState | null,
  entityId: string,
): ResolvedWorkItemSectionSelection => {
  if (!hasMultipleVisualSections(selection)) return selection;

  const selectedSection =
    state?.entityId === entityId && state.typeKey === selection.typeKey
      ? selection.sections.find((section) => section.key === state.sectionKey)
      : undefined;
  const activeSection = selectedSection ?? selection.sections[0];

  return {
    ...selection,
    sections: activeSection ? [activeSection] : [],
  };
};

export const isWorkItemMention = (mention: EntityMention): boolean =>
  resolvePreviewEntityType(mention.entityType) === "task";

const InlineState: React.FC<{
  state: "loading" | "unavailable";
}> = ({ state }) =>
  state === "loading" ? (
    <Box data-testid="work-item-inline-mention-loading">
      <Skeleton variant="rounded" height={96} />
    </Box>
  ) : (
    <Alert severity="info" data-testid={`work-item-inline-mention-${state}`}>
      This work item is unavailable.
    </Alert>
  );

export const WorkItemMentionInlineRenderer: React.FC<
  WorkItemMentionInlineRendererProps
> = (props) => {
  const { presentation } = useMentionExpansion();
  // Badge-only hosts skip the inline visual, its section switcher and the
  // near-viewport read entirely, so the gate sits outside every hook below.
  return presentation === "badge" ? (
    <MentionBadgeInner mention={props.mention} mode={props.mode} />
  ) : (
    <ExpandedWorkItemMention {...props} presentation={presentation} />
  );
};

const ExpandedWorkItemMention: React.FC<
  WorkItemMentionInlineRendererProps & {
    presentation: Exclude<MentionPresentation, "badge">;
  }
> = ({ mention, mode, renderDiagram, presentation }) => {
  const editorContext = useContext(MentionEditorContext);
  const projectContext = useProjectContext();
  const inlineMentionDepth = useContext(InlineWorkItemMentionDepthContext);
  const scrollPolicy = useOptionalConversationScrollPolicy();
  const scrollOwnerRef =
    scrollPolicy?.mode === "owned" ? scrollPolicy.ownerRef : null;
  const [visualSectionState, setVisualSectionState] =
    useState<InlineVisualSectionState | null>(null);
  const context = editorContext ?? projectContext;
  const canLoad =
    isWorkItemMention(mention) && !!context && inlineMentionDepth === 0;
  const deferredContentRef = useRef<HTMLDivElement | null>(null);
  const [isHydrationEligible, setIsHydrationEligible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const mentionType = useMentionWorkItemTypeKey(
    canLoad ? context.organizationId : undefined,
    canLoad ? context.projectId : undefined,
    canLoad ? mention.entityType : undefined,
  );
  // The token is the only source of the mention's type; the item is never
  // read to learn it. Until the registry resolves, the mention stays a badge.
  const workItemTypeKey = mentionType.isResolved
    ? mentionType.typeKey
    : undefined;
  const typeQuery = useWorkItemTypeByKey(
    canLoad ? context.organizationId : undefined,
    canLoad ? context.projectId : undefined,
    canLoad ? workItemTypeKey : undefined,
  );
  const resolvedInlineDefinition =
    workItemTypeKey !== undefined &&
    typeQuery.isFetched &&
    !typeQuery.error &&
    typeQuery.workItemTypeDefinition?.key === workItemTypeKey &&
    typeQuery.workItemTypeDefinition.capabilities?.rendersInline === true;
  const showsCard =
    presentation === "card" && isVisualArtifactTypeKey(workItemTypeKey);
  // Inline types the card cannot draw keep the inline preview in card mode.
  const rendersDeferredPreview =
    !showsCard &&
    resolvedInlineDefinition &&
    workItemTypeKey !== DIAGRAM_TASK_TYPE;
  // Only an inline preview reads content, and only near the viewport. Diagrams
  // hand off to the graph surface and cards load themselves near the viewport.
  const workItemQuery = useWorkItem(
    canLoad ? context.organizationId : "",
    "task",
    canLoad ? mention.entityId : "",
    {
      enabled: canLoad && rendersDeferredPreview && isHydrationEligible,
      projectId: context?.projectId,
    },
  );
  const workItem = workItemQuery.workItem;

  useEffect(() => {
    if (!canLoad || !rendersDeferredPreview || isHydrationEligible) {
      return;
    }

    const element = deferredContentRef.current;
    if (!element) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setIsHydrationEligible(true);
      return;
    }

    let observer: IntersectionObserver | null = null;
    const owner = scrollOwnerRef?.current;
    try {
      observer = new IntersectionObserver(
        (entries) => {
          if (
            entries.some(
              (entry) => entry.target === element && entry.isIntersecting,
            )
          ) {
            setIsHydrationEligible(true);
            observer?.disconnect();
          }
        },
        {
          // A viewport root's margin is clipped by an intervening scrollport.
          // Expand the declared owner's region so hydration starts offscreen.
          root: owner?.contains(element) ? owner : null,
          rootMargin: WORK_ITEM_MENTION_PRELOAD_ROOT_MARGIN,
        },
      );
      observer.observe(element);
    } catch {
      setIsHydrationEligible(true);
    }

    return () => {
      observer?.disconnect();
    };
  }, [canLoad, rendersDeferredPreview, isHydrationEligible, scrollOwnerRef]);

  const selection = useMemo(
    () =>
      selectInlineWorkItemSections(
        selectWorkItemSections({
          typeKey: workItemTypeKey,
          definition: typeQuery.workItemTypeDefinition,
          isFetched: typeQuery.isFetched,
        }),
      ),
    [workItemTypeKey, typeQuery.isFetched, typeQuery.workItemTypeDefinition],
  );
  const activeSelection = useMemo(
    () =>
      selection.status === "resolved"
        ? selectActiveInlineSection(
            selection,
            visualSectionState,
            mention.entityId,
          )
        : selection,
    [mention.entityId, selection, visualSectionState],
  );
  const activeSectionKey =
    activeSelection.status === "resolved"
      ? activeSelection.sections[0]?.key
      : undefined;
  const visualSectionSwitcher =
    selection.status === "resolved" && hasMultipleVisualSections(selection) ? (
      <ButtonGroup
        size="small"
        aria-label="Visual section"
        data-testid="work-item-inline-section-switcher"
      >
        {selection.sections.map((section) => (
          <Button
            key={section.key}
            variant={
              section.key === activeSectionKey ? "contained" : "outlined"
            }
            aria-pressed={section.key === activeSectionKey}
            onClick={() =>
              setVisualSectionState({
                entityId: mention.entityId,
                typeKey: selection.typeKey,
                sectionKey: section.key,
              })
            }
          >
            {section.label}
          </Button>
        ))}
      </ButtonGroup>
    ) : undefined;

  if (!canLoad || !resolvedInlineDefinition) {
    return <MentionBadgeInner mention={mention} mode={mode} />;
  }

  if (showsCard && workItemTypeKey) {
    return (
      <MentionArtifactCard
        mention={mention}
        typeKey={workItemTypeKey}
        organizationId={context.organizationId}
        projectId={context.projectId}
      />
    );
  }

  if (workItemTypeKey === DIAGRAM_TASK_TYPE) {
    return renderDiagram ? (
      <>{renderDiagram({ ...mention, entityType: "diagram" }, mode)}</>
    ) : (
      <MentionBadgeInner mention={mention} mode={mode} />
    );
  }

  if (!isHydrationEligible && rendersDeferredPreview) {
    return (
      <Stack
        data-testid="work-item-inline-mention"
        data-work-item-id={mention.entityId}
        spacing={1}
        sx={{ display: "block", width: "100%", my: 1 }}
      >
        <MentionBadgeInner mention={mention} mode={mode} />
        <Box
          ref={deferredContentRef}
          data-testid="work-item-inline-mention-deferred"
          sx={{ height: 96 }}
        />
      </Stack>
    );
  }

  if (
    workItemQuery.isFetched &&
    activeSelection.status === "resolved" &&
    activeSelection.sections.length === 0
  ) {
    return <MentionBadgeInner mention={mention} mode={mode} />;
  }

  if (workItemQuery.error) {
    return <MentionBadgeInner mention={mention} mode={mode} />;
  }

  const state = !workItemQuery.isFetched
    ? "loading"
    : !workItem || !workItem.sections
      ? "unavailable"
      : selection.status === "unavailable"
        ? "unavailable"
        : null;

  return (
    <Stack
      data-testid="work-item-inline-mention"
      data-work-item-id={mention.entityId}
      spacing={1}
      sx={{ display: "block", width: "100%", my: 1 }}
    >
      <MentionBadgeInner mention={mention} mode={mode} />
      {state ? (
        <InlineState state={state} />
      ) : (
        <InlineWorkItemMentionDepthContext.Provider
          value={inlineMentionDepth + 1}
        >
          <WorkItemReadView
            sections={workItem?.sections}
            sectionSelection={activeSelection}
            htmlCssRenderingContext="inline"
            visualSectionTitle={workItem?.name}
            visualSectionEntity={
              workItem
                ? {
                    entityType: "task",
                    entityId: workItem.id,
                    projectId: context.projectId,
                    organizationId: context.organizationId,
                  }
                : undefined
            }
            visualSectionActions={visualSectionSwitcher}
          />
        </InlineWorkItemMentionDepthContext.Provider>
      )}
    </Stack>
  );
};
