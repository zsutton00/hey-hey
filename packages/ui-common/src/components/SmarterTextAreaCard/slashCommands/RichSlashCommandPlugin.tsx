import React, { useCallback, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import CloseIcon from "@mui/icons-material/Close";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { $createTextNode, $getSelection, $isRangeSelection } from "lexical";
import type { TaskResponseDto, WorkItemReferenceDto } from "../../../api";
import { ProposalStatus } from "../../../api";
import { useWorkItemTypeByKey } from "../../../data/hooks/useWorkItemTypes";
import { useWorkItem } from "../../../data/hooks/useWorkItem";
import { ModalType } from "../../../contexts/types/modalTypes";
import { useModal } from "../../../contexts/ModalContext";
import { FeaturePicker } from "../../Features/FeaturePicker";
import { insertCanonicalMention } from "../canonicalMentionInsertion";
import { $createMentionNode } from "../MentionNode";
import { useRecentMentionSelections } from "../recentMentionSelections";
import type { EntityMention, EntitySearchScope, SearchEntity } from "../types";
import { formatMention } from "../serializationUtils";
import { SlashCommandPlugin } from "./SlashCommandPlugin";
import { $replaceRangeWithText } from "./pickerReplacement";
import type {
  PickerEmit,
  PickerReplacementRange,
  SurfaceContext,
} from "./types";
import { FEATURE_TREE_PICKER } from "./types";
import { getWorkItemSectionContent } from "../../../utils/workItemSections";
import { setExplicitCommandInteractionActive } from "../explicitCommandActivity";
import { WorkItemReferencePickerDialog } from "./WorkItemReferencePickerDialog";
import {
  FixedEntityCollectionPickerDialog,
  type FixedEntityCollectionTarget,
} from "./FixedEntityCollectionPickerDialog";
import { EntityType } from "../../../api";
import { SkillPickerDialog } from "./SkillPickerDialog";
import { DiagramCreateDialog } from "../../shared/DiagramCreateDialog";
import type { AgentSkillSelection } from "../../../api";
import type { AgentComposerContext } from "./types";

const $insertMentionsAtSelection = (entities: SearchEntity[]): void => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;

  const nodes = entities.flatMap((entity) => [
    $createMentionNode({
      entityType: entity.type,
      entityId: entity.id,
      entityName: entity.name,
    }),
    $createTextNode(" "),
  ]);

  selection.insertNodes(nodes);
};

const getFeatureMentionName = (feature: TaskResponseDto): string | null => {
  const name = feature.name?.trim();
  if (name) return name;
  const description = getWorkItemSectionContent(
    feature.sections,
    "description",
  ).trim();
  return description || null;
};

interface FeaturePickerLaunchState {
  replacementRange: PickerReplacementRange;
}

interface WorkItemPickerLaunchState {
  workItemTypeKey: string;
  replacementRange: PickerReplacementRange;
}

