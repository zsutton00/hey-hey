import React from "react";
import { Breadcrumbs, Link, Typography } from "@mui/material";
import type { TopologySummaryCategory, TopologySubfacetDto } from "../../api";

export interface TopologyBreadcrumbsProps {
  selectedCategory: TopologySummaryCategory | null;
  selectedSubfacet: TopologySubfacetDto | null;
  onBackToCategories: () => void;
  onBackToSubfacets: () => void;
}

const formatCategoryName = (category: string): string => {
  return category.charAt(0).toUpperCase() + category.slice(1);
};

export const TopologyBreadcrumbs: React.FC<TopologyBreadcrumbsProps> = ({
  selectedCategory,
  selectedSubfacet,
  onBackToCategories,
  onBackToSubfacets,
}) => {
  const isOnCategories = !selectedCategory;
  const isOnSubfacets = selectedCategory && !selectedSubfacet;
  const isOnEntities = selectedCategory && selectedSubfacet;

  return (
    <Breadcrumbs sx={{ mb: 2 }}>
      <Link
        component="button"
        variant="body2"
        onClick={onBackToCategories}
        sx={{
          cursor: "pointer",
          textDecoration: isOnCategories ? "none" : "underline",
          color: isOnCategories ? "text.primary" : "primary.main",
        }}
      >
        Categories
      </Link>
      {selectedCategory && (
        <Link
          component="button"
          variant="body2"
          onClick={onBackToSubfacets}
          sx={{
            cursor: "pointer",
            textDecoration: isOnSubfacets ? "none" : "underline",
            color: isOnSubfacets ? "text.primary" : "primary.main",
          }}
        >
          {formatCategoryName(selectedCategory)}
        </Link>
      )}
      {isOnEntities && (
        <Typography variant="body2" color="text.primary">
          {selectedSubfacet?.name || "Entities"}
        </Typography>
      )}
    </Breadcrumbs>
  );
};
