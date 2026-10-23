import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import React, { useEffect, useMemo } from "react";
import type {
  RepositoryPlacementCompletionTarget,
  RepositoryPlacementLineageFeature,
  RepositoryPlacementReviewPayload,
  RepositoryPlacementReviewRoot,
  TaskResponseDto,
} from "../../../api";
import { FeaturePicker } from "../../Features/FeaturePicker";
import { useFeatureLookup } from "../../../data/hooks/useFeatureHierarchy";
import { useFeatureDocumentContent } from "../../../data/hooks/useFeatureDocumentContent";
import { FeatureListChildren } from "./FeatureListChildren";
import type {
  FieldComponentProps,
  RepositoryPlacementReviewValue,
} from "./types";

const isReviewPayload = (
  payload: unknown
): payload is RepositoryPlacementReviewPayload =>
  typeof payload === "object" &&
  payload !== null &&
  "roots" in payload &&
  Array.isArray(payload.roots);

const targetsMatch = (
  first: RepositoryPlacementCompletionTarget,
  second: RepositoryPlacementCompletionTarget
): boolean =>
  first.kind === second.kind &&
  (first.kind === "PROJECT_ROOT" ||
    (second.kind === "EXISTING_FEATURE" &&
      first.featureId === second.featureId));

const getKnownLineage = (
  payload: RepositoryPlacementReviewPayload,
  target: RepositoryPlacementCompletionTarget
): RepositoryPlacementLineageFeature[] | undefined => {
  if (target.kind === "PROJECT_ROOT") return [];

  for (const reviewRoot of payload.roots) {
    const targetIndex = reviewRoot.selectedParentLineage.findIndex(
      ({ featureId }) => featureId === target.featureId
    );
    if (targetIndex >= 0) {
      return reviewRoot.selectedParentLineage.slice(0, targetIndex + 1);
    }
  }

  return undefined;
};

type LineageLoadState =
  | { status: "loading" }
  | { status: "ready"; lineage: RepositoryPlacementLineageFeature[] }
  | { status: "error" };

function resolveCachedLineage(
  id: string,
  lookup: ReturnType<typeof useFeatureLookup>,
  entries: ReturnType<typeof useFeatureDocumentContent>["entries"]
): LineageLoadState {
  const ancestry = lookup.resolveAncestry(id);
  if (!ancestry.complete) return { status: "error" };
  const lineage: RepositoryPlacementLineageFeature[] = [];
  let loading = false;
  for (const feature of ancestry.ancestors) {
    const entry = entries.get(feature.id);
    if (
      entry?.status === "error" ||
      (entry?.status === "ready" && !entry.data.tag)
    )
      return { status: "error" };
    if (!entry?.data?.tag) {
      loading = true;
      continue;
    }
    const parentId = lookup.get(feature.id)?.parentTaskId;
    lineage.push({
      featureId: feature.id,
      name: feature.name,
      tag: entry.data.tag,
      ...(parentId ? { parentFeatureId: parentId } : {}),
    });
  }
  return loading ? { status: "loading" } : { status: "ready", lineage };
}

const ContextNode: React.FC<{
  name: string;
  tag?: string;
  kind: "existing" | "proposed" | "child" | "project";
}> = ({ name, tag, kind }) => (
  <Box
    data-testid={`repository-placement-${kind}-node`}
    sx={(theme) => ({
      border: "1px solid",
      borderColor:
        kind === "proposed"
          ? theme.palette.primary.main
          : theme.palette.divider,
      borderRadius: 1.5,
      px: 1.5,
      py: 1,
      bgcolor:
        kind === "proposed"
          ? theme.palette.action.selected
          : "background.paper",
    })}
  >
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant={kind === "proposed" ? "subtitle2" : "body2"}>
        {name}
      </Typography>
      {tag && <Chip label={tag} size="small" variant="outlined" />}
    </Stack>
  </Box>
);

const TreeConnector = () => (
  <Box sx={{ display: "flex", alignItems: "center", pl: 1 }} aria-hidden="true">
    <ChevronRightIcon color="disabled" sx={{ transform: "rotate(90deg)" }} />
  </Box>
);

const RootReview: React.FC<{
  review: RepositoryPlacementReviewRoot;
  target: RepositoryPlacementCompletionTarget;
  lineage: RepositoryPlacementLineageFeature[];
  lineageStatus: LineageLoadState["status"];
  readOnly: boolean;
  organizationId: string;
  projectId: string;
  onSelect: (featureId: string | null, feature?: TaskResponseDto) => void;
}> = ({
  review,
  target,
  lineage,
  lineageStatus,
  readOnly,
  organizationId,
  projectId,
  onSelect,
}) => (
  <Card
    variant="outlined"
    data-testid="repository-placement-review-root"
    data-root-key={review.root.rootKey}
  >
    <CardContent>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ sm: "flex-start" }}
        >
          <FeaturePicker
            organizationId={organizationId}
            projectId={projectId}
            label={`Parent for ${review.root.name}`}
            helperText="Choose an existing Feature, or place this root at Project root."
            value={target.kind === "EXISTING_FEATURE" ? target.featureId : null}
            onChange={onSelect}
            disabled={readOnly}
            searchable
          />
          <Button
            variant="outlined"
            disabled={readOnly || target.kind === "PROJECT_ROOT"}
            onClick={() => onSelect(null)}
            data-testid="repository-placement-project-root"
            data-root-key={review.root.rootKey}
            sx={{ whiteSpace: "nowrap", mt: { sm: 1 } }}
          >
            Project root
          </Button>
        </Stack>

        <Divider />

        <Stack spacing={0.25} data-testid="repository-placement-context-tree">
          {lineageStatus === "loading" ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Loading complete parent lineage…
              </Typography>
            </Stack>
          ) : lineageStatus === "error" ? (
            <Typography variant="body2" color="error">
              Complete parent lineage is unavailable.
            </Typography>
          ) : lineage.length === 0 ? (
            <ContextNode name="Project root" kind="project" />
          ) : (
            lineage.map((feature, index) => (
              <React.Fragment key={feature.featureId}>
                {index > 0 && <TreeConnector />}
                <ContextNode
                  name={feature.name}
                  tag={feature.tag}
                  kind="existing"
                />
              </React.Fragment>
            ))
          )}
          <TreeConnector />
          <ContextNode
            name={review.root.name}
            tag={review.root.tag}
            kind="proposed"
          />
          <FeatureListChildren
            items={review.root.children.map((child) => ({
              id: child.childKey,
              name: child.name,
              description: child.description,
            }))}
          />
        </Stack>
      </Stack>
    </CardContent>
  </Card>
);

