import { ResolutionTextEditor } from "../ProposalReconciliation/ResolutionTextEditor";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { Edit as EditIcon } from "@mui/icons-material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import {
  Alert,
  Box,
  Button,
  InputBase,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
  IconButton,
  alpha,
} from "@mui/material";
import {
  closestCenter,
  pointerWithin,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { FeatureRequirementRecord } from "../../api";
import type {
  EntitySearchScope,
  SearchEntity,
} from "../SmarterTextAreaCard/types";
import { MentionBadgeInner } from "../SmarterTextAreaCard/MentionBadge";
import { readFeatureRequirementsSection } from "../../utils/featureRequirementsSection";
import {
  addRequirement,
  addRequirementCitation,
  buildRequirementEditorLayout,
  deleteRequirement,
  filterRequirementCitationResults,
  moveRequirement,
  nextRequirementGroupLabel,
  removeRequirementCitation,
  renameRequirementGroup,
  REQUIREMENT_CITATION_SEARCH_SCOPES,
  REQUIREMENT_CITATION_SLOTS,
  REQUIREMENT_GROUPING_THRESHOLD,
  serializeFeatureRequirementsSection,
  setRequirementGroup,
  toRequirementSlotCitation,
  updateRequirementStatement,
  type RequirementCitationSlot,
} from "../../utils/featureRequirementsEditing";
import { RequirementCitationPicker } from "./RequirementCitationPicker";

export interface FeatureRequirementsEditorContext {
  organizationId: string;
  projectId: string;
  /** The feature whose requirements are edited; never offered as a citation. */
  featureId: string;
  /** The feature's structural parent; never offered as a citation. */
  parentId: string | null;
  onSearchEntities: (
    query: string,
    searchScope: EntitySearchScope,
  ) => Promise<SearchEntity[]>;
}

export interface FeatureRequirementsSectionEditorProps {
  /** Serialized FeatureRequirementsSection; empty when the section is unset. */
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  context: FeatureRequirementsEditorContext;
}

const SLOT_LABELS = {
  designedBy: "Designed by",
  fulfilledBy: "Fulfilled by",
  contracts: "Contracts",
} as const satisfies Record<RequirementCitationSlot, string>;

const UNGROUPED_CONTAINER_ID = "requirements-ungrouped";
const NEW_GROUP_OPTION = "__new_group__";

const groupContainerId = (label: string): string =>
  `requirements-group:${label}`;

const createRequirementId = (): string => globalThis.crypto.randomUUID();

interface RequirementRowProps {
  record: FeatureRequirementRecord;
  disabled: boolean;
  context: FeatureRequirementsEditorContext;
  groups: readonly string[];
  onSelectGroup: (id: string, group: string) => void;
  onStatementChange: (id: string, statement: string) => void;
  onAddCitation: (
    id: string,
    slot: RequirementCitationSlot,
    entity: SearchEntity,
  ) => void;
  onRemoveCitation: (
    id: string,
    slot: RequirementCitationSlot,
    citation: { entityType: string; entityId: string },
  ) => void;
  onMoveToNewGroup: (id: string) => void;
  onDelete: (id: string) => void;
}

interface RequirementSlotRowProps {
  record: FeatureRequirementRecord;
  slot: RequirementCitationSlot;
  disabled: boolean;
  context: FeatureRequirementsEditorContext;
  onAddCitation: RequirementRowProps["onAddCitation"];
  onRemoveCitation: RequirementRowProps["onRemoveCitation"];
}

const RequirementSlotRow: React.FC<RequirementSlotRowProps> = ({
  record,
  slot,
  disabled,
  context,
  onAddCitation,
  onRemoveCitation,
}) => {
  const citations = record[slot];
  const { onSearchEntities, featureId, parentId } = context;
  const searchSlot = useCallback(
    async (query: string, scope: EntitySearchScope) =>
      filterRequirementCitationResults(
        slot,
        await onSearchEntities(query, scope),
        { featureId, parentId },
        citations,
      ),
    [citations, featureId, onSearchEntities, parentId, slot],
  );

  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      data-testid="requirement-citation-slot"
      data-citation-slot={slot}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: 76 }}
      >
        {SLOT_LABELS[slot]}
      </Typography>
      {citations.map((citation) => (
        <Stack
          key={`${citation.entityType}:${citation.entityId}`}
          direction="row"
          alignItems="center"
          spacing={0.25}
          data-testid="requirement-citation"
          data-entity-id={citation.entityId}
        >
          <MentionBadgeInner
            mention={{
              entityType: citation.entityType,
              entityId: citation.entityId,
              entityName: citation.entityTitle,
            }}
            mode="minimal"
          />
          {!disabled && (
            <IconButton
              size="small"
              aria-label={`Remove ${citation.entityTitle}`}
              data-testid="requirement-citation-remove"
              onClick={() => onRemoveCitation(record.id, slot, citation)}
              sx={{ p: 0.25 }}
            >
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          )}
        </Stack>
      ))}
      <RequirementCitationPicker
        slotLabel={SLOT_LABELS[slot]}
        searchScope={REQUIREMENT_CITATION_SEARCH_SCOPES[slot]}
        onSearchEntities={searchSlot}
        onSelectEntity={(entity) => onAddCitation(record.id, slot, entity)}
        organizationId={context.organizationId}
        projectId={context.projectId}
        disabled={disabled}
      />
    </Stack>
  );
};

