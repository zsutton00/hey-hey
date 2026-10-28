import { useCallback, useEffect, useMemo, useState, type FC } from "react";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  DiagramKind,
  AgentEdgeCategory,
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  WorkItemTypeGraphAction,
  WorkItemTypeGraphEndpointRole,
  type ProjectedWorkItem,
  type ProjectedWorkItemRelationship,
  type WorkItemGraphParticipationResponseDto,
  type WorkItemChangeSetIdentity,
  type WorkItemChangeSetPosition,
  type WorkItemChangeSetRelationshipIdentity,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeGraphEndpointRule,
  type WorkItemTypeGraphRelationshipDeclaration,
  type WorkItemTypeGraphSearchableMetaLinkTarget,
} from "../../api";
import type { UseWorkItemGraphDraftReturn } from "../../data/hooks/useWorkItemGraphDraft";
import {
  diagramGroupMemberIdentity,
  diagramGroupMemberRef,
  parseWorkItemGraphLayoutPreference,
  readWorkItemGraphDraftGroups,
  serializeWorkItemGraphLayoutPreference,
} from "./workItemGraphDraft";
import { DiagramGroupsPanel } from "./DiagramGroupsPanel";
import { serializeDiagramGroups } from "./diagramGroupBoundaries";
import {
  workItemIdentityKey,
  type PreferredLayoutDeparture,
} from "./workItemGraphLayout";
import { WorkItemGraphMetaLinkDialog } from "./WorkItemGraphMetaLinkDialog";
import type { WorkItemGraphMetaLinkDialogValue } from "./WorkItemGraphMetaLinkDialog";
import {
  WorkItemGraphNodeDialog,
  type WorkItemGraphNodeDialogValue,
} from "./WorkItemGraphNodeDialog";
import {
  WorkItemGraphRelationshipDialog,
  type WorkItemGraphRelationshipDialogValue,
} from "./WorkItemGraphRelationshipDialog";
import {
  getDiagramMetadata,
  WorkflowGraphSurface,
  type WorkItemGraphConnectionGesture,
  type WorkItemGraphEmptyCanvasDrop,
  type WorkItemGraphReconnectGesture,
  type WorkItemGraphSelection,
} from "./WorkflowMentionInlineRenderer";
import type {
  WorkItemGraphEmptyCanvasContextMenu,
  WorkItemGraphNodeContextMenu,
} from "./workflowGraphInteractions";

export interface WorkItemGraphEditorProps {
  draft: UseWorkItemGraphDraftReturn;
  childTypeDefinition: WorkItemTypeDefinitionDto;
  organizationId: string | null;
  projectId: string | null;
  disabled?: boolean;
  participation: WorkItemGraphParticipationResponseDto | null;
}

type NodeDialogState =
  | { kind: "closed" }
  | { kind: "create"; position?: WorkItemChangeSetPosition }
  | { kind: "edit"; node: ProjectedWorkItem }
  | { kind: "empty-canvas"; drop: WorkItemGraphEmptyCanvasDrop };

type RelationshipDialogState =
  | { kind: "closed" }
  | { kind: "connect"; gesture: WorkItemGraphConnectionGesture }
  | { kind: "reconnect"; gesture: WorkItemGraphReconnectGesture }
  | {
      kind: "empty-canvas";
      drop: WorkItemGraphEmptyCanvasDrop;
      node: WorkItemGraphNodeDialogValue;
    };

function identityEquals(
  left: WorkItemChangeSetIdentity,
  right: WorkItemChangeSetIdentity,
): boolean {
  return workItemIdentityKey(left) === workItemIdentityKey(right);
}

function relationshipIdentityEquals(
  left: WorkItemChangeSetRelationshipIdentity,
  right: WorkItemChangeSetRelationshipIdentity,
): boolean {
  return (
    left.refType === right.refType &&
    (left.refType === "existing"
      ? left.id === (right.refType === "existing" ? right.id : "")
      : left.tempId === (right.refType === "temporary" ? right.tempId : ""))
  );
}

function selectionsEqual(
  left: WorkItemGraphSelection,
  right: WorkItemGraphSelection,
): boolean {
  if (
    left.children.length !== right.children.length ||
    left.relationships.length !== right.relationships.length
  ) {
    return false;
  }

  return (
    left.children.every((identity, index) =>
      identityEquals(identity, right.children[index]),
    ) &&
    left.relationships.every((identity, index) =>
      relationshipIdentityEquals(identity, right.relationships[index]),
    )
  );
}

function declarationMatches(
  declaration: WorkItemTypeGraphRelationshipDeclaration,
  relationship: ProjectedWorkItemRelationship,
): boolean {
  return (
    declaration.edgeType === relationship.edgeType &&
    declaration.category === relationship.category
  );
}

