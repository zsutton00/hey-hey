import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Popover,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";
import {
  AgentEdgeType,
  EntityType,
  WorkItemTypeLifecycleStatus,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeSummaryDto,
  type WorkStatus,
} from "../../api";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { getStatusLabel } from "../../utils/statusUtils";
import {
  getEntityIcon,
  resolveWorkItemIconPresentation,
} from "../../utils/entityIcons";

const PLACEHOLDER_COPY = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.",
  "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.",
  "Maecenas faucibus mollis interdum, vivamus sagittis lacus vel augue laoreet. Cras mattis consectetur purus sit amet fermentum.",
] as const;

const ORDINARY_EDGE_TYPES = new Set<string>([
  AgentEdgeType.DependsOn,
  AgentEdgeType.RelatedTo,
  AgentEdgeType.DerivesFrom,
  AgentEdgeType.Supersedes,
  AgentEdgeType.Contradicts,
  AgentEdgeType.Evolves,
]);

const humanizeKey = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());

interface WorkItemTypePreviewRelationship {
  edgeType: string;
  label: string;
  exampleTitle: string;
  exampleIconKey?: WorkItemTypeDefinitionDto["iconKey"];
  applicableTargetTypes: ReadonlyArray<{
    typeKey: string;
    typeName: string;
    iconKey?: WorkItemTypeDefinitionDto["iconKey"];
  }>;
}

interface WorkItemTypePreviewRelationshipGroup {
  typeKey: string;
  typeName: string;
  relationships: readonly WorkItemTypePreviewRelationship[];
}

export interface WorkItemTypeCreatePreviewModel {
  typeKey: string;
  title: string;
  description?: string;
  iconKey?: WorkItemTypeDefinitionDto["iconKey"];
  colorKey?: WorkItemTypeDefinitionDto["colorKey"];
  role: WorkItemTypeDefinitionDto["role"];
  parentLabels: readonly string[];
  parentExamples: readonly string[];
  sections: ReadonlyArray<{ key: string; label: string; content: string }>;
  statuses: readonly WorkStatus[];
  initialStatus?: WorkStatus;
  scalarFields: ReadonlyArray<{ key: string; label: string; value: string }>;
  relationshipGroups: readonly WorkItemTypePreviewRelationshipGroup[];
  trackedByGoal: boolean;
  capabilities: ReadonlyArray<{ key: string; label: string; enabled: boolean }>;
}

const CAPABILITY_LABELS: Record<string, string> = {
  rendersInline: "Inline",
  requiresParent: "Parent required",
  showsInExplorerSidebar: "Sidebar",
  planEligible: "Plan eligible",
  hasSetInitialStatus: "Initial status fixed",
  graph: "Graph",
};

const sampleRelationshipTitle = (
  edgeType: string,
  targetTypeName: string,
): string => {
  const target = targetTypeName.toLowerCase();
  switch (edgeType) {
    case AgentEdgeType.DependsOn:
      return `Sample prerequisite ${target}`;
    case AgentEdgeType.DerivesFrom:
      return `Sample source ${target}`;
    case AgentEdgeType.Supersedes:
      return `Sample predecessor ${target}`;
    case AgentEdgeType.Contradicts:
      return `Sample conflicting ${target}`;
    case AgentEdgeType.Evolves:
      return `Sample ongoing ${target}`;
    case AgentEdgeType.RelatedTo:
    default:
      return `Sample related ${target}`;
  }
};

const isActiveSummary = (summary: WorkItemTypeSummaryDto): boolean =>
  summary.status === WorkItemTypeLifecycleStatus.Active;

const buildRegistryDefinitionMap = (
  definition: WorkItemTypeDefinitionDto,
  summaries: readonly WorkItemTypeSummaryDto[],
): Map<string, WorkItemTypeDefinitionDto> => {
  const definitions = new Map<string, WorkItemTypeDefinitionDto>();
  summaries.filter(isActiveSummary).forEach((summary) => {
    definitions.set(summary.definition.key, summary.definition);
  });
  definitions.set(definition.key, definition);
  return definitions;
};