const RequirementRow: React.FC<RequirementRowProps> = ({
  record,
  disabled,
  context,
  groups,
  onSelectGroup,
  onStatementChange,
  onAddCitation,
  onRemoveCitation,
  onMoveToNewGroup,
  onDelete,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: record.id, disabled });

  return (
    <Box
      ref={setNodeRef}
      data-testid="requirement-editor-row"
      data-requirement-id={record.id}
      sx={{
        display: "flex",
        gap: 0.5,
        py: 1,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <IconButton
        ref={setActivatorNodeRef}
        size="small"
        aria-label="Drag to reorder requirement"
        data-testid="requirement-drag-handle"
        disabled={disabled}
        sx={{ alignSelf: "flex-start", cursor: "grab", color: "text.disabled" }}
        {...attributes}
        {...listeners}
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <InputBase
            multiline
            fullWidth
            value={record.statement}
            placeholder="Describe the requirement"
            disabled={disabled}
            onChange={(event) =>
              onStatementChange(record.id, event.target.value)
            }
            inputProps={{
              "aria-label": "Requirement statement",
              "data-testid": "requirement-statement-input",
            }}
            sx={{ fontSize: 14 }}
          />
        </Stack>
        {REQUIREMENT_CITATION_SLOTS.map((slot) => (
          <RequirementSlotRow
            key={slot}
            record={record}
            slot={slot}
            disabled={disabled}
            context={context}
            onAddCitation={onAddCitation}
            onRemoveCitation={onRemoveCitation}
          />
        ))}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          data-testid="requirement-footer"
        >
          <Typography variant="caption" color="text.secondary">
            Group
          </Typography>
          <GroupPicker
            recordId={record.id}
            currentGroup={record.group}
            groups={groups}
            disabled={disabled}
            onSelectGroup={onSelectGroup}
            onMoveToNewGroup={onMoveToNewGroup}
          />
          <Tooltip title="Delete requirement">
            <span>
              <IconButton
                size="small"
                aria-label="Delete requirement"
                disabled={disabled}
                onClick={() => onDelete(record.id)}
                data-testid="requirement-delete"
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
    </Box>
  );
};

interface RequirementContainerProps {
  id: string;
  records: readonly FeatureRequirementRecord[];
  children: React.ReactNode;
  group: string | null;
  highlighted: boolean;
}

const RequirementContainer: React.FC<RequirementContainerProps> = ({
  id,
  records,
  children,
  group,
  highlighted,
}) => {
  const { setNodeRef } = useDroppable({ id });
  return (
    <SortableContext
      id={id}
      items={records.map((record) => record.id)}
      strategy={verticalListSortingStrategy}
    >
      <Box
        ref={setNodeRef}
        data-testid={
          group === null
            ? "requirements-editor-ungrouped-container"
            : "requirements-editor-group"
        }
        data-requirement-group={group ?? undefined}
        data-drop-target={highlighted}
        sx={
          group === null
            ? { minHeight: 8 }
            : {
                minHeight: 8,
                p: 1.5,
                borderRadius: 1,
                border: "1px solid",
                borderColor: highlighted ? "primary.main" : "divider",
                borderStyle: highlighted ? "dashed" : "solid",
                bgcolor: highlighted
                  ? (theme) => alpha(theme.palette.primary.main, 0.08)
                  : "transparent",
              }
        }
      >
        {children}
      </Box>
    </SortableContext>
  );
};

interface GroupLabelInputProps {
  label: string;
  disabled: boolean;
  onRename: (from: string, to: string) => boolean;
}

/** Renames a group in place; an unusable label reverts on commit. */
const GroupLabelInput: React.FC<GroupLabelInputProps> = ({
  label,
  disabled,
  onRename,
}) => {
  const [draft, setDraft] = useState(label);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    setDraft(label);
    setRenaming(false);
  }, [label, disabled]);
  const commit = () => {
    if (draft !== label) onRename(label, draft);
    setDraft(label);
    setRenaming(false);
  };
  const startRename = () => {
    setDraft(label);
    setRenaming(true);
  };
  if (renaming && !disabled) {
    return (
      <InputBase
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(label);
            setRenaming(false);
          }
        }}
        slotProps={{
          input: {
            "aria-label": "Group name",
            ...{ "data-testid": "requirement-group-name-input" },
          },
        }}
        sx={{ fontWeight: 700, fontSize: 14 }}
      />
    );
  }
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Button
        disabled={disabled}
        onClick={startRename}
        data-testid="requirement-group-name"
        sx={{
          color: "text.primary",
          fontWeight: 700,
          textTransform: "none",
          minWidth: 0,
        }}
      >
        {label}
      </Button>
      <IconButton
        size="small"
        disabled={disabled}
        aria-label={`Rename ${label}`}
        onClick={startRename}
        data-testid="requirement-group-rename"
      >
        <EditIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
};