export const RepositoryPlacementReviewField: React.FC<
  FieldComponentProps<RepositoryPlacementReviewValue>
> = ({
  config,
  value,
  onChange,
  onValidityChange,
  disabled,
  isSubmitted,
  context,
}) => {
  const payload = isReviewPayload(config.payload) ? config.payload : undefined;
  const lookup = useFeatureLookup(context.organizationId, context.projectId);
  const overridesByRoot = useMemo(
    () =>
      new Map(
        (value?.payload.overrides ?? []).map((override) => [
          override.rootKey,
          override.target,
        ])
      ),
    [value]
  );
  const readOnly = disabled || isSubmitted;

  const lineageIds = useMemo(
    () => [
      ...new Set(
        [...overridesByRoot.values()].flatMap((target) =>
          target.kind === "EXISTING_FEATURE" &&
          payload &&
          !getKnownLineage(payload, target)
            ? [target.featureId]
            : []
        )
      ),
    ],
    [overridesByRoot, payload]
  );
  const requestedIds = [
    ...new Set(
      lineageIds.flatMap((id) =>
        lookup.resolveAncestry(id).ancestors.map((feature) => feature.id)
      )
    ),
  ];
  const { entries } = useFeatureDocumentContent(
    context.organizationId,
    context.projectId,
    requestedIds,
    undefined,
    "metadata"
  );
  const loadedLineages = useMemo(() => {
    const result: Record<string, LineageLoadState> = {};
    for (const id of lineageIds) {
      result[id] = lookup.isLoading
        ? { status: "loading" }
        : resolveCachedLineage(id, lookup, entries);
    }
    return result;
  }, [lineageIds, lookup, entries]);

  useEffect(() => {
    if (!payload) {
      onValidityChange?.("invalid");
      return;
    }

    let validity: "valid" | "loading" | "invalid" = "valid";
    for (const review of payload.roots) {
      const target =
        overridesByRoot.get(review.root.rootKey) ?? review.selectedParent;
      if (target.kind === "PROJECT_ROOT" || getKnownLineage(payload, target)) {
        continue;
      }
      const loadState = loadedLineages[target.featureId];
      if (loadState?.status === "error") {
        validity = "invalid";
        break;
      }
      if (loadState?.status !== "ready") validity = "loading";
    }
    onValidityChange?.(validity);
  }, [loadedLineages, onValidityChange, overridesByRoot, payload]);

  if (!payload) {
    return (
      <Typography color="error" data-testid="repository-placement-review-error">
        Placement review is unavailable.
      </Typography>
    );
  }

  const changeParent = (rootKey: string, featureId: string | null) => {
    if (!value) return;
    const target: RepositoryPlacementCompletionTarget = featureId
      ? { kind: "EXISTING_FEATURE", featureId }
      : { kind: "PROJECT_ROOT" };
    onChange?.({
      ...value,
      payload: {
        ...value.payload,
        overrides: value.payload.overrides.map((override) =>
          override.rootKey === rootKey ? { ...override, target } : override
        ),
      },
    });
  };

  return (
    <Stack spacing={2.5} data-testid="repository-placement-review">
      <Box>
        <Typography variant="h6">Review intelligent placement</Typography>
        <Typography variant="body2" color="text.secondary">
          Only proposed root Features can be moved. Their discovered children
          stay attached until final approval.
        </Typography>
      </Box>
      {payload.roots.map((review) => {
        const target =
          overridesByRoot.get(review.root.rootKey) ?? review.selectedParent;
        const knownLineage = targetsMatch(target, review.selectedParent)
          ? review.selectedParentLineage
          : getKnownLineage(payload, target);
        const loadedLineage =
          target.kind === "EXISTING_FEATURE"
            ? loadedLineages[target.featureId]
            : undefined;
        const lineage =
          knownLineage ??
          (loadedLineage?.status === "ready" ? loadedLineage.lineage : []);
        const lineageStatus = knownLineage
          ? "ready"
          : loadedLineage?.status ?? "loading";
        return (
          <RootReview
            key={review.root.rootKey}
            review={review}
            target={target}
            lineage={lineage}
            lineageStatus={lineageStatus}
            readOnly={readOnly}
            organizationId={context.organizationId}
            projectId={context.projectId}
            onSelect={(featureId) =>
              changeParent(review.root.rootKey, featureId)
            }
          />
        );
      })}
    </Stack>
  );
};
