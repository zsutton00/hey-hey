import React, { useCallback, useMemo } from "react";
import {
  Box,
  Button,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  TargetEntityType,
  TaskSource,
  WorkStatus,
  type FeatureHierarchyEntryDto,
} from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import {
  FeatureHierarchyEntryDtoDirectionEnum,
  FeatureHierarchyEntryDtoRelationshipTypeEnum,
} from "../../api";
import { InteractionComponent } from "../InteractionComponent";
import { FeatureTreeNode } from "./FeatureTreeNode";
import { FeatureTagDot } from "./FeatureTagDot";

const RELATED_NODE_WIDTH = 220;

const RELATIONSHIP_LABELS: Record<string, string> = {
  [FeatureHierarchyEntryDtoRelationshipTypeEnum.RelatedTo]: "Related",
  [FeatureHierarchyEntryDtoRelationshipTypeEnum.DependsOn]: "Depends on",
  [FeatureHierarchyEntryDtoRelationshipTypeEnum.DerivesFrom]: "Derives from",
  [FeatureHierarchyEntryDtoRelationshipTypeEnum.Supersedes]: "Supersedes",
  [FeatureHierarchyEntryDtoRelationshipTypeEnum.Contradicts]: "Contradicts",
  [FeatureHierarchyEntryDtoRelationshipTypeEnum.Evolves]: "Evolves",
};

function entryToFeature(entry: FeatureHierarchyEntryDto): WorkItemResponseDto {
  return {
    id: entry.id,
    name: entry.name,
    type: "FEATURE",
    organizationId: "",
    projectId: "",
    status: WorkStatus.Backlog,
    source: TaskSource.User,
    parentTaskId: entry.parentTaskId ?? undefined,
    tag: entry.tag,
  };
}

interface RelatedFeatureNodeProps {
  entry: FeatureHierarchyEntryDto;
  feature: WorkItemResponseDto;
  organizationId: string;
  projectId: string;
  onNodeClick: (featureId: string, event: React.MouseEvent) => void;
  getFeatureHref: (featureId: string) => string;
  descendantsOfActive: Set<string>;
  errorMap: Map<string, string>;
  onClearError: (featureId: string) => void;
  onReparentDrop: (draggedFeatureId: string, targetFeatureId: string) => void;
  inLocalTree: boolean;
}

const RelatedFeatureNode: React.FC<RelatedFeatureNodeProps> = ({
  entry,
  feature,
  organizationId,
  projectId,
  onNodeClick,
  getFeatureHref,
  descendantsOfActive,
  errorMap,
  onClearError,
  onReparentDrop,
  inLocalTree,
}) => {
  const handleClearError = useCallback(
    () => onClearError(feature.id),
    [onClearError, feature.id],
  );

  const tooltipTitle = entry.reasoning ?? "";

  const directionLabel =
    entry.direction === FeatureHierarchyEntryDtoDirectionEnum.Outbound
      ? "outbound"
      : entry.direction === FeatureHierarchyEntryDtoDirectionEnum.Inbound
        ? "inbound"
        : "";

  const edgeTypeLabel =
    RELATIONSHIP_LABELS[entry.relationshipType] ?? entry.relationshipType;

  const labelLine = (
    <Box
      data-testid={`related-feature-edge-label-${entry.id}`}
      data-edge-type={entry.relationshipType}
      data-edge-direction={directionLabel}
      aria-label={`${edgeTypeLabel} (${directionLabel})`}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.5,
        mb: 0.5,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {directionLabel ? `${directionLabel} · ` : ""}
        {edgeTypeLabel}
      </Typography>
    </Box>
  );

  const card = inLocalTree ? (
    <InteractionComponent
      entityId={feature.id}
      entityType={TargetEntityType.Task}
      entitySubtype={feature.type}
      hasProposalSupport
      organizationId={organizationId}
      projectId={projectId}
      entityTitle={feature.name}
      draggable={false}
    >
      <FeatureTreeNode
        feature={feature}
        isHighlighted={false}
        isActive={false}
        hasChildren={false}
        isCollapsed={false}
        taskCount={0}
        onToggleCollapse={() => {}}
        onClick={onNodeClick}
        href={getFeatureHref(feature.id)}
        descendantsOfActive={descendantsOfActive}
        errorMessage={errorMap.get(feature.id)}
        onClearError={handleClearError}
        onReparentDrop={onReparentDrop}
      />
    </InteractionComponent>
  ) : (
    <Box
      component="a"
      href={getFeatureHref(feature.id)}
      onClick={(e) => onNodeClick(feature.id, e)}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        width: RELATED_NODE_WIDTH,
        px: 1.5,
        py: 1,
        borderRadius: 1,
        border: 2,
        borderColor: "divider",
        borderStyle: "dashed",
        backgroundColor: "background.paper",
        textDecoration: "none",
        color: "inherit",
        cursor: "pointer",
        "&:hover": { borderColor: "primary.light" },
      }}
    >
      <FeatureTagDot tag={feature.tag ?? null} />
      <Typography
        variant="body2"
        sx={{
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {feature.name}
      </Typography>
    </Box>
  );

  const content = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        flexShrink: 0,
        width: RELATED_NODE_WIDTH,
      }}
      data-testid={`related-feature-node-${entry.id}`}
    >
      {labelLine}
      {card}
    </Box>
  );

  if (tooltipTitle) {
    return (
      <Tooltip title={tooltipTitle} arrow placement="top">
        {content}
      </Tooltip>
    );
  }

  return content;
};