interface GroupPickerProps {
  recordId: string;
  currentGroup: string | undefined;
  groups: readonly string[];
  disabled: boolean;
  onSelectGroup: (id: string, group: string) => void;
  onMoveToNewGroup: (id: string) => void;
}

const GroupPicker: React.FC<GroupPickerProps> = ({
  recordId,
  currentGroup,
  groups,
  disabled,
  onSelectGroup,
  onMoveToNewGroup,
}) => (
  <Select<string>
    size="small"
    displayEmpty
    value={currentGroup ?? ""}
    disabled={disabled}
    onChange={(event) => {
      const value = event.target.value;
      if (value === NEW_GROUP_OPTION) onMoveToNewGroup(recordId);
      else if (value && value !== currentGroup) onSelectGroup(recordId, value);
    }}
    inputProps={{
      "aria-label": "Group",
      "data-testid": "requirement-group-picker",
    }}
    sx={{ alignSelf: "flex-start", minWidth: 160, fontSize: 13 }}
  >
    <MenuItem value="" disabled>
      Choose…
    </MenuItem>
    {groups.map((group) => (
      <MenuItem key={group} value={group}>
        {group}
      </MenuItem>
    ))}
    <MenuItem value={NEW_GROUP_OPTION}>New group…</MenuItem>
  </Select>
);