const resolveReferencedTypeKeys = (
  definition: WorkItemTypeDefinitionDto,
  summaries: readonly WorkItemTypeSummaryDto[],
  definitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>,
): readonly string[] | null => {
  const explicitKeys = new Set<string>(definition.allowedParentTypes ?? []);
  for (const edgeTarget of definition.edgeTargets ?? []) {
    edgeTarget.targetTypeKeys.forEach((key) => explicitKeys.add(key));
  }
  for (const sourceKey of definition.tracking?.allowedSourceTaskTypes ?? []) {
    explicitKeys.add(sourceKey);
  }

  if ([...explicitKeys].some((key) => !definitions.has(key))) {
    return null;
  }

  return summaries
    .filter(isActiveSummary)
    .map((summary) => summary.definition.key);
};

const buildRelationshipGroups = (
  definition: WorkItemTypeDefinitionDto,
  activeTypeKeys: readonly string[],
  definitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>,
): readonly WorkItemTypePreviewRelationshipGroup[] => {
  const targetKeysByEdgeType = new Map<string, string[]>();

  (definition.edgeTargets ?? []).forEach((edgeTarget) => {
    if (!ORDINARY_EDGE_TYPES.has(edgeTarget.edgeType)) return;
    const targetKeys =
      edgeTarget.targetTypeKeys.length > 0
        ? edgeTarget.targetTypeKeys
        : activeTypeKeys;
    const accumulated = targetKeysByEdgeType.get(edgeTarget.edgeType) ?? [];
    targetKeys.forEach((targetKey) => {
      if (!accumulated.includes(targetKey)) accumulated.push(targetKey);
    });
    targetKeysByEdgeType.set(edgeTarget.edgeType, accumulated);
  });

  const relationshipsByTarget = new Map<
    string,
    WorkItemTypePreviewRelationship[]
  >();

  targetKeysByEdgeType.forEach((targetKeys, edgeType) => {
    const applicableTargetTypes = targetKeys.flatMap((targetKey) => {
      const targetDefinition = definitions.get(targetKey);
      return targetDefinition
        ? [
            {
              typeKey: targetKey,
              typeName: targetDefinition.name,
              iconKey: targetDefinition.iconKey,
            },
          ]
        : [];
    });
    const exampleTarget = applicableTargetTypes[0];
    if (!exampleTarget) return;

    const relationships =
      relationshipsByTarget.get(exampleTarget.typeKey) ?? [];
    relationships.push({
      edgeType,
      label: humanizeKey(edgeType),
      exampleTitle: sampleRelationshipTitle(edgeType, exampleTarget.typeName),
      exampleIconKey: exampleTarget.iconKey,
      applicableTargetTypes,
    });
    relationshipsByTarget.set(exampleTarget.typeKey, relationships);
  });

  const orderedTargetKeys = [
    ...activeTypeKeys,
    ...[...relationshipsByTarget.keys()].filter(
      (key) => !activeTypeKeys.includes(key),
    ),
  ];

  return orderedTargetKeys.flatMap((typeKey) => {
    const relationships = relationshipsByTarget.get(typeKey);
    const targetDefinition = definitions.get(typeKey);
    if (!relationships || !targetDefinition) return [];
    return [
      {
        typeKey,
        typeName: targetDefinition.name,
        relationships: [...relationships].sort((left, right) => {
          const leftRank = left.edgeType === AgentEdgeType.DependsOn ? 0 : 1;
          const rightRank = right.edgeType === AgentEdgeType.DependsOn ? 0 : 1;
          return leftRank - rightRank;
        }),
      },
    ];
  });
};

