import { Box, Chip, Stack, Tooltip, Typography } from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import React from "react";
import {
  type ProposalEdgeDeclaration,
  type ProposalResponseDto,
  ProposalEdgeTargetType,
  ProposalEdgeType,
  ProposalStatus,
} from "../../api";
import { EntityLinkWithPreview } from "../Entity";
import { getProposalDisplayTitle } from "./getProposalDisplayTitle";
import { staticProposalEntityTypePresentation } from "./proposalHeaderType";
import { isPlaceholderEntityId } from "./types";

const EDGE_TYPE_LABELS: Record<string, string> = {
  [ProposalEdgeType.DependsOn]: "depends on",
  [ProposalEdgeType.Blocks]: "blocks",
  [ProposalEdgeType.RelatedTo]: "relates to",
  [ProposalEdgeType.Supersedes]: "supersedes",
  [ProposalEdgeType.DerivesFrom]: "derives from",
  [ProposalEdgeType.Contradicts]: "contradicts",
  EVOLVES: "evolves",
};

export const edgeTypeLabel = (edgeType: string): string =>
  EDGE_TYPE_LABELS[edgeType] ?? "relates to";

const formatTargetEntityType = (entityType: string): string =>
  entityType
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");

type DerivedEdgeStatus = "pending" | "materialized" | "cancelled";

const deriveEdgeStatus = (
  edge: ProposalEdgeDeclaration,
  targetProposal: ProposalResponseDto | undefined
): DerivedEdgeStatus => {
  if (edge.targetEntityType !== ProposalEdgeTargetType.Proposal) {
    return "materialized";
  }
  if (!targetProposal) return "pending";
  if (targetProposal.status === ProposalStatus.Approved) return "materialized";
  if (targetProposal.status === ProposalStatus.Rejected) return "cancelled";
  return "pending";
};

const STATUS_CONFIG: Record<
  DerivedEdgeStatus,
  {
    icon: React.ReactElement;
    color: "default" | "success" | "error";
    tooltip: string;
  }
> = {
  pending: {
    icon: <HourglassEmptyIcon fontSize="inherit" />,
    color: "default",
    tooltip: "Waiting — target proposal not yet accepted",
  },
  materialized: {
    icon: <CheckCircleOutlineIcon fontSize="inherit" />,
    color: "success",
    tooltip: "Resolved — both proposals accepted",
  },
  cancelled: {
    icon: <RemoveCircleOutlineIcon fontSize="inherit" />,
    color: "error",
    tooltip: "Cancelled — target proposal was rejected",
  },
};

const resolveTargetTitle = (
  edge: ProposalEdgeDeclaration,
  siblingProposals: Map<string, ProposalResponseDto>
): string => {
  if (edge.targetEntityTitle) return edge.targetEntityTitle;
  if (edge.targetEntityType !== ProposalEdgeTargetType.Proposal) {
    return `${formatTargetEntityType(edge.targetEntityType)} name unavailable`;
  }
  const target = siblingProposals.get(edge.targetEntityId);
  if (!target) return "Related proposal unavailable";
  return getProposalDisplayTitle(target);
};

const resolveTargetEntityPath = (
  edge: ProposalEdgeDeclaration,
  targetProposal: ProposalResponseDto | undefined
): { entityId: string; entityType: string } | null => {
  if (edge.targetEntityType !== ProposalEdgeTargetType.Proposal) {
    return { entityId: edge.targetEntityId, entityType: edge.targetEntityType };
  }
  if (!targetProposal) return null;
  if (targetProposal.status !== ProposalStatus.Approved) return null;
  if (isPlaceholderEntityId(targetProposal.targetEntityId)) return null;
  return {
    entityId: targetProposal.targetEntityId,
    entityType: targetProposal.targetEntityType,
  };
};

export interface ProposalEdgesProps {
  edges: ProposalEdgeDeclaration[] | undefined;
  siblingProposals: Map<string, ProposalResponseDto>;
  organizationId: string;
  projectId: string;
  /** Whether the owning proposal has been applied (affects status display). */
  ownerApplied?: boolean;
  onNavigateToEntity?: (entityType: string, entityId: string) => void;
  /**
   * Labels the source of each edge (the Diagram or one of its elements) for
   * graph-shaped proposals. Omitted for single-entity proposals.
   */
  resolveSourceLabel?: (edge: ProposalEdgeDeclaration) => string;
}

/**
 * Displays declared edges on a proposal card. Returns null when there
 * are no edges so the parent can skip rendering an empty section.
 */