function endpointAllowsGraphNode(
  endpoint: WorkItemTypeGraphEndpointRule,
  nodeType: string,
): boolean {
  return (
    endpoint.role === WorkItemTypeGraphEndpointRole.GraphNode &&
    endpoint.entityTypes.includes(AgentEdgeEndpointEntityType.Task) &&
    (!endpoint.workItemTypeKeys?.length ||
      endpoint.workItemTypeKeys.includes(nodeType))
  );
}

function allowsGraphNodeEndpoints(
  declaration: WorkItemTypeGraphRelationshipDeclaration,
  nodeType: string,
): boolean {
  return (
    endpointAllowsGraphNode(declaration.sourceEndpoint, nodeType) &&
    endpointAllowsGraphNode(declaration.targetEndpoint, nodeType)
  );
}

function resolveSearchTarget(
  endpoint: WorkItemTypeGraphEndpointRule,
  searchTarget: WorkItemTypeGraphSearchableMetaLinkTarget,
): WorkItemTypeGraphSearchableMetaLinkTarget | null {
  if (endpoint.role !== WorkItemTypeGraphEndpointRole.ExternalEntity)
    return null;
  if (searchTarget.targetEntityTypes.length === 0) return null;
  if (
    !searchTarget.targetEntityTypes.every((entityType) =>
      endpoint.entityTypes.includes(entityType),
    )
  ) {
    return null;
  }
  if (searchTarget.targetWorkItemTypeKeys?.length) {
    return !endpoint.workItemTypeKeys?.length ||
      searchTarget.targetWorkItemTypeKeys.every((typeKey) =>
        endpoint.workItemTypeKeys?.includes(typeKey),
      )
      ? searchTarget
      : null;
  }
  return endpoint.workItemTypeKeys?.length
    ? {
        ...searchTarget,
        targetWorkItemTypeKeys: endpoint.workItemTypeKeys,
      }
    : searchTarget;
}

interface SearchableMetaDeclaration {
  relationship: WorkItemTypeGraphRelationshipDeclaration;
  searchTarget: WorkItemTypeGraphSearchableMetaLinkTarget;
}

function isValidLayoutDeclaration(
  typeDefinition: WorkItemTypeDefinitionDto,
): boolean {
  const capability = typeDefinition.capabilities?.graph;
  if (!capability?.layout.sectionKey || !capability.layout.schemaRef)
    return false;
  return (
    typeDefinition.sections?.some(
      (section) =>
        section.key === capability.layout.sectionKey &&
        section.kind === "json" &&
        section.schemaRef === capability.layout.schemaRef,
    ) ?? false
  );
}

function isValidLayoutPreferenceDeclaration(
  typeDefinition: WorkItemTypeDefinitionDto,
): boolean {
  const declaration = typeDefinition.capabilities?.graph?.layoutPreference;
  return Boolean(
    declaration?.sectionKey &&
    declaration.schemaRef &&
    typeDefinition.sections?.some(
      (section) =>
        section.key === declaration.sectionKey &&
        section.kind === "json" &&
        section.schemaRef === declaration.schemaRef,
    ),
  );
}