// Exported beside the presentation so the registry-derived preview contract can
// be tested without rendering or introducing a second source of truth.
// eslint-disable-next-line react-refresh/only-export-components
export const buildWorkItemTypeCreatePreviewModel = (
  definition: WorkItemTypeDefinitionDto,
  summaries: readonly WorkItemTypeSummaryDto[],
): WorkItemTypeCreatePreviewModel | null => {
  const definitions = buildRegistryDefinitionMap(definition, summaries);
  const activeTypeKeys = resolveReferencedTypeKeys(
    definition,
    summaries,
    definitions,
  );
  if (!activeTypeKeys) return null;

  const parentTypeLabels = (definition.allowedParentTypes ?? []).map(
    (typeKey) => definitions.get(typeKey)?.name ?? typeKey,
  );
  const parentEntityLabels = (definition.allowedParentEntityTypes ?? []).map(
    humanizeKey,
  );
  const parentLabels = [...parentTypeLabels, ...parentEntityLabels];
  const requiredScalars = new Set(definition.requiredScalars ?? []);
  const scalarFields: Array<{ key: string; label: string; value: string }> = [];
  if (requiredScalars.has("dueDate")) {
    scalarFields.push({
      key: "dueDate",
      label: "Due date",
      value: "September 30, 2026",
    });
  }
  if (requiredScalars.has("tag")) {
    scalarFields.push({ key: "tag", label: "Tag", value: "Product" });
  }

  const tracksFromGoal =
    definition.tracking?.allowedSourceEntityTypes.includes(EntityType.Task) ===
      true &&
    definition.tracking.allowedSourceTaskTypes.includes("GOAL") &&
    definitions.has("GOAL");

  return {
    typeKey: definition.key,
    title: `Example ${definition.name}`,
    description: definition.description ?? undefined,
    iconKey: definition.iconKey,
    colorKey: definition.colorKey,
    role: definition.role,
    parentLabels: parentLabels.length > 0 ? parentLabels : ["Top level"],
    parentExamples: parentLabels,
    sections: definition.sections.map((section, index) => ({
      key: section.key,
      label: section.label,
      content: PLACEHOLDER_COPY[index % PLACEHOLDER_COPY.length],
    })),
    statuses: definition.allowedStatuses,
    initialStatus: definition.allowedStatuses[0],
    scalarFields,
    relationshipGroups: buildRelationshipGroups(
      definition,
      activeTypeKeys,
      definitions,
    ),
    trackedByGoal: tracksFromGoal,
    capabilities: Object.entries(definition.capabilities ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({
        key,
        label: CAPABILITY_LABELS[key] ?? humanizeKey(key),
        enabled: value === true || typeof value === "object",
      })),
  };
};

const PreviewRelationshipRow: React.FC<{
  relationship: WorkItemTypePreviewRelationship;
}> = ({ relationship }) => {
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
  const ExampleIcon = relationship.exampleIconKey
    ? getEntityIcon(relationship.exampleIconKey)
    : undefined;

  return (
    <Box
      data-testid={`work-item-type-preview-relationship-${relationship.edgeType}`}
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 1,
        borderRadius: 1,
        px: 1,
        py: 0.75,
        bgcolor: "action.hover",
      }}
    >
      {ExampleIcon && (
        <ExampleIcon
          fontSize="small"
          aria-label={`${humanizeKey(relationship.exampleIconKey ?? "")} icon`}
          sx={{ mt: 0.25, color: "text.secondary" }}
        />
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={500}>
          {relationship.exampleTitle}
        </Typography>
        <Chip
          label={relationship.label}
          size="small"
          color={
            relationship.edgeType === AgentEdgeType.DependsOn
              ? "warning"
              : "default"
          }
          variant="outlined"
          sx={{
            mt: 0.5,
            height: 18,
            fontSize: "0.65rem",
            "& .MuiChip-label": { px: 0.75 },
          }}
        />
      </Box>
      <Button
        size="small"
        variant="text"
        aria-label={`View all target types for ${relationship.label}`}
        onClick={(event) => setAnchorElement(event.currentTarget)}
        sx={{ alignSelf: "center", flexShrink: 0, whiteSpace: "nowrap" }}
      >
        View all types
      </Button>
      <Popover
        open={Boolean(anchorElement)}
        anchorEl={anchorElement}
        onClose={() => setAnchorElement(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ minWidth: 220, p: 1.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700}>
            {relationship.label} can target
          </Typography>
          <List dense disablePadding sx={{ mt: 0.5 }}>
            {relationship.applicableTargetTypes.map((targetType) => {
              const TargetIcon = targetType.iconKey
                ? getEntityIcon(targetType.iconKey)
                : undefined;
              return (
                <ListItem key={targetType.typeKey} disableGutters>
                  {TargetIcon && (
                    <ListItemIcon sx={{ minWidth: 30 }}>
                      <TargetIcon fontSize="small" />
                    </ListItemIcon>
                  )}
                  <ListItemText
                    primary={targetType.typeName}
                    secondary={targetType.typeKey}
                  />
                </ListItem>
              );
            })}
          </List>
        </Box>
      </Popover>
    </Box>
  );
};

const PreviewRelationships: React.FC<{
  model: WorkItemTypeCreatePreviewModel;
}> = ({ model }) => {
  if (model.relationshipGroups.length === 0 && !model.trackedByGoal) {
    return null;
  }

  const GoalIcon = getEntityIcon("goal");

  return (
    <Box
      data-testid="work-item-type-preview-relationships"
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}
    >
      <Stack spacing={1.75}>
        <Typography variant="subtitle2" fontWeight={700}>
          Related
        </Typography>
        {model.relationshipGroups.map((group) => (
          <Box key={group.typeKey}>
            <Typography
              variant="caption"
              color="text.secondary"
              fontWeight={700}
              sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}
            >
              {group.typeName.endsWith("s")
                ? group.typeName
                : `${group.typeName}s`}
            </Typography>
            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
              {group.relationships.map((relationship) => (
                <PreviewRelationshipRow
                  key={relationship.edgeType}
                  relationship={relationship}
                />
              ))}
            </Stack>
          </Box>
        ))}
        {model.trackedByGoal && (
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              fontWeight={700}
              sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}
            >
              Goals
            </Typography>
            <Box
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 1,
                borderRadius: 1,
                px: 1,
                py: 0.75,
                mt: 0.5,
                bgcolor: "action.hover",
              }}
            >
              <GoalIcon
                fontSize="small"
                aria-label="Goal icon"
                sx={{ mt: 0.25, color: "text.secondary" }}
              />
              <Box>
                <Typography variant="body2" fontWeight={500}>
                  Sample outcome
                </Typography>
                <Chip
                  label="Tracked by Goal"
                  size="small"
                  variant="outlined"
                  sx={{
                    mt: 0.5,
                    height: 18,
                    fontSize: "0.65rem",
                    "& .MuiChip-label": { px: 0.75 },
                  }}
                />
              </Box>
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
};