export const ProposalEdges: React.FC<ProposalEdgesProps> = ({
  edges,
  siblingProposals,
  organizationId,
  projectId,
  ownerApplied,
  onNavigateToEntity,
  resolveSourceLabel,
}) => {
  if (!edges || edges.length === 0) return null;

  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}
      >
        <LinkIcon fontSize="inherit" />
        Relationships
      </Typography>
      <Stack spacing={0.5}>
        {edges.map((edge, idx) => {
          const targetProposal =
            edge.targetEntityType === ProposalEdgeTargetType.Proposal
              ? siblingProposals.get(edge.targetEntityId)
              : undefined;
          const status = ownerApplied
            ? deriveEdgeStatus(edge, targetProposal)
            : "pending";
          const config = STATUS_CONFIG[status];
          const title = resolveTargetTitle(edge, siblingProposals);
          const resolved = resolveTargetEntityPath(edge, targetProposal);
          const isCancelled = status === "cancelled";
          const previewEntityType =
            resolved?.entityType ?? edge.targetEntityType;
          const previewEntityId = resolved?.entityId ?? edge.targetEntityId;
          const typePresentation =
            staticProposalEntityTypePresentation(previewEntityType);
          const PreviewIcon =
            typePresentation.kind === "available"
              ? typePresentation.Icon
              : null;
          const previewColors =
            typePresentation.kind === "available"
              ? typePresentation.colors
              : undefined;
          const targetPreview = (
            <Stack
              direction="row"
              spacing={0.75}
              alignItems="center"
              sx={{ minWidth: 0 }}
            >
              {PreviewIcon && (
                <Box
                  aria-hidden
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    borderRadius: 0.5,
                    bgcolor: previewColors?.background ?? "action.hover",
                    color: previewColors?.color ?? "text.secondary",
                  }}
                >
                  <PreviewIcon sx={{ fontSize: 14 }} />
                </Box>
              )}
              {resolved ? (
                <EntityLinkWithPreview
                  label={title}
                  entityId={previewEntityId}
                  entityType={previewEntityType}
                  organizationId={organizationId}
                  projectId={projectId}
                  sx={{
                    textDecoration: isCancelled ? "line-through" : "none",
                    opacity: isCancelled ? 0.6 : 1,
                  }}
                />
              ) : (
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 500,
                    textDecoration: isCancelled ? "line-through" : "none",
                    opacity: isCancelled ? 0.6 : 1,
                  }}
                >
                  {title}
                </Typography>
              )}
            </Stack>
          );

          return (
            <Stack
              key={`${edge.targetEntityId}-${edge.edgeType}-${idx}`}
              direction="row"
              spacing={0.75}
              alignItems="center"
              sx={{ pl: 0.5 }}
            >
              {ownerApplied && (
                <Tooltip title={config.tooltip} arrow>
                  {status === "materialized" ? (
                    <Box
                      component="span"
                      role="img"
                      aria-label="Resolved"
                      data-testid="proposal-edge-resolved"
                      sx={{ display: "inline-flex", color: "success.main" }}
                    >
                      {config.icon}
                    </Box>
                  ) : (
                    <Chip
                      icon={config.icon}
                      label={config.tooltip.split("—")[0].trim()}
                      size="small"
                      color={config.color}
                      variant="outlined"
                      sx={{
                        height: 22,
                        "& .MuiChip-label": { px: 0.75, fontSize: "0.7rem" },
                      }}
                    />
                  )}
                </Tooltip>
              )}
              {resolveSourceLabel && (
                <Typography
                  variant="body2"
                  data-testid="proposal-edge-source"
                  sx={{
                    fontWeight: 500,
                    textDecoration: isCancelled ? "line-through" : "none",
                    opacity: isCancelled ? 0.6 : 1,
                  }}
                >
                  {resolveSourceLabel(edge)}
                </Typography>
              )}
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  textDecoration: isCancelled ? "line-through" : "none",
                  opacity: isCancelled ? 0.6 : 1,
                }}
              >
                {edgeTypeLabel(edge.edgeType)}
              </Typography>
              {resolved && onNavigateToEntity ? (
                <Box
                  onClick={() =>
                    onNavigateToEntity(resolved.entityType, resolved.entityId)
                  }
                >
                  {targetPreview}
                </Box>
              ) : (
                targetPreview
              )}
              {edge.description && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontStyle: "italic" }}
                >
                  — {edge.description}
                </Typography>
              )}
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
};