export interface RelatedFeatureAttachmentProps {
  entries: FeatureHierarchyEntryDto[];
  allFeatures: WorkItemResponseDto[];
  organizationId: string;
  projectId: string;
  onNodeClick: (featureId: string, event: React.MouseEvent) => void;
  getFeatureHref: (featureId: string) => string;
  descendantsOfActive: Set<string>;
  errorMap: Map<string, string>;
  onClearError: (featureId: string) => void;
  onReparentDrop: (draggedFeatureId: string, targetFeatureId: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export const RelatedFeatureAttachment: React.FC<
  RelatedFeatureAttachmentProps
> = ({
  entries,
  allFeatures,
  organizationId,
  projectId,
  onNodeClick,
  getFeatureHref,
  descendantsOfActive,
  errorMap,
  onClearError,
  onReparentDrop,
  expanded,
  onToggleExpanded,
}) => {
  const anchorRef = React.useRef<HTMLButtonElement | null>(null);
  const featureLookup = useMemo(() => {
    const map = new Map<string, WorkItemResponseDto>();
    for (const f of allFeatures) {
      map.set(f.id, f);
    }
    return map;
  }, [allFeatures]);

  if (entries.length === 0) return null;

  return (
    <>
      <Button
        ref={anchorRef}
        type="button"
        size="small"
        data-testid="related-feature-attachment"
        aria-expanded={expanded}
        aria-controls="related-feature-attachment-panel"
        onClick={onToggleExpanded}
        sx={{
          alignSelf: "flex-start",
          minWidth: 0,
          textTransform: "none",
        }}
      >
        {entries.length} related
      </Button>
      <Popover
        open={expanded}
        anchorEl={anchorRef.current}
        onClose={onToggleExpanded}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <Stack
          id="related-feature-attachment-panel"
          data-testid="related-feature-attachment-panel"
          spacing={1}
          sx={{
            p: 1.5,
            maxWidth: 360,
            maxHeight: 420,
            overflow: "auto",
          }}
        >
          {entries.map((entry) => {
            const local = featureLookup.get(entry.id);
            const feature = local ?? entryToFeature(entry);
            return (
              <RelatedFeatureNode
                key={entry.id}
                entry={entry}
                feature={feature}
                organizationId={organizationId}
                projectId={projectId}
                onNodeClick={onNodeClick}
                getFeatureHref={getFeatureHref}
                descendantsOfActive={descendantsOfActive}
                errorMap={errorMap}
                onClearError={onClearError}
                onReparentDrop={onReparentDrop}
                inLocalTree={!!local}
              />
            );
          })}
        </Stack>
      </Popover>
    </>
  );
};
