import {
  Box,
  Typography,
  List,
  ListItem,
  CircularProgress,
  Alert,
  Chip,
  Stack,
  Paper,
  Link,
} from "@mui/material";
import React from "react";
import { useNavigate } from "react-router-dom";
import type {
  TopologyEntitySummaryDto,
  TopologyEntitySummarySubfacetDto,
} from "@hey-hey/ui-common/api";
import { WebPathService } from "@hey-hey/ui-common";

export interface EntityListProps {
  projectId: string;
  entitySummaries: TopologyEntitySummaryDto[];
  isLoading: boolean;
  error: Error | null;
  onSubfacetClick: (subfacetId: string) => void;
}

const getEntityUrl = (
  projectId: string,
  entityType: string,
  entityId: string,
): string => {
  switch (entityType) {
    case "TASK":
      // Tasks require initiativeId which we don't have here,
      // so we use the simplified path
      return WebPathService.task({ projectId, taskId: entityId });
    case "DESIGN_DOC":
      return WebPathService.designDoc({ projectId, designDocId: entityId });
    case "INITIATIVE":
      return WebPathService.initiativeDetail({
        projectId,
        initiativeId: entityId,
      });
    case "AGENT_SESSION":
      return WebPathService.agentSession({
        projectId,
        agentSessionId: entityId,
      });
    case "SERVICE":
      // WebPathService doesn't have a service method yet, use simple path
      return `/projects/${projectId}/services/${entityId}`;
    default:
      return "#";
  }
};

export const EntityList: React.FC<EntityListProps> = ({
  projectId,
  entitySummaries,
  isLoading,
  error,
  onSubfacetClick,
}) => {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        Failed to load entities. Please try again later.
      </Alert>
    );
  }

  if (entitySummaries.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          No entities available for this subfacet.
        </Typography>
      </Box>
    );
  }

  return (
    <List>
      {entitySummaries.map((entity) => {
        const entityUrl = getEntityUrl(
          projectId,
          entity.entityType,
          entity.entityId,
        );
        return (
          <ListItem key={entity.entityId}>
            <Paper
              component="a"
              href={entityUrl}
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                // Allow Ctrl+click, middle-click, right-click to work normally
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  navigate(entityUrl);
                }
              }}
              sx={{
                p: 2,
                width: "100%",
                textDecoration: "none",
                cursor: "pointer",
                transition: "background-color 0.2s",
                "&:hover": {
                  backgroundColor: "action.hover",
                },
              }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    label={entity.entityType}
                    size="small"
                    variant="outlined"
                  />
                  <Typography variant="caption" color="text.disabled">
                    {entity.entityId}
                  </Typography>
                </Stack>
                <Typography variant="body1">{entity.summary}</Typography>

                {/* Display subfacets as clickable links */}
                {entity.subfacets && entity.subfacets.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mb: 0.5 }}
                    >
                      Related subfacets:
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      flexWrap="wrap"
                      useFlexGap
                    >
                      {entity.subfacets.map(
                        (subfacet: TopologyEntitySummarySubfacetDto) => (
                          <Link
                            key={subfacet.id}
                            component="button"
                            variant="caption"
                            onClick={(
                              e: React.MouseEvent<HTMLButtonElement>,
                            ) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onSubfacetClick(subfacet.id);
                            }}
                            sx={{
                              cursor: "pointer",
                              textDecoration: "underline",
                              color: "primary.main",
                              "&:hover": {
                                color: "primary.dark",
                              },
                            }}
                          >
                            {subfacet.name}
                          </Link>
                        ),
                      )}
                    </Stack>
                  </Box>
                )}

                <Typography variant="caption" color="text.disabled">
                  Updated: {new Date(entity.updatedAt).toLocaleDateString()}
                </Typography>
              </Stack>
            </Paper>
          </ListItem>
        );
      })}
    </List>
  );
};