const findContainer = (
  layout: ReturnType<typeof buildRequirementEditorLayout>,
  id: string,
): {
  group: string | undefined;
  records: readonly FeatureRequirementRecord[];
} | null => {
  if (id === UNGROUPED_CONTAINER_ID) {
    return { group: undefined, records: layout.ungrouped };
  }
  for (const group of layout.groups) {
    if (id === groupContainerId(group.label)) {
      return { group: group.label, records: group.records };
    }
    if (group.records.some((record) => record.id === id)) {
      return { group: group.label, records: group.records };
    }
  }
  if (layout.ungrouped.some((record) => record.id === id)) {
    return { group: undefined, records: layout.ungrouped };
  }
  return null;
};

/**
 * Edits a feature's requirements one record at a time while the host page is
 * in edit mode. Emits the full canonical section on every change; the host
 * page owns saving.
 */
export const FeatureRequirementsSectionEditor: React.FC<
  FeatureRequirementsSectionEditorProps
> = ({ value, onChange, disabled, context }) => {
  const state = useMemo(
    () => readFeatureRequirementsSection(value.trim() ? value : undefined),
    [value],
  );
  const records = useMemo<readonly FeatureRequirementRecord[]>(
    () =>
      state.status === "valid" || state.status === "valid-empty"
        ? state.records
        : [],
    [state],
  );
  const layout = useMemo(
    () => buildRequirementEditorLayout(records),
    [records],
  );
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const groupLabels = layout.groups.map((group) => group.label);
  const showUngroupedArea =
    records.length >= REQUIREMENT_GROUPING_THRESHOLD &&
    layout.ungrouped.length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const emit = useCallback(
    (next: readonly FeatureRequirementRecord[]) =>
      onChange(serializeFeatureRequirementsSection(next)),
    [onChange],
  );

  const handleStatementChange = useCallback(
    (id: string, statement: string) =>
      emit(updateRequirementStatement(records, id, statement)),
    [emit, records],
  );
  const handleAddCitation = useCallback(
    (id: string, slot: RequirementCitationSlot, entity: SearchEntity) => {
      const citation = toRequirementSlotCitation(slot, entity);
      if (citation) emit(addRequirementCitation(records, id, slot, citation));
    },
    [emit, records],
  );
  const handleRemoveCitation = useCallback(
    (
      id: string,
      slot: RequirementCitationSlot,
      citation: { entityType: string; entityId: string },
    ) => emit(removeRequirementCitation(records, id, slot, citation)),
    [emit, records],
  );
  const handleMoveToNewGroup = useCallback(
    (id: string) =>
      emit(
        setRequirementGroup(records, id, nextRequirementGroupLabel(records)),
      ),
    [emit, records],
  );
  const handleSelectGroup = useCallback(
    (id: string, group: string) =>
      emit(setRequirementGroup(records, id, group)),
    [emit, records],
  );
  const handleDelete = useCallback(
    (id: string) => emit(deleteRequirement(records, id)),
    [emit, records],
  );
  const handleRename = useCallback(
    (from: string, to: string): boolean => {
      const next = renameRequirementGroup(records, from, to);
      if (!next) return false;
      emit(next);
      return true;
    },
    [emit, records],
  );
  const handleAdd = useCallback(
    () => emit(addRequirement(records, createRequirementId())),
    [emit, records],
  );

  const handleDragOver = ({ over }: DragOverEvent) => {
    setDropGroup(
      over ? (findContainer(layout, String(over.id))?.group ?? null) : null,
    );
  };
  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setDropGroup(null);
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      const destination = findContainer(layout, overId);
      if (!destination) return;
      const overIndex = destination.records.findIndex(
        (record) => record.id === overId,
      );
      const others = destination.records.filter(
        (record) => record.id !== activeId,
      );
      const index = overIndex === -1 ? others.length : overIndex;
      emit(
        moveRequirement(records, activeId, {
          group: destination.group,
          index,
        }),
      );
    },
    [emit, layout, records],
  );

  if (state.status === "invalid") {
    return (
      <Box sx={{ px: "14px", pb: 2 }} data-testid="requirements-editor-invalid">
        <Alert severity="error">
          These requirements can't be edited here because the stored content
          doesn't match the requirements format.
        </Alert>
      </Box>
    );
  }

  const rowProps = {
    disabled,
    context,
    groups: groupLabels,
    onSelectGroup: handleSelectGroup,
    onStatementChange: handleStatementChange,
    onAddCitation: handleAddCitation,
    onRemoveCitation: handleRemoveCitation,
    onMoveToNewGroup: handleMoveToNewGroup,
    onDelete: handleDelete,
  };

  return (
    <Box sx={{ px: "14px", pb: 2 }} data-testid="requirements-editor">
      <DndContext
        sensors={sensors}
        collisionDetection={(args) =>
          args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)
        }
        onDragOver={handleDragOver}
        onDragCancel={() => setDropGroup(null)}
        onDragEnd={handleDragEnd}
      >
        <Stack spacing={2}>
          {layout.groups.map((group) => (
            <RequirementContainer
              key={group.label}
              id={groupContainerId(group.label)}
              records={group.records}
              group={group.label}
              highlighted={dropGroup === group.label}
            >
              <GroupLabelInput
                label={group.label}
                disabled={disabled}
                onRename={handleRename}
              />
              {group.records.map((record) => (
                <RequirementRow key={record.id} record={record} {...rowProps} />
              ))}
            </RequirementContainer>
          ))}
          {layout.ungrouped.length > 0 || layout.groups.length > 0 ? (
            <Box
              data-testid="requirements-editor-ungrouped"
              data-labelled={showUngroupedArea}
            >
              {showUngroupedArea ? (
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  sx={{ fontWeight: 400 }}
                >
                  Not in a group
                </Typography>
              ) : null}
              <RequirementContainer
                group={null}
                highlighted={false}
                id={UNGROUPED_CONTAINER_ID}
                records={layout.ungrouped}
              >
                {layout.ungrouped.map((record) => (
                  <RequirementRow
                    key={record.id}
                    record={record}
                    {...rowProps}
                  />
                ))}
              </RequirementContainer>
            </Box>
          ) : null}
        </Stack>
      </DndContext>
      <Button
        fullWidth
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={handleAdd}
        disabled={disabled}
        data-testid="requirements-editor-add"
        sx={{ mt: 1.5, borderStyle: "dashed", textTransform: "none" }}
      >
        Add requirement
      </Button>
    </Box>
  );
};