const WorkItemTypePreview: React.FC<{
  model: WorkItemTypeCreatePreviewModel;
}> = ({ model }) => {
  const [selectedStatus, setSelectedStatus] = useState<WorkStatus | "">(
    model.initialStatus ?? "",
  );
  const presentation = resolveWorkItemIconPresentation(
    model.typeKey,
    {
      key: model.typeKey,
      name: model.title,
      role: model.role,
      sections: [],
      allowedStatuses: [],
      iconKey: model.iconKey,
      colorKey: model.colorKey,
    },
    "PROJECT_CUSTOM",
  );
  const PreviewIcon = presentation?.Icon;

  return (
    <Stack spacing={1.5} data-testid="work-item-type-create-example">
      {model.description && (
        <Typography variant="body2" color="text.secondary">
          {model.description}
        </Typography>
      )}

      <Stack
        direction="row"
        spacing={0.75}
        useFlexGap
        flexWrap="wrap"
        alignItems="center"
      >
        <Chip
          label={`Role: ${model.role}`}
          size="small"
          color="primary"
          variant="outlined"
        />
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          Parents:
        </Typography>
        {model.parentLabels.map((label) => (
          <Chip key={label} label={label} size="small" variant="outlined" />
        ))}
      </Stack>

      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Typography
          variant="overline"
          component="div"
          data-testid="work-item-type-preview-disclaimer"
          sx={{
            px: { xs: 1.5, sm: 2 },
            py: 1,
            bgcolor: "action.hover",
            color: "text.secondary",
            fontWeight: 700,
            letterSpacing: 0.7,
          }}
        >
          Example item — illustrative only; nothing here creates live data
        </Typography>

        <Stack spacing={2.5} sx={{ p: { xs: 1.5, sm: 2 } }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            alignItems={{ xs: "stretch", sm: "center" }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1} alignItems="center">
              {PreviewIcon && (
                <Tooltip title={`Icon: ${humanizeKey(model.iconKey ?? "")}`}>
                  <Box
                    component="span"
                    sx={{
                      display: "inline-flex",
                      p: 0.5,
                      borderRadius: 1,
                      bgcolor: presentation?.colors.background,
                      color: presentation?.colors.color,
                    }}
                  >
                    <PreviewIcon
                      fontSize="small"
                      titleAccess={`${humanizeKey(model.iconKey ?? "")} icon`}
                    />
                  </Box>
                </Tooltip>
              )}
              <Typography variant="h6" component="h3">
                {model.title}
              </Typography>
            </Stack>

            {model.statuses.length > 0 && (
              <FormControl
                size="small"
                sx={{ width: { xs: "100%", sm: 200 }, flexShrink: 0 }}
              >
                <InputLabel id="work-item-type-preview-status-label">
                  Status
                </InputLabel>
                <Select
                  labelId="work-item-type-preview-status-label"
                  label="Status"
                  value={selectedStatus}
                  onChange={(event) =>
                    setSelectedStatus(event.target.value as WorkStatus)
                  }
                  data-testid="work-item-type-preview-status"
                >
                  {model.statuses.map((status) => (
                    <MenuItem key={status} value={status}>
                      {getStatusLabel(status)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Stack>

          {model.parentExamples.length > 0 && (
            <Box data-testid="work-item-type-preview-parent">
              <Typography variant="caption" color="text.secondary">
                Parent
              </Typography>
              <Stack
                direction="row"
                spacing={0.5}
                useFlexGap
                flexWrap="wrap"
                sx={{ mt: 0.5 }}
              >
                {model.parentExamples.map((parentExample) => (
                  <Chip
                    key={parentExample}
                    label={parentExample}
                    size="small"
                    variant="outlined"
                  />
                ))}
              </Stack>
            </Box>
          )}

          {model.scalarFields.length > 0 && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              {model.scalarFields.map((field) => (
                <Box key={field.key}>
                  <Typography variant="caption" color="text.secondary">
                    {field.label}
                  </Typography>
                  <Typography variant="body2">{field.value}</Typography>
                </Box>
              ))}
            </Stack>
          )}

          <Box
            data-testid="work-item-type-preview-columns"
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                lg: "minmax(0, 1.25fr) minmax(260px, 0.75fr)",
              },
              gap: { xs: 3, lg: 4 },
              alignItems: "start",
            }}
          >
            <Stack spacing={2.5} data-testid="work-item-type-preview-content">
              {model.sections.map((section) => (
                <Box
                  key={section.key}
                  data-testid="work-item-type-preview-section"
                  data-section-key={section.key}
                >
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    {section.label}
                  </Typography>
                  <Typography variant="body2">{section.content}</Typography>
                </Box>
              ))}
            </Stack>

            {(model.relationshipGroups.length > 0 || model.trackedByGoal) && (
              <Box
                sx={{
                  borderLeft: { lg: 1 },
                  borderTop: { xs: 1, lg: 0 },
                  borderColor: "divider",
                  pl: { lg: 3 },
                  pt: { xs: 2.5, lg: 0 },
                }}
              >
                <PreviewRelationships model={model} />
              </Box>
            )}
          </Box>
        </Stack>
      </Paper>

      {model.capabilities.length > 0 && (
        <Box data-testid="work-item-type-preview-capabilities">
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Capabilities
          </Typography>
          <Stack
            direction="row"
            spacing={0.5}
            useFlexGap
            flexWrap="wrap"
            sx={{ mt: 0.5 }}
          >
            {model.capabilities.map((capability) => (
              <Chip
                key={capability.key}
                label={`${capability.label}: ${
                  capability.enabled ? "Yes" : "No"
                }`}
                size="small"
                color={capability.enabled ? "success" : "default"}
                variant="outlined"
              />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
};

export const WorkItemTypeCreateProposalPresentation: React.FC<{
  definition: WorkItemTypeDefinitionDto;
  organizationId: string;
  projectId: string;
}> = ({ definition, organizationId, projectId }) => {
  const registry = useWorkItemTypes(organizationId, { projectId });
  const model = useMemo(
    () =>
      registry.isReady
        ? buildWorkItemTypeCreatePreviewModel(
            definition,
            registry.workItemTypes,
          )
        : null,
    [definition, registry.isReady, registry.workItemTypes],
  );

  if (!registry.isReady) {
    return (
      <Alert
        severity={registry.error ? "error" : "info"}
        data-testid="work-item-type-preview-unavailable"
      >
        {registry.error
          ? "The illustrative item is unavailable because the project type registry could not be resolved."
          : "Loading the project type registry before showing the illustrative item…"}
      </Alert>
    );
  }

  if (!model) {
    return (
      <Alert severity="error" data-testid="work-item-type-preview-unavailable">
        The illustrative item is unavailable because a referenced type is not
        present in the active project registry.
      </Alert>
    );
  }

  return (
    <WorkItemTypePreview
      key={`${definition.key}-${model.statuses.join("-") || "no-status"}`}
      model={model}
    />
  );
};