interface FixedEntityPickerLaunchState {
  target: FixedEntityCollectionTarget;
  replacementRange: PickerReplacementRange;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SkillPickerLaunchState {}

const resolveFixedEntityTarget = (
  entityType: EntityType,
): FixedEntityCollectionTarget | null => {
  switch (entityType) {
    case EntityType.Service:
      return { kind: "service", entityType };
    case EntityType.DesignDoc:
      return { kind: "design-doc", entityType };
    default:
      return null;
  }
};

export interface RichSlashCommandPluginProps {
  organizationId: string | null;
  projectId: string | null;
  surfaceContext: SurfaceContext;
  agentContext?: AgentComposerContext | null;
  rendering?: "rich" | "plain";
  onSearchEntities?: (
    query: string,
    searchScope: EntitySearchScope,
  ) => Promise<SearchEntity[]>;
}

export const RichSlashCommandPlugin: React.FC<RichSlashCommandPluginProps> = ({
  organizationId,
  projectId,
  surfaceContext,
  agentContext,
  rendering = "rich",
  onSearchEntities,
}) => {
  const [editor] = useLexicalComposerContext();
  const [creatingDiagram, setCreatingDiagram] = useState(false);
  const modal = useModal();
  const { record: recordRecentSelection } = useRecentMentionSelections();
  const [featurePickerLaunch, setFeaturePickerLaunch] =
    useState<FeaturePickerLaunchState | null>(null);
  const [workItemPickerLaunch, setWorkItemPickerLaunch] =
    useState<WorkItemPickerLaunchState | null>(null);
  const [fixedEntityPickerLaunch, setFixedEntityPickerLaunch] =
    useState<FixedEntityPickerLaunchState | null>(null);
  const [skillPickerLaunch, setSkillPickerLaunch] =
    useState<SkillPickerLaunchState | null>(null);
  const featurePickerOpenRef = useRef(false);
  const theme = useTheme();
  const isSmallViewport = useMediaQuery(theme.breakpoints.down("sm"));
  const workItemType = useWorkItemTypeByKey(
    organizationId ?? undefined,
    projectId ?? undefined,
    workItemPickerLaunch?.workItemTypeKey,
  );
  const focalTaskId =
    surfaceContext.focalEntity.kind === "entity" &&
    surfaceContext.focalEntity.entityType === EntityType.Task
      ? surfaceContext.focalEntity.entityId
      : "";
  const focalWorkItem = useWorkItem(organizationId ?? "", "task", focalTaskId, {
    projectId: projectId ?? undefined,
    enabled: Boolean(focalTaskId),
  });
  const diagramParent =
    focalWorkItem.workItem &&
    workItemType.workItemTypeDefinition?.allowedParentEntityTypes?.includes(
      EntityType.Task,
    ) &&
    workItemType.workItemTypeDefinition.allowedParentTypes?.includes(
      focalWorkItem.workItem.type,
    )
      ? { refType: "existing" as const, id: focalWorkItem.workItem.id }
      : undefined;
  const handleInlineSearch = useCallback((_query: string) => {}, []);
  const supportsInlineSearch = rendering === "plain" && !!onSearchEntities;

  React.useEffect(() => {
    if (
      !featurePickerLaunch &&
      !workItemPickerLaunch &&
      !fixedEntityPickerLaunch &&
      !skillPickerLaunch
    )
      return;

    setExplicitCommandInteractionActive(editor, "feature-picker", true);
    return () =>
      setExplicitCommandInteractionActive(editor, "feature-picker", false);
  }, [
    editor,
    featurePickerLaunch,
    fixedEntityPickerLaunch,
    skillPickerLaunch,
    workItemPickerLaunch,
  ]);

  const insertEntityRef = useCallback(
    (
      replacementRange: PickerReplacementRange,
      entityRef: EntityMention,
    ): boolean => {
      if (rendering === "plain") {
        recordRecentSelection({
          id: entityRef.entityId,
          type: entityRef.entityType,
          name: entityRef.entityName,
        });
        editor.update(() => {
          $replaceRangeWithText(
            replacementRange,
            `${formatMention(entityRef)} `,
          );
        });
        editor.focus();
        return true;
      }

      return insertCanonicalMention({
        editor,
        mention: entityRef,
        recordRecentSelection,
        target: {
          kind: "text-range",
          range: replacementRange,
          surroundingTextPolicy: "append-trailing-space",
        },
      });
    },
    [editor, recordRecentSelection, rendering],
  );

  const insertSearchResultMentions = useCallback(
    (entities: SearchEntity[]) => {
      for (const entity of entities) {
        recordRecentSelection({
          id: entity.id,
          type: entity.type,
          name: entity.name,
        });
      }

      editor.update(() => {
        $insertMentionsAtSelection(entities);
      });
    },
    [editor, recordRecentSelection],
  );

  const onPickerEmit = useCallback(
    (emit: PickerEmit) => {
      switch (emit.type) {
        case "openEntitySelection":
          if (!organizationId || !projectId) return;
          if (
            emit.target.kind === "work-item-type" &&
            emit.target.workItemTypeKey === "FEATURE"
          ) {
            featurePickerOpenRef.current = true;
            setFeaturePickerLaunch({
              replacementRange: emit.replacementRange,
            });
            return;
          }
          if (emit.target.kind === "work-item-type") {
            setWorkItemPickerLaunch({
              workItemTypeKey: emit.target.workItemTypeKey,
              replacementRange: emit.replacementRange,
            });
            return;
          }
          if (emit.target.kind === "entity-type") {
            const target = resolveFixedEntityTarget(emit.target.entityType);
            if (target) {
              setFixedEntityPickerLaunch({
                target,
                replacementRange: emit.replacementRange,
              });
            }
          }
          return;
        case "openPicker":
          if (
            emit.picker === FEATURE_TREE_PICKER &&
            organizationId &&
            projectId
          ) {
            featurePickerOpenRef.current = true;
            setFeaturePickerLaunch({
              replacementRange: emit.replacementRange,
            });
          }
          return;
        case "openSkillPicker":
          if (!agentContext || agentContext.provider !== "codex") return;
          editor.update(() => {
            $replaceRangeWithText(emit.replacementRange, "");
          });
          setSkillPickerLaunch({});
          return;
        case "insertText":
          editor.update(() => {
            $replaceRangeWithText(emit.replacementRange, emit.text);
          });
          return;
        case "insertMention":
          insertEntityRef(emit.replacementRange, emit.entityRef);
          return;
        case "openModal":
          if (rendering === "plain") return;
          if (emit.modal !== "search" || !modal || !organizationId) return;
          modal.openModal({
            type: ModalType.ADVANCED_SEARCH,
            organizationId,
            projectId: projectId ?? undefined,
            defaultQuery: emit.prefill,
            onSelect: insertSearchResultMentions,
          });
          return;
      }
    },
    [
      editor,
      insertEntityRef,
      insertSearchResultMentions,
      agentContext,
      modal,
      organizationId,
      projectId,
      rendering,
    ],
  );

  const handleFeaturePickerClose = useCallback(() => {
    if (!featurePickerOpenRef.current) return;
    featurePickerOpenRef.current = false;
    setFeaturePickerLaunch(null);
    editor.focus();
  }, [editor]);

  const handleWorkItemPickerClose = useCallback(() => {
    setWorkItemPickerLaunch(null);
    editor.focus();
  }, [editor]);

  const handleFixedEntityPickerClose = useCallback(() => {
    setFixedEntityPickerLaunch(null);
    editor.focus();
  }, [editor]);

  const handleSkillPickerClose = useCallback(() => {
    setSkillPickerLaunch(null);
    editor.focus();
  }, [editor]);

  const handleSkillPickerSelect = useCallback(
    (selection: AgentSkillSelection) => {
      if (!agentContext || !skillPickerLaunch) return;
      agentContext.onSkillSelected(selection);
      setSkillPickerLaunch(null);
      editor.focus();
    },
    [agentContext, editor, skillPickerLaunch],
  );

  const handleFixedEntityPickerSelect = useCallback(
    (mention: EntityMention) => {
      if (!fixedEntityPickerLaunch) return;
      const inserted = insertEntityRef(
        fixedEntityPickerLaunch.replacementRange,
        mention,
      );
      setFixedEntityPickerLaunch(null);
      if (!inserted) editor.focus();
    },
    [editor, fixedEntityPickerLaunch, insertEntityRef],
  );

  const handleWorkItemPickerSelect = useCallback(
    (reference: WorkItemReferenceDto) => {
      if (!workItemPickerLaunch) return;
      // The token carries the item's own type key so renderers can resolve it
      // through the registry without reading the item.
      const inserted = insertEntityRef(workItemPickerLaunch.replacementRange, {
        entityType: reference.type,
        entityId: reference.id,
        entityName: reference.name,
      });
      setWorkItemPickerLaunch(null);
      if (!inserted) editor.focus();
    },
    [editor, insertEntityRef, workItemPickerLaunch],
  );

  const handleFeaturePickerChange = useCallback(
    (_featureId: string | null, feature?: TaskResponseDto) => {
      if (!featurePickerLaunch || !feature) return;

      const entityName = getFeatureMentionName(feature);
      if (!entityName) return;

      const featureMention: EntityMention = {
        entityType: "feature",
        entityId: feature.id,
        entityName,
      };
      const inserted = insertEntityRef(
        featurePickerLaunch.replacementRange,
        featureMention,
      );
      featurePickerOpenRef.current = false;
      setFeaturePickerLaunch(null);
      if (!inserted) editor.focus();
    },
    [editor, featurePickerLaunch, insertEntityRef],
  );

  return (
    <>
      <SlashCommandPlugin
        organizationId={organizationId}
        projectId={projectId}
        surfaceContext={surfaceContext}
        agentContext={agentContext}
        onPickerEmit={onPickerEmit}
        onSearchEntities={onSearchEntities}
        onInlineSearch={supportsInlineSearch ? handleInlineSearch : undefined}
      />
      {featurePickerLaunch && organizationId && projectId && (
        <Dialog
          open
          onClose={handleFeaturePickerClose}
          fullWidth
          maxWidth="lg"
          fullScreen={isSmallViewport}
          data-testid="slash-feature-tree-picker"
        >
          <DialogTitle
            sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}
          >
            Choose a feature
            <IconButton
              aria-label="Close feature picker"
              data-testid="close-feature-tree-picker"
              onClick={handleFeaturePickerClose}
              sx={{ ml: "auto" }}
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers sx={{ minHeight: 0 }}>
            <FeaturePicker
              organizationId={organizationId}
              projectId={projectId}
              label="Feature"
              value={null}
              onChange={handleFeaturePickerChange}
              searchable
              openOnMount
              onClose={handleFeaturePickerClose}
            />
          </DialogContent>
        </Dialog>
      )}
      {workItemPickerLaunch &&
        !creatingDiagram &&
        organizationId &&
        projectId &&
        workItemType.isReady &&
        workItemType.workItemTypeDefinition && (
          <WorkItemReferencePickerDialog
            effectiveSource={workItemType.workItemTypeSummary?.effectiveSource}
            organizationId={organizationId}
            projectId={projectId}
            definition={
              workItemType.workItemTypeDefinition.key === "DIAGRAM"
                ? { ...workItemType.workItemTypeDefinition, name: "Diagram" }
                : workItemType.workItemTypeDefinition
            }
            onClose={handleWorkItemPickerClose}
            onSelect={handleWorkItemPickerSelect}
            onCreate={
              workItemType.workItemTypeDefinition.key === "DIAGRAM"
                ? () => setCreatingDiagram(true)
                : undefined
            }
          />
        )}
      {creatingDiagram &&
      workItemPickerLaunch &&
      organizationId &&
      projectId &&
      workItemType.workItemTypeDefinition?.capabilities?.graph ? (
        <DiagramCreateDialog
          open
          organizationId={organizationId}
          projectId={projectId}
          definition={workItemType.workItemTypeDefinition}
          parent={diagramParent}
          onClose={() => setCreatingDiagram(false)}
          onSubmitted={(proposal) => {
            if (
              proposal.status === ProposalStatus.Approved &&
              proposal.targetEntityId !== "00000000-0000-0000-0000-000000000000"
            ) {
              handleWorkItemPickerSelect({
                id: proposal.targetEntityId,
                name: proposal.title ?? "Diagram",
                type: "DIAGRAM",
              } as WorkItemReferenceDto);
            } else {
              handleWorkItemPickerClose();
            }
            setCreatingDiagram(false);
          }}
        />
      ) : null}
      {fixedEntityPickerLaunch && organizationId && projectId && (
        <FixedEntityCollectionPickerDialog
          organizationId={organizationId}
          projectId={projectId}
          target={fixedEntityPickerLaunch.target}
          onClose={handleFixedEntityPickerClose}
          onSelect={handleFixedEntityPickerSelect}
        />
      )}
      {skillPickerLaunch && agentContext ? (
        <SkillPickerDialog
          open
          context={agentContext}
          onClose={handleSkillPickerClose}
          onSelect={handleSkillPickerSelect}
        />
      ) : null}
    </>
  );
};
