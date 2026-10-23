import { Box, CircularProgress, Stack, Typography } from "@mui/material";
import React, { Suspense, lazy, useMemo } from "react";
import {
  type EntityType,
  FeatureHierarchyEntryDtoRelationshipEnum,
  FeatureHierarchyEntryDtoRelationshipTypeEnum,
  ProposalAction,
  type ProposalResponseDto,
  type ProposalUpdates,
} from "../../api";
import { useFeatureLookup } from "../../data/hooks/useFeatureHierarchy";
import { useFullEntityContext } from "../../data/hooks/useFullEntityContext";
import { CardHeader } from "../CardHeader/CardHeader";

const FeatureTreeVisualization = lazy(
  () => import("../Features/FeatureTreeVisualization")
);

export interface ProposalPlacementBlockProps {
  organizationId: string;
  projectId: string;
  proposal: ProposalResponseDto;
}

const hasParentTaskId = (
  updates: ProposalUpdates
): updates is ProposalUpdates & { parentTaskId: string } => {
  if (!updates || typeof updates !== "object") return false;
  const candidate = (updates as { parentTaskId?: unknown }).parentTaskId;
  return typeof candidate === "string" && candidate.length > 0;
};

export const ProposalPlacementBlock: React.FC<ProposalPlacementBlockProps> = ({
  organizationId,
  projectId,
  proposal,
}) => {
  const isCreate = proposal.action === ProposalAction.Create;
  const isUpdate = proposal.action === ProposalAction.Update;

  const createParentFeatureId = useMemo(
    () =>
      isCreate && hasParentTaskId(proposal.updates)
        ? proposal.updates.parentTaskId
        : undefined,
    [isCreate, proposal.updates]
  );

  // Feature targets read their parent from the cached hierarchy; other
  // targets keep the entity-context read. `null` means the cache cannot
  // answer; `undefined` means the cached feature has no parent.
  const featureLookup = useFeatureLookup(organizationId, projectId);
  const cachedTarget =
    isUpdate && proposal.targetEntityId
      ? featureLookup.get(proposal.targetEntityId)
      : undefined;
  const cachedParentFeatureId =
    cachedTarget &&
    (!cachedTarget.parentTaskId || featureLookup.get(cachedTarget.parentTaskId))
      ? (cachedTarget.parentTaskId ?? undefined)
      : null;
  const needsTargetContext =
    isUpdate && !featureLookup.isLoading && cachedParentFeatureId === null;

  const { data: targetContext, isLoading: isTargetContextLoading } =
    useFullEntityContext({
      organizationId,
      projectId,
      entityType: proposal.targetEntityType as unknown as EntityType,
      entityId: proposal.targetEntityId,
      includeFeatureHierarchy: true,
      enabled: needsTargetContext,
    });

  const updateParentFeatureId = useMemo(() => {
    if (!isUpdate) return undefined;
    if (cachedParentFeatureId !== null) return cachedParentFeatureId;
    const hierarchy = targetContext?.featureHierarchy ?? [];
    const ancestors = hierarchy
      .filter(
        (entry) =>
          entry.relationshipType ===
            FeatureHierarchyEntryDtoRelationshipTypeEnum.Structural &&
          entry.relationship ===
            FeatureHierarchyEntryDtoRelationshipEnum.Ancestor
      )
      .slice()
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return ancestors[0]?.id;
  }, [cachedParentFeatureId, isUpdate, targetContext?.featureHierarchy]);

  const parentFeatureId = isCreate
    ? createParentFeatureId
    : updateParentFeatureId;

  const isLoading =
    isUpdate &&
    cachedParentFeatureId === null &&
    (featureLookup.isLoading || (isTargetContextLoading && !targetContext));

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
      }}
      data-testid="proposal-placement-block"
    >
      <Stack spacing={1.25} sx={{ minWidth: 0 }}>
        <CardHeader title="Feature Tree" />
        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        ) : parentFeatureId ? (
          <Box
            sx={{
              position: "relative",
              width: "100%",
              overflowX: "auto",
              overflowY: "hidden",
            }}
          >
            <Suspense fallback={<CircularProgress />}>
              <FeatureTreeVisualization
                organizationId={organizationId}
                projectId={projectId}
                focusedFeatureId={parentFeatureId}
                activeFeatureId={parentFeatureId}
                fillHeight={false}
              />
            </Suspense>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No parent feature.
          </Typography>
        )}
      </Stack>
    </Box>
  );
};

ProposalPlacementBlock.displayName = "ProposalPlacementBlock";