function parsePositiveIntegerInput(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

const PREFERRED_LAYOUT_DEPARTURE_LABELS: Record<
  PreferredLayoutDeparture,
  string
> = {
  "atomic-group-preserved": "topology groups kept together",
  "branch-lanes-preserved": "branch lanes kept together",
  "cycle-routing-preserved": "cycle routing kept readable",
  "requested-shape-unattainable": "the requested shape was not attainable",
};

function nodeCreateFields(value: WorkItemGraphNodeDialogValue) {
  return {
    name: value.name,
    ...(value.dueDate ? { dueDate: value.dueDate } : {}),
    ...(value.tag ? { tag: value.tag } : {}),
  };
}

type WorkItemGraphContextMenuState =
  | ({ kind: "node" } & WorkItemGraphNodeContextMenu)
  | ({ kind: "canvas" } & WorkItemGraphEmptyCanvasContextMenu);

interface EditorToolbarProps {
  childTypeName: string;
  selectedChild?: ProjectedWorkItem;
  selectedRelationship?: ProjectedWorkItemRelationship;
  canCreateNode: boolean;
  canUpdateSelectedChild: boolean;
  canDeleteSelectedChild: boolean;
  canUpdateSelectedRelationship: boolean;
  canDeleteSelectedRelationship: boolean;
  canClearLayout: boolean;
  canEditPreferredLayout: boolean;
  canApplyPreferredLayout: boolean;
  preferredRows: string;
  preferredColumns: string;
  canEditMetaLinks: boolean;
  metaDeclarations: readonly SearchableMetaDeclaration[];
  onAddChild: () => void;
  onEditChild: (child: ProjectedWorkItem) => void;
  onDeleteChild: (child: ProjectedWorkItem) => void;
  onEditRelationship: (relationship: ProjectedWorkItemRelationship) => void;
  onDeleteRelationship: (relationship: ProjectedWorkItemRelationship) => void;
  onReflow: () => void;
  onPreferredRowsChange: (value: string) => void;
  onPreferredColumnsChange: (value: string) => void;
  onApplyPreferredLayout: () => void;
  onAddMetaLink: (declaration: SearchableMetaDeclaration) => void;
}

const EditorToolbar: FC<EditorToolbarProps> = ({
  childTypeName,
  selectedChild,
  selectedRelationship,
  canCreateNode,
  canUpdateSelectedChild,
  canDeleteSelectedChild,
  canUpdateSelectedRelationship,
  canDeleteSelectedRelationship,
  canClearLayout,
  canEditPreferredLayout,
  canApplyPreferredLayout,
  preferredRows,
  preferredColumns,
  canEditMetaLinks,
  metaDeclarations,
  onAddChild,
  onEditChild,
  onDeleteChild,
  onEditRelationship,
  onDeleteRelationship,
  onReflow,
  onPreferredRowsChange,
  onPreferredColumnsChange,
  onApplyPreferredLayout,
  onAddMetaLink,
}) => (
  <Stack
    direction="row"
    spacing={1}
    alignItems="center"
    flexWrap="wrap"
    useFlexGap
  >
    {canCreateNode && (
      <Button
        startIcon={<AddIcon />}
        onClick={onAddChild}
        data-testid="work-item-graph-add-child"
      >
        Add {childTypeName}
      </Button>
    )}
    {canUpdateSelectedChild && selectedChild && (
      <Button
        startIcon={<EditOutlinedIcon />}
        onClick={() => onEditChild(selectedChild)}
        data-testid="work-item-graph-edit-child"
      >
        Edit
      </Button>
    )}
    {canDeleteSelectedChild && selectedChild && (
      <Button
        color="error"
        startIcon={<DeleteOutlineIcon />}
        onClick={() => onDeleteChild(selectedChild)}
        data-testid="work-item-graph-delete-child"
      >
        Delete
      </Button>
    )}
    {canUpdateSelectedRelationship && selectedRelationship && (
      <Button
        startIcon={<EditOutlinedIcon />}
        onClick={() => onEditRelationship(selectedRelationship)}
        data-testid="work-item-graph-edit-relationship"
      >
        Edit link
      </Button>
    )}
    {canDeleteSelectedRelationship && selectedRelationship && (
      <Button
        color="error"
        startIcon={<DeleteOutlineIcon />}
        onClick={() => onDeleteRelationship(selectedRelationship)}
        data-testid="work-item-graph-delete-relationship"
      >
        Delete link
      </Button>
    )}
    {canClearLayout && (
      <Button
        startIcon={<RefreshIcon />}
        onClick={onReflow}
        data-testid="work-item-graph-reflow"
      >
        Reflow
      </Button>
    )}
    {canEditPreferredLayout && (
      <>
        <TextField
          type="number"
          size="small"
          label="Rows"
          value={preferredRows}
          slotProps={{ htmlInput: { min: 1 } }}
          onChange={(event) => onPreferredRowsChange(event.target.value)}
          error={
            preferredRows.length > 0 &&
            parsePositiveIntegerInput(preferredRows) === null
          }
          data-testid="work-item-graph-preferred-rows"
          sx={{ width: 92 }}
        />
        <TextField
          type="number"
          size="small"
          label="Columns"
          value={preferredColumns}
          slotProps={{ htmlInput: { min: 1 } }}
          onChange={(event) => onPreferredColumnsChange(event.target.value)}
          error={
            preferredColumns.length > 0 &&
            parsePositiveIntegerInput(preferredColumns) === null
          }
          data-testid="work-item-graph-preferred-columns"
          sx={{ width: 104 }}
        />
        <Button
          onClick={onApplyPreferredLayout}
          disabled={!canApplyPreferredLayout}
          data-testid="work-item-graph-apply-preferred-layout"
        >
          Apply layout
        </Button>
      </>
    )}
    {canEditMetaLinks &&
      metaDeclarations.map((declaration) => (
        <Button
          key={declaration.relationship.edgeType}
          startIcon={<HubOutlinedIcon />}
          onClick={() => onAddMetaLink(declaration)}
          data-testid="work-item-graph-add-meta-link"
          data-edge-type={declaration.relationship.edgeType}
        >
          Add {declaration.relationship.edgeType}
        </Button>
      ))}
  </Stack>
);

interface MetaLinkActionsProps {
  relationships: readonly ProjectedWorkItemRelationship[];
  onRemove: (relationship: ProjectedWorkItemRelationship) => void;
}

const MetaLinkActions: FC<MetaLinkActionsProps> = ({
  relationships,
  onRemove,
}) => {
  if (relationships.length === 0) return null;
  return (
    <Stack
      data-testid="work-item-graph-meta-link-actions"
      direction="row"
      spacing={0.5}
      alignItems="center"
      useFlexGap
      flexWrap="wrap"
    >
      <Typography variant="caption" color="text.secondary">
        Meta links
      </Typography>
      {relationships.map((relationship) => (
        <Tooltip
          key={relationship.label}
          title={`Remove ${relationship.label}`}
        >
          <IconButton
            size="small"
            onClick={() => onRemove(relationship)}
            data-testid="work-item-graph-remove-meta-link"
            data-edge-type={relationship.edgeType}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ))}
    </Stack>
  );
};

export const WorkItemGraphEditor: FC<WorkItemGraphEditorProps> = ({
  draft,
  childTypeDefinition,
  organizationId,
  projectId,
  disabled = false,
  participation,
}) => {
  const capability = draft.draft.context.graphCapability;
  const supportedActions = useMemo(
    () => new Set(capability.supportedActions ?? []),
    [capability.supportedActions],
  );
  const editableRelationships = useMemo(
    () => capability.editableRelationships,
    [capability.editableRelationships],
  );
  const flowDeclarations = useMemo(
    () =>
      editableRelationships.filter(
        (declaration) =>
          declaration.category === AgentEdgeCategory.Flow &&
          allowsGraphNodeEndpoints(declaration, capability.nodeChildType),
      ),
    [capability.nodeChildType, editableRelationships],
  );
  const metaDeclarations = useMemo(
    () =>
      editableRelationships.flatMap((relationship) => {
        if (
          relationship.category !== AgentEdgeCategory.Meta ||
          relationship.edgeType === AgentEdgeType.FulfilledBy ||
          !endpointAllowsGraphNode(
            relationship.sourceEndpoint,
            capability.nodeChildType,
          )
        ) {
          return [];
        }
        const searchTarget = capability.searchableMetaLinkTargets
          ?.filter((candidate) => candidate.edgeType === relationship.edgeType)
          .map((candidate) =>
            resolveSearchTarget(relationship.targetEndpoint, candidate),
          )
          .find((candidate) => candidate !== null);
        return searchTarget ? [{ relationship, searchTarget }] : [];
      }),
    [
      capability.nodeChildType,
      capability.searchableMetaLinkTargets,
      editableRelationships,
    ],
  );
  const [selection, setSelection] = useState<WorkItemGraphSelection>({
    children: [],
    relationships: [],
  });
  const [nodeDialog, setNodeDialog] = useState<NodeDialogState>({
    kind: "closed",
  });
  const [relationshipDialog, setRelationshipDialog] =
    useState<RelationshipDialogState>({ kind: "closed" });
  const [metaDeclaration, setMetaDeclaration] =
    useState<SearchableMetaDeclaration | null>(null);
  const [editingMetaRelationship, setEditingMetaRelationship] =
    useState<ProjectedWorkItemRelationship | null>(null);
  const [contextMenu, setContextMenu] =
    useState<WorkItemGraphContextMenuState | null>(null);
  const [visibleCanvasPosition, setVisibleCanvasPosition] =
    useState<WorkItemChangeSetPosition>();
  const preferenceSectionKey = capability.layoutPreference?.sectionKey;
  const initialPreference = parseWorkItemGraphLayoutPreference(
    draft.projected.projectedRoot.sections.find(
      (section) => section.key === preferenceSectionKey,
    )?.content,
  );
  const preferenceRows = initialPreference?.rows;
  const preferenceColumns = initialPreference?.columns;
  const [preferredRows, setPreferredRows] = useState<string>(() =>
    preferenceRows === undefined ? "" : String(preferenceRows),
  );
  const [preferredColumns, setPreferredColumns] = useState<string>(() =>
    preferenceColumns === undefined ? "" : String(preferenceColumns),
  );
  useEffect(() => {
    setPreferredRows(
      preferenceRows === undefined ? "" : String(preferenceRows),
    );
    setPreferredColumns(
      preferenceColumns === undefined ? "" : String(preferenceColumns),
    );
  }, [preferenceColumns, preferenceRows]);
  // Layout previews suspend every edit, groups included, until cancelled.
  const [layoutPreviewing, setLayoutPreviewing] = useState(false);
  const handleSelectionChange = useCallback((next: WorkItemGraphSelection) => {
    setSelection((current) =>
      selectionsEqual(current, next) ? current : next,
    );
  }, []);
  const handleVisibleCanvasPositionChange = useCallback(
    (next: WorkItemChangeSetPosition) => {
      setVisibleCanvasPosition((current) =>
        current?.x === next.x && current.y === next.y ? current : next,
      );
    },
    [],
  );

  const activeChildren = draft.projected.children.filter(
    (child) => !child.deleted,
  );
  const activeRelationships = draft.projected.incidentRelationships.filter(
    (relationship) => !relationship.deleted,
  );
  const selectedChild =
    selection.children.length === 1
      ? activeChildren.find((child) =>
          identityEquals(child.identity, selection.children[0]),
        )
      : undefined;
  const selectedRelationship =
    selection.relationships.length === 1
      ? activeRelationships.find((relationship) =>
          relationshipIdentityEquals(
            relationship.identity,
            selection.relationships[0],
          ),
        )
      : undefined;
  const selectedChildIsEligible =
    selectedChild?.type === capability.nodeChildType;
  const selectedFlowIsEditable = selectedRelationship
    ? flowDeclarations.some((declaration) =>
        declarationMatches(declaration, selectedRelationship),
      )
    : false;
  const selectedMetaDeclaration = selectedRelationship
    ? metaDeclarations.find(({ relationship }) =>
        declarationMatches(relationship, selectedRelationship),
      )
    : undefined;
  const canView = supportedActions.has(WorkItemTypeGraphAction.ViewGraph);
  const canCreateNode =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.CreateNode) &&
    childTypeDefinition.key === capability.nodeChildType;
  const canUpdateNode =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.UpdateNode);
  const canDeleteNode =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.DeleteNode);
  const canCreateRelationship =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.CreateRelationship) &&
    flowDeclarations.length > 0;
  const canUpdateRelationship =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.UpdateRelationship);
  const canReconnectRelationship =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.ReconnectRelationship);
  const canDeleteRelationship =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.DeleteRelationship);
  const canEditMetaLinks =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.CreateRelationship) &&
    selectedChildIsEligible &&
    metaDeclarations.length > 0;
  const canCreateMetaLink =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.CreateRelationship) &&
    metaDeclarations.length > 0;
  const canReplaceLayout =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.ReplaceLayout) &&
    isValidLayoutDeclaration(draft.draft.context.typeDefinition);
  const canClearLayout =
    canView &&
    !disabled &&
    supportedActions.has(WorkItemTypeGraphAction.ClearLayout) &&
    isValidLayoutDeclaration(draft.draft.context.typeDefinition);
  const parsedPreferredRows = parsePositiveIntegerInput(preferredRows);
  const parsedPreferredColumns = parsePositiveIntegerInput(preferredColumns);
  const hasValidPreferredLayout =
    parsedPreferredRows !== null && parsedPreferredColumns !== null;
  const canEditPreferredLayout =
    canReplaceLayout &&
    isValidLayoutPreferenceDeclaration(draft.draft.context.typeDefinition);
  const canApplyPreferredLayout =
    canEditPreferredLayout && hasValidPreferredLayout;
  const updatePreference = useCallback(
    (rows: string, columns: string) => {
      if (!preferenceSectionKey) return;
      const parsedRows = parsePositiveIntegerInput(rows);
      const parsedColumns = parsePositiveIntegerInput(columns);
      if (parsedRows !== null && parsedColumns !== null) {
        draft.revise({
          ref: draft.projected.projectedRoot.identity,
          sections: {
            [preferenceSectionKey]: serializeWorkItemGraphLayoutPreference({
              rows: parsedRows,
              columns: parsedColumns,
            }),
          },
        });
        return;
      }

      if (
        rows === "" &&
        columns === "" &&
        draft.projected.projectedRoot.sections.some(
          (section) => section.key === preferenceSectionKey,
        )
      ) {
        draft.revise({
          ref: draft.projected.projectedRoot.identity,
          clearSections: [preferenceSectionKey],
        });
      }
    },
    [draft, preferenceSectionKey],
  );
  const changePreferredRows = useCallback(
    (rows: string) => {
      setPreferredRows(rows);
      updatePreference(rows, preferredColumns);
    },
    [preferredColumns, updatePreference],
  );
  const changePreferredColumns = useCallback(
    (columns: string) => {
      setPreferredColumns(columns);
      updatePreference(preferredRows, columns);
    },
    [preferredRows, updatePreference],
  );
  const reconnectableRelationships = activeRelationships
    .filter(
      (relationship) =>
        relationship.category === AgentEdgeCategory.Flow &&
        flowDeclarations.some((declaration) =>
          declarationMatches(declaration, relationship),
        ),
    )
    .map((relationship) => relationship.identity);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleNodeContextMenu = useCallback(
    (menu: WorkItemGraphNodeContextMenu) => {
      if (!canDeleteNode && !canCreateMetaLink) return;
      setContextMenu({ kind: "node", ...menu });
    },
    [canCreateMetaLink, canDeleteNode],
  );

  const handleEmptyCanvasContextMenu = useCallback(
    (menu: WorkItemGraphEmptyCanvasContextMenu) => {
      if (!canCreateNode) return;
      setContextMenu({ kind: "canvas", ...menu });
    },
    [canCreateNode],
  );

  const deleteContextNode = useCallback(() => {
    if (contextMenu?.kind !== "node" || !canDeleteNode) return;
    draft.delete(contextMenu.child);
    closeContextMenu();
  }, [canDeleteNode, closeContextMenu, contextMenu, draft]);

  const createContextNode = useCallback(() => {
    if (contextMenu?.kind !== "canvas" || !canCreateNode) return;
    setNodeDialog({ kind: "create", position: contextMenu.position });
    closeContextMenu();
  }, [canCreateNode, closeContextMenu, contextMenu]);

  const addContextMetaLink = useCallback(
    (declaration: SearchableMetaDeclaration) => {
      if (contextMenu?.kind !== "node" || !canCreateMetaLink) return;
      setSelection({ children: [contextMenu.child], relationships: [] });
      setMetaDeclaration(declaration);
      closeContextMenu();
    },
    [canCreateMetaLink, closeContextMenu, contextMenu],
  );

  const existingMetaTargets = useMemo(() => {
    if (!selectedChild || !metaDeclaration) return [];
    return activeRelationships
      .filter(
        (relationship) =>
          declarationMatches(metaDeclaration.relationship, relationship) &&
          identityEquals(relationship.source, selectedChild.identity),
      )
      .map((relationship) => relationship.target);
  }, [activeRelationships, metaDeclaration, selectedChild]);

  const commitRelationship = (value: WorkItemGraphRelationshipDialogValue) => {
    if (relationshipDialog.kind === "closed") return;
    const declaration = flowDeclarations.find(
      (candidate) =>
        candidate.edgeType === value.edgeType &&
        candidate.category === value.category,
    );
    if (!declaration) return;
    const fields = {
      edgeType: value.edgeType,
      category: value.category,
      ...(value.direction ? { direction: value.direction } : {}),
      ...(value.predicate !== undefined ? { predicate: value.predicate } : {}),
      ...(value.reasoning !== undefined ? { reasoning: value.reasoning } : {}),
      ...(value.metadata !== undefined ? { metadata: value.metadata } : {}),
    };

    if (relationshipDialog.kind === "connect") {
      draft.connect({ ...relationshipDialog.gesture, ...fields });
    } else if (relationshipDialog.kind === "reconnect") {
      const previous = activeRelationships.find((relationship) =>
        relationshipIdentityEquals(
          relationship.identity,
          relationshipDialog.gesture.relationship,
        ),
      );
      if (
        previous &&
        (previous.edgeType !== value.edgeType ||
          previous.category !== value.category)
      ) {
        if (!canCreateRelationship || !canDeleteRelationship) return;
        draft.remove(previous.identity);
        draft.connect({
          source: relationshipDialog.gesture.source,
          target: relationshipDialog.gesture.target,
          ...fields,
        });
      } else {
        draft.reconnect({
          ref: relationshipDialog.gesture.relationship,
          source: relationshipDialog.gesture.source,
          target: relationshipDialog.gesture.target,
          ...fields,
        });
      }
    } else {
      const created = draft.createConnected({
        child: {
          ...nodeCreateFields(relationshipDialog.node),
          type: capability.nodeChildType,
          position: relationshipDialog.drop.position,
        },
        relationship: {
          ...fields,
          childEndpoint: "target",
          otherEndpoint: relationshipDialog.drop.source,
        },
      });
      if (
        Object.keys(relationshipDialog.node.sections).length > 0 ||
        (relationshipDialog.node.clearSections?.length ?? 0) > 0
      ) {
        draft.revise({
          ref: created.child,
          sections: relationshipDialog.node.sections,
          clearSections: relationshipDialog.node.clearSections,
        });
      }
    }
    setRelationshipDialog({ kind: "closed" });
  };

  const commitNode = (value: WorkItemGraphNodeDialogValue) => {
    if (nodeDialog.kind === "closed") return;
    if (nodeDialog.kind === "empty-canvas") {
      setRelationshipDialog({
        kind: "empty-canvas",
        drop: nodeDialog.drop,
        node: value,
      });
      setNodeDialog({ kind: "closed" });
      return;
    }
    if (nodeDialog.kind === "edit") {
      draft.revise({
        ref: nodeDialog.node.identity,
        ...nodeCreateFields(value),
        sections: value.sections,
        clearSections: value.clearSections,
      });
    } else {
      const child = draft.create({
        ...nodeCreateFields(value),
        type: capability.nodeChildType,
        ...(nodeDialog.position ? { position: nodeDialog.position } : {}),
      });
      if (
        Object.keys(value.sections).length > 0 ||
        (value.clearSections?.length ?? 0) > 0
      ) {
        draft.revise({
          ref: child,
          sections: value.sections,
          clearSections: value.clearSections,
        });
      }
    }
    setNodeDialog({ kind: "closed" });
  };

  const commitMetaLink = (value: WorkItemGraphMetaLinkDialogValue) => {
    if (!metaDeclaration) return;
    if (editingMetaRelationship && canUpdateRelationship) {
      draft.reconnect({
        ref: editingMetaRelationship.identity,
        source: editingMetaRelationship.source,
        target: editingMetaRelationship.target,
        edgeType: editingMetaRelationship.edgeType,
        category: editingMetaRelationship.category,
        ...(editingMetaRelationship.direction
          ? { direction: editingMetaRelationship.direction }
          : {}),
        ...(value.reasoning !== undefined
          ? { reasoning: value.reasoning }
          : {}),
        ...(value.metadata !== undefined ? { metadata: value.metadata } : {}),
      });
      setEditingMetaRelationship(null);
      setMetaDeclaration(null);
      return;
    }
    if (!selectedChild || !canEditMetaLinks) return;
    const duplicate = activeRelationships.some(
      (relationship) =>
        declarationMatches(metaDeclaration.relationship, relationship) &&
        identityEquals(relationship.source, selectedChild.identity) &&
        identityEquals(relationship.target, value.target.identity),
    );
    if (!duplicate) {
      draft.connect({
        source: selectedChild.identity,
        target: value.target.identity,
        edgeType: metaDeclaration.relationship.edgeType,
        category: metaDeclaration.relationship.category,
        ...(metaDeclaration.relationship.direction?.allowedDirections
          ?.length === 1
          ? {
              direction:
                metaDeclaration.relationship.direction.allowedDirections[0],
            }
          : {}),
        ...(value.reasoning !== undefined
          ? { reasoning: value.reasoning }
          : {}),
        ...(value.metadata !== undefined ? { metadata: value.metadata } : {}),
      });
    }
    setMetaDeclaration(null);
  };

  const removableMetaRelationships =
    selectedChild && canDeleteRelationship
      ? activeRelationships.filter(
          (relationship) =>
            identityEquals(relationship.source, selectedChild.identity) &&
            metaDeclarations.some(({ relationship: declaration }) =>
              declarationMatches(declaration, relationship),
            ),
        )
      : [];

  const groupsSectionKey = draft.draft.context.groupsSectionKey;
  const diagramGroups = groupsSectionKey
    ? readWorkItemGraphDraftGroups(draft.draft)
    : [];
  const selectedGroupMembers = selection.children
    .filter((identity) =>
      activeChildren.some((child) => identityEquals(child.identity, identity)),
    )
    .map(diagramGroupMemberRef);
  const groupMemberLabel = (
    member: Parameters<typeof diagramGroupMemberIdentity>[0],
  ) =>
    activeChildren.find((child) =>
      identityEquals(child.identity, diagramGroupMemberIdentity(member)),
    )?.name;

  return (
    <Stack data-testid="work-item-graph-editor" spacing={1}>
      <EditorToolbar
        childTypeName={childTypeDefinition.name}
        selectedChild={selectedChild}
        selectedRelationship={selectedRelationship}
        canCreateNode={canCreateNode}
        canUpdateSelectedChild={canUpdateNode && selectedChildIsEligible}
        canDeleteSelectedChild={canDeleteNode && selectedChildIsEligible}
        canUpdateSelectedRelationship={
          canUpdateRelationship &&
          (selectedFlowIsEditable || Boolean(selectedMetaDeclaration))
        }
        canDeleteSelectedRelationship={
          canDeleteRelationship && selectedFlowIsEditable
        }
        canClearLayout={canClearLayout}
        canEditPreferredLayout={canEditPreferredLayout}
        canApplyPreferredLayout={canApplyPreferredLayout}
        preferredRows={preferredRows}
        preferredColumns={preferredColumns}
        canEditMetaLinks={canEditMetaLinks}
        metaDeclarations={metaDeclarations}
        onAddChild={() =>
          setNodeDialog({ kind: "create", position: visibleCanvasPosition })
        }
        onEditChild={(node) => setNodeDialog({ kind: "edit", node })}
        onDeleteChild={(node) => draft.delete(node.identity)}
        onEditRelationship={(relationship) => {
          if (selectedMetaDeclaration) {
            setMetaDeclaration(selectedMetaDeclaration);
            setEditingMetaRelationship(relationship);
            return;
          }
          setRelationshipDialog({
            kind: "reconnect",
            gesture: {
              relationship: relationship.identity,
              source: relationship.source,
              target: relationship.target,
            },
          });
        }}
        onDeleteRelationship={(relationship) =>
          draft.remove(relationship.identity)
        }
        onReflow={draft.reflow}
        onPreferredRowsChange={changePreferredRows}
        onPreferredColumnsChange={changePreferredColumns}
        onApplyPreferredLayout={draft.applyPreferredLayout}
        onAddMetaLink={setMetaDeclaration}
      />
      {draft.draft.preferredLayoutResult &&
        draft.draft.preferredLayoutResult.departures.length > 0 && (
          <Alert
            severity="info"
            data-testid="work-item-graph-layout-departures"
          >
            Requested {draft.draft.preferredLayoutResult.requested.rows} rows ×{" "}
            {draft.draft.preferredLayoutResult.requested.columns} columns;
            applied {draft.draft.preferredLayoutResult.actual.rows} rows ×{" "}
            {draft.draft.preferredLayoutResult.actual.columns} columns because{" "}
            {draft.draft.preferredLayoutResult.departures
              .map((departure) => PREFERRED_LAYOUT_DEPARTURE_LABELS[departure])
              .join(", ")}
            .
          </Alert>
        )}
      {groupsSectionKey && canView && (
        <DiagramGroupsPanel
          groups={diagramGroups}
          selectedMembers={selectedGroupMembers}
          memberLabel={groupMemberLabel}
          disabled={!canUpdateNode || layoutPreviewing}
          onChange={(groups) =>
            draft.revise({
              ref: draft.projected.projectedRoot.identity,
              sections: {
                [groupsSectionKey]: serializeDiagramGroups(groups),
              },
            })
          }
        />
      )}
      <MetaLinkActions
        relationships={removableMetaRelationships}
        onRemove={(relationship) => draft.remove(relationship.identity)}
      />
      {!canView && (
        <Alert severity="info">
          This work-item type does not allow graph viewing.
        </Alert>
      )}
      {canView && (
        <WorkflowGraphSurface
          mode="edit"
          organizationId={organizationId ?? undefined}
          projectId={projectId ?? undefined}
          projection={draft.projected}
          participation={participation}
          allowNodeDragging={canReplaceLayout}
          allowConnections={canCreateRelationship}
          allowReconnection={canReconnectRelationship}
          reconnectableRelationships={reconnectableRelationships}
          onNodeDragStop={draft.move}
          onConnect={(gesture) => {
            if (canCreateRelationship) {
              setRelationshipDialog({ kind: "connect", gesture });
            }
          }}
          onReconnect={(gesture) => {
            const relationship = activeRelationships.find((candidate) =>
              relationshipIdentityEquals(
                candidate.identity,
                gesture.relationship,
              ),
            );
            if (
              canReconnectRelationship &&
              relationship &&
              flowDeclarations.some((declaration) =>
                declarationMatches(declaration, relationship),
              )
            ) {
              draft.reconnect({
                ref: gesture.relationship,
                source: gesture.source,
                target: gesture.target,
              });
            }
          }}
          onNodeContextMenu={
            canDeleteNode || canCreateMetaLink
              ? handleNodeContextMenu
              : undefined
          }
          onEmptyCanvasContextMenu={
            canCreateNode ? handleEmptyCanvasContextMenu : undefined
          }
          onSelectionChange={handleSelectionChange}
          onLayoutPreviewChange={setLayoutPreviewing}
          onVisibleCanvasPositionChange={
            canReplaceLayout ? handleVisibleCanvasPositionChange : undefined
          }
          onEmptyCanvasDrop={(drop) => {
            if (canCreateNode && canCreateRelationship && canReplaceLayout) {
              setNodeDialog({ kind: "empty-canvas", drop });
            }
          }}
        />
      )}
      <Menu
        open={contextMenu !== null}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu
            ? {
                top: contextMenu.menuPosition.y,
                left: contextMenu.menuPosition.x,
              }
            : undefined
        }
        onClose={closeContextMenu}
      >
        {contextMenu?.kind === "node" && canDeleteNode && (
          <MenuItem
            onClick={deleteContextNode}
            data-testid="work-item-graph-context-delete"
          >
            Delete
          </MenuItem>
        )}
        {contextMenu?.kind === "node" && canCreateMetaLink
          ? metaDeclarations.map((declaration) => (
              <MenuItem
                key={declaration.relationship.edgeType}
                onClick={() => addContextMetaLink(declaration)}
                data-testid="work-item-graph-context-add-meta-link"
                data-edge-type={declaration.relationship.edgeType}
              >
                Add {declaration.relationship.edgeType}
              </MenuItem>
            ))
          : null}
        {contextMenu?.kind === "canvas" && canCreateNode ? (
          <MenuItem
            onClick={createContextNode}
            data-testid="work-item-graph-context-create"
          >
            Add {childTypeDefinition.name}
          </MenuItem>
        ) : null}
      </Menu>
      <WorkItemGraphNodeDialog
        open={nodeDialog.kind !== "closed"}
        typeDefinition={childTypeDefinition}
        organizationId={organizationId}
        projectId={projectId}
        node={nodeDialog.kind === "edit" ? nodeDialog.node : null}
        onCancel={() => setNodeDialog({ kind: "closed" })}
        onCommit={commitNode}
      />
      <WorkItemGraphRelationshipDialog
        open={relationshipDialog.kind !== "closed"}
        declarations={flowDeclarations}
        actionLabelRequired={
          getDiagramMetadata(draft.projected.projectedRoot)?.kind ===
          DiagramKind.UxFlow
        }
        relationship={
          relationshipDialog.kind === "reconnect"
            ? activeRelationships.find((relationship) =>
                relationshipIdentityEquals(
                  relationship.identity,
                  relationshipDialog.gesture.relationship,
                ),
              )
            : null
        }
        onCancel={() => setRelationshipDialog({ kind: "closed" })}
        onCommit={commitRelationship}
      />
      <WorkItemGraphMetaLinkDialog
        open={metaDeclaration !== null}
        organizationId={organizationId}
        projectId={projectId}
        sourceChild={
          editingMetaRelationship?.source ?? selectedChild?.identity ?? null
        }
        relationshipDeclaration={metaDeclaration?.relationship ?? null}
        searchTarget={metaDeclaration?.searchTarget ?? null}
        existingTargets={existingMetaTargets}
        relationship={editingMetaRelationship}
        onCancel={() => {
          setMetaDeclaration(null);
          setEditingMetaRelationship(null);
        }}
        onCommit={commitMetaLink}
      />
    </Stack>
  );
};
