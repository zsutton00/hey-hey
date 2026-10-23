import { useState, type FC } from "react";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type {
  DiagramGroup,
  DiagramGroupMeaning,
  WorkItemGraphLayoutNodeRef,
} from "../../api";
import {
  addDiagramGroupMembers,
  allocateDiagramGroupId,
  DIAGRAM_GROUP_MEANING_LABELS,
  DIAGRAM_GROUP_COLOR_ORDER,
  isDiagramGroupColor,
  diagramGroupMemberKey,
  eligibleDiagramGroupParents,
  isFactualDiagramGroup,
  removeDiagramGroup,
  removeDiagramGroupMembers,
} from "./diagramGroupBoundaries";

export interface DiagramGroupsPanelProps {
  groups: readonly DiagramGroup[];
  selectedMembers: readonly WorkItemGraphLayoutNodeRef[];
  memberLabel: (member: WorkItemGraphLayoutNodeRef) => string | undefined;
  disabled?: boolean;
  onChange: (groups: DiagramGroup[]) => void;
}

const GroupLabelField: FC<{
  group: DiagramGroup;
  disabled: boolean;
  onCommit: (label: string) => void;
}> = ({ group, disabled, onCommit }) => {
  const [value, setValue] = useState(group.label);
  const [prior, setPrior] = useState(group.label);
  if (prior !== group.label) {
    setPrior(group.label);
    setValue(group.label);
  }
  const commit = () => {
    const label = value.trim();
    if (label && label !== group.label) onCommit(label);
    else setValue(group.label);
  };
  return (
    <TextField
      size="small"
      label="Label"
      value={value}
      disabled={disabled}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      inputProps={{
        maxLength: 200,
        "data-testid": `diagram-group-label-${group.id}`,
      }}
      sx={{ minWidth: 160 }}
    />
  );
};

export const DiagramGroupsPanel: FC<DiagramGroupsPanelProps> = ({
  groups,
  selectedMembers,
  memberLabel,
  disabled = false,
  onChange,
}) => {
  const update = (groupId: string, patch: Partial<DiagramGroup>) =>
    onChange(
      groups.map((group) => {
        if (group.id !== groupId) return group;
        const next = { ...group, ...patch };
        if (next.color === undefined) delete next.color;
        if (!next.parentGroupId) delete next.parentGroupId;
        return next;
      })
    );
  const addGroup = () => {
    const label = `Group ${groups.length + 1}`;
    onChange([
      ...groups,
      {
        id: allocateDiagramGroupId(label, groups),
        label,
        meaning: "VISUAL_ASSOCIATION",
        members: selectedMembers.length ? [...selectedMembers] : [],
      },
    ]);
  };

  return (
    <Stack data-testid="diagram-groups-panel" spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle2">Groups and boundaries</Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={disabled}
          onClick={addGroup}
          data-testid="diagram-group-add"
        >
          Add group
        </Button>
      </Stack>
      {groups.length === 0 && (
        <Typography variant="caption" color="text.secondary">
          No groups. Groups show which elements belong together; boundaries show
          where elements factually sit, such as a cloud region.
        </Typography>
      )}
      {groups.map((group) => {
        const parents = eligibleDiagramGroupParents(groups, group);
        const selectedKeys = new Set(
          selectedMembers.map(diagramGroupMemberKey)
        );
        const selectedInGroup = group.members.filter((member) =>
          selectedKeys.has(diagramGroupMemberKey(member))
        );
        return (
          <Stack
            key={group.id}
            data-testid={`diagram-group-${group.id}`}
            direction="row"
            spacing={1}
            alignItems="center"
            useFlexGap
            flexWrap="wrap"
          >
            <GroupLabelField
              group={group}
              disabled={disabled}
              onCommit={(label) => update(group.id, { label })}
            />
            <TextField
              select
              size="small"
              label="Color"
              value={group.color ?? ""}
              disabled={disabled}
              onChange={(event) =>
                update(group.id, {
                  color: isDiagramGroupColor(event.target.value)
                    ? event.target.value
                    : undefined,
                })
              }
              inputProps={{
                "data-testid": "diagram-group-color",
                "data-group-id": group.id,
              }}
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="">Auto</MenuItem>
              {DIAGRAM_GROUP_COLOR_ORDER.map((color) => (
                <MenuItem key={color} value={color}>
                  {color[0]!.toUpperCase() + color.slice(1)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Meaning"
              value={group.meaning}
              disabled={disabled}
              onChange={(event) => {
                const meaning = event.target.value as DiagramGroupMeaning;
                const parent = groups.find(
                  (candidate) => candidate.id === group.parentGroupId
                );
                // A factual boundary cannot stay inside a visual group.
                const keepsParent =
                  !parent ||
                  meaning === "VISUAL_ASSOCIATION" ||
                  isFactualDiagramGroup(parent);
                update(group.id, {
                  meaning,
                  parentGroupId: keepsParent ? group.parentGroupId : undefined,
                });
              }}
              inputProps={{
                "data-testid": `diagram-group-meaning-${group.id}`,
              }}
              sx={{ minWidth: 190 }}
            >
              {Object.entries(DIAGRAM_GROUP_MEANING_LABELS).map(
                ([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                )
              )}
            </TextField>
            <TextField
              select
              size="small"
              label="Inside"
              value={group.parentGroupId ?? ""}
              disabled={disabled}
              onChange={(event) =>
                update(group.id, {
                  parentGroupId: event.target.value || undefined,
                })
              }
              inputProps={{ "data-testid": `diagram-group-parent-${group.id}` }}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">Top level</MenuItem>
              {parents.map((parent) => (
                <MenuItem key={parent.id} value={parent.id}>
                  {parent.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              size="small"
              disabled={disabled || selectedMembers.length === 0}
              onClick={() =>
                onChange(
                  addDiagramGroupMembers(groups, group.id, selectedMembers)
                )
              }
              data-testid={`diagram-group-add-selected-${group.id}`}
            >
              Add selected
            </Button>
            <Button
              size="small"
              disabled={disabled || selectedInGroup.length === 0}
              onClick={() =>
                onChange(
                  removeDiagramGroupMembers(groups, group.id, selectedInGroup)
                )
              }
              data-testid={`diagram-group-remove-selected-${group.id}`}
            >
              Remove selected
            </Button>
            <Tooltip title={`Remove ${group.label}`}>
              <span>
                <IconButton
                  size="small"
                  disabled={disabled}
                  onClick={() => onChange(removeDiagramGroup(groups, group.id))}
                  data-testid={`diagram-group-remove-${group.id}`}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            {group.members.map((member) => {
              const label = memberLabel(member);
              return label ? (
                <Chip
                  key={diagramGroupMemberKey(member)}
                  size="small"
                  label={label}
                />
              ) : null;
            })}
          </Stack>
        );
      })}
    </Stack>
  );
};
