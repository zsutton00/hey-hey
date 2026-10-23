import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { Link as RouterLink } from "react-router-dom";
import { useWorkItemTypes } from "@hey-hey/ui-common/data";
import {
  useProjectCapabilities,
  useUserIdentity,
} from "@hey-hey/ui-common/hooks";
import {
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
} from "@hey-hey/ui-common/api";
import type { WorkItemTypeSummaryDto } from "@hey-hey/ui-common/api";

export interface WorkItemTypesListProps {
  projectId: string;
}

const compareDefinitions = (
  left: WorkItemTypeSummaryDto,
  right: WorkItemTypeSummaryDto,
): number => {
  const leftName = left.definition.name.trim().toLowerCase();
  const rightName = right.definition.name.trim().toLowerCase();
  if (leftName < rightName) return -1;
  if (leftName > rightName) return 1;

  const leftKey = left.definition.key;
  const rightKey = right.definition.key;
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return 0;
};

const getProjectWorkItemTypes = (
  summaries: readonly WorkItemTypeSummaryDto[],
  projectId: string,
  showArchived: boolean,
): WorkItemTypeSummaryDto[] => {
  const ownedProjectId = projectId.trim();

  if (!ownedProjectId) return [];

  return summaries
    .filter(
      (summary) =>
        summary.projectId === ownedProjectId &&
        (summary.status === WorkItemTypeLifecycleStatus.Active ||
          (showArchived &&
            summary.status === WorkItemTypeLifecycleStatus.Archived)),
    )
    .sort(compareDefinitions);
};

const renderProvenanceChips = (
  effectiveSource: WorkItemTypeSummaryDto["effectiveSource"],
): React.ReactNode => {
  switch (effectiveSource) {
    case WorkItemTypeEffectiveSource.Canonical:
      return <Chip label="Base" size="small" variant="outlined" />;
    case WorkItemTypeEffectiveSource.CanonicalOverride:
      return (
        <>
          <Chip label="Base" size="small" variant="outlined" />
          <Chip label="Customized" size="small" variant="outlined" />
        </>
      );
    case WorkItemTypeEffectiveSource.ProjectCustom:
      return <Chip label="Custom" size="small" variant="outlined" />;
    default:
      return null;
  }
};

export const WorkItemTypesList: React.FC<WorkItemTypesListProps> = ({
  projectId,
}) => {
  const { currentOrgId } = useUserIdentity() || {};
  const { manageWorkItemTypes } = useProjectCapabilities(
    currentOrgId,
    projectId,
  );
  const [showArchived, setShowArchived] = React.useState(false);
  const { workItemTypes, isLoading, error } = useWorkItemTypes(currentOrgId, {
    projectId,
  });
  const hasProjectContext = Boolean(currentOrgId && projectId.trim());
  const visibleProjectTypes = getProjectWorkItemTypes(
    workItemTypes,
    projectId,
    showArchived,
  );

  const renderType = (type: WorkItemTypeSummaryDto): React.ReactNode => {
    const secondary =
      type.definition.description ||
      `${type.definition.sections.length} section${type.definition.sections.length !== 1 ? "s" : ""}`;

    return (
      <Card key={type.definition.key} variant="outlined">
        <CardActionArea
          component={RouterLink}
          to={`/projects/${projectId}/work-item-types/${encodeURIComponent(type.definition.key)}/edit`}
          data-testid={`work-item-type-edit-${type.definition.key}`}
        >
          <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              useFlexGap
              flexWrap="wrap"
            >
              <Typography variant="subtitle2">
                {type.definition.name}
              </Typography>
              <Chip
                label={
                  type.status === WorkItemTypeLifecycleStatus.Active
                    ? "Active"
                    : "Archived"
                }
                size="small"
                color={
                  type.status === WorkItemTypeLifecycleStatus.Active
                    ? "success"
                    : "default"
                }
                variant="outlined"
              />
              {renderProvenanceChips(type.effectiveSource)}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {secondary}
            </Typography>
          </CardContent>
        </CardActionArea>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <Box
        sx={{ display: "flex", justifyContent: "center", p: 4 }}
        data-testid="work-item-types-loading"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!hasProjectContext) {
    return (
      <Alert severity="error" data-testid="work-item-types-missing-ownership">
        Work Item Types cannot be shown until the organization and project
        ownership are available.
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert severity="error" data-testid="work-item-types-load-error">
        Failed to load work item types. Please try again later.
      </Alert>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <FormControlLabel
          control={
            <Switch
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
          }
          label="Show Archived"
        />
        {manageWorkItemTypes ? (
          <Button
            component={RouterLink}
            to={`/projects/${projectId}/work-item-types/new`}
            size="small"
            startIcon={<AddIcon />}
            variant="contained"
            data-testid="work-item-type-create"
          >
            Create New Custom Type
          </Button>
        ) : null}
      </Box>
      {visibleProjectTypes.length === 0 ? (
        <Box
          sx={{ p: 3, textAlign: "center" }}
          data-testid="work-item-types-empty"
        >
          <Typography variant="body2" color="text.secondary">
            No project-owned work item types have been defined yet.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1} data-testid="work-item-types-list">
          {visibleProjectTypes.map(renderType)}
        </Stack>
      )}
    </Stack>
  );
};
