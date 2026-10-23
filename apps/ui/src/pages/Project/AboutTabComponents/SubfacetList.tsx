import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  CircularProgress,
  Alert,
  Chip,
  Stack,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { TopologySubfacetStatus } from "@hey-hey/ui-common/api";
import type { TopologySubfacetDto } from "@hey-hey/ui-common/api";

export interface SubfacetListProps {
  subfacets: TopologySubfacetDto[];
  isLoading: boolean;
  error: Error | null;
  onSubfacetClick: (subfacetId: string) => void;
}

export const SubfacetList: React.FC<SubfacetListProps> = ({
  subfacets,
  isLoading,
  error,
  onSubfacetClick,
}) => {
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
        Failed to load subfacets. Please try again later.
      </Alert>
    );
  }

  if (subfacets.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          No subfacets available for this category.
        </Typography>
      </Box>
    );
  }

  return (
    <List>
      {subfacets.map((subfacet) => (
        <ListItem key={subfacet.id} disablePadding>
          <ListItemButton onClick={() => onSubfacetClick(subfacet.id)}>
            <ListItemText
              primary={
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="h6">{subfacet.name}</Typography>
                  <Chip
                    label={subfacet.status}
                    size="small"
                    color={
                      subfacet.status === TopologySubfacetStatus.Active
                        ? "success"
                        : "default"
                    }
                  />
                </Stack>
              }
              secondary={
                <Box sx={{ mt: 1 }}>
                  {subfacet.summary && (
                    <Typography variant="body2" color="text.secondary">
                      {subfacet.summary}
                    </Typography>
                  )}
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    sx={{ mt: 0.5, display: "block" }}
                  >
                    {subfacet.lastSummarizedAt
                      ? `Summarized: ${new Date(
                          subfacet.lastSummarizedAt
                        ).toLocaleDateString()}`
                      : "Not summarized yet"}
                  </Typography>
                </Box>
              }
            />
            <ChevronRightIcon color="action" />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );
};