/** Edit one existing requirement without collection-level add, delete or reorder controls. */
export function SingleRequirementEditor({
  record,
  onChange,
  disabled,
  context,
}: {
  record: FeatureRequirementRecord;
  onChange: (record: FeatureRequirementRecord) => void;
  disabled: boolean;
  context: FeatureRequirementsEditorContext;
}) {
  return (
    <Stack spacing={2}>
      <ResolutionTextEditor
        label="Requirement wording"
        value={record.statement}
        disabled={disabled}
        organizationId={context.organizationId}
        projectId={context.projectId}
        onChange={(statement) => onChange({ ...record, statement })}
      />
      {REQUIREMENT_CITATION_SLOTS.map((slot) => (
        <RequirementSlotRow
          key={slot}
          record={record}
          slot={slot}
          disabled={disabled}
          context={context}
          onAddCitation={(_id, selected, entity) => {
            const citation = toRequirementSlotCitation(selected, entity);
            if (citation)
              onChange(
                addRequirementCitation(
                  [record],
                  record.id,
                  selected,
                  citation,
                )[0],
              );
          }}
          onRemoveCitation={(_id, selected, citation) =>
            onChange(
              removeRequirementCitation(
                [record],
                record.id,
                selected,
                citation,
              )[0],
            )
          }
        />
      ))}
    </Stack>
  );
}
