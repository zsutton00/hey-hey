import React, { Suspense, lazy, useState } from "react";
import { Box, CircularProgress } from "@mui/material";
import { parseAsString, useQueryState } from "nuqs";
import { useFeatureTreePageData } from "@hey-hey/ui-common/data";
import {
  FeaturesTableOfContents,
  type TocEntry,
} from "./FeaturesTableOfContents";

const FeatureTreeVisualization = lazy(
  () => import("@hey-hey/ui-common/feature-tree-visualization"),
);

export interface FeaturesTreeViewProps {
  orientation?: "left-to-right" | "top-down";
  organizationId: string;
  projectId: string;
  projectName?: string;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  mobileTocVisible?: boolean;
  isMobileSearchActive?: boolean;
  onMobileFeatureSelect?: (featureId: string, rootId: string) => void;
}

export const FeaturesTreeView: React.FC<FeaturesTreeViewProps> = ({
  orientation,
  organizationId,
  projectId,
  projectName,
  searchQuery,
  onSearchChange,
  mobileTocVisible = true,
  isMobileSearchActive = false,
  onMobileFeatureSelect,
}) => {
  const treeData = useFeatureTreePageData(organizationId, projectId);
  const { roots, isLoading } = treeData;

  const [selectedFeatureId, setSelectedFeatureId] = useQueryState(
    "feature",
    parseAsString,
  );
  // Feature ids whose child entries are revealed in the table of contents.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(),
  );

  const handleToggleExpand = (featureId: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  };

  // Selecting any TOC entry — at any depth — pans the tree to center that
  // node via FeatureTreeVisualization's activeFeatureId prop. The whole tree
  // stays visible; the selection only drives scroll, not filtering.
  const handleActivate = (entry: TocEntry): void => {
    if (isMobileSearchActive && onMobileFeatureSelect) {
      onMobileFeatureSelect(entry.node.feature.id, entry.rootId);
      return;
    }
    void setSelectedFeatureId(entry.node.feature.id);
  };

  if (isLoading) {
    return (
      <Box
        data-testid="features-tree-view"
        sx={{ display: "flex", justifyContent: "center", py: 6 }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      data-testid="features-tree-view"
      sx={{
        display: "flex",
        gap: 2,
        flex: 1,
        flexDirection: { xs: "column", md: "row" },
        minHeight: 0,
        minWidth: 0,
        width: "100%",
      }}
    >
      <FeaturesTableOfContents
        roots={roots}
        mobileVisible={mobileTocVisible}
        searchQuery={searchQuery}
        expandedIds={expandedIds}
        selectedFeatureId={selectedFeatureId}
        onActivate={handleActivate}
        onToggleExpand={handleToggleExpand}
      />
      <Box
        sx={{
          display: {
            xs: mobileTocVisible ? "none" : "flex",
            md: "flex",
          },
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <Suspense fallback={<CircularProgress />}>
          <FeatureTreeVisualization
            orientation={orientation}
            treeData={treeData}
            organizationId={organizationId}
            projectId={projectId}
            projectName={projectName}
            activeFeatureId={selectedFeatureId ?? undefined}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
          />
        </Suspense>
      </Box>
    </Box>
  );
};
