import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  CircularProgress,
  Alert,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type {
  TopologySummaryCategory,
  TopologyCategorySummaryDto,
} from "@hey-hey/ui-common/api";

export interface CategoryListProps {
  categorySummaries: TopologyCategorySummaryDto[];
  isLoading: boolean;
  error: Error | null;
  onCategoryClick: (category: TopologySummaryCategory) => void;
}

const formatCategoryName = (category: string): string => {
  return category.charAt(0).toUpperCase() + category.slice(1);
};

export const CategoryList: React.FC<CategoryListProps> = ({
  categorySummaries,
  isLoading,
  error,
  onCategoryClick,
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
        Failed to load categories. Please try again later.
      </Alert>
    );
  }

  if (categorySummaries.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          No topology data available yet.
        </Typography>
      </Box>
    );
  }

  return (
    <List>
      {categorySummaries.map((summary, index) => (
        <ListItem key={`${summary.category}-${index}`} disablePadding>
          <ListItemButton onClick={() => onCategoryClick(summary.category)}>
            <ListItemText
              primary={
                <Typography variant="h6">
                  {formatCategoryName(summary.category)}
                </Typography>
              }
              secondary={
                <Box sx={{ mt: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    {summary.summary}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    sx={{ mt: 0.5, display: "block" }}
                  >
                    Last updated:{" "}
                    {new Date(summary.lastUpdated).toLocaleDateString()}
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
