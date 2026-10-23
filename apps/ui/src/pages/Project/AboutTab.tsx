import {
  Alert,
  Box,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import React from "react";
import { useQueryState, parseAsString } from "nuqs";
import { TabContainer } from "../../components/Tabs/TabContainer";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import {
  useTopologyCategorySummaries,
  useTopologySubfacets,
  useTopologyEntitySummaries,
  useArtifacts,
} from "@hey-hey/ui-common/data";
import { ArtifactType } from "@hey-hey/ui-common/api";
import type { TopologySummaryCategory } from "@hey-hey/ui-common/api";
import {
  CategoryList,
  EntityList,
  SubfacetList,
  TopologyBreadcrumbs,
} from "./AboutTabComponents";
import { Artifact } from "../../components/Artifact";

export interface AboutTabProps {
  projectId: string;
}

type ViewMode = "categories" | "subfacets" | "entities";

export const AboutTab: React.FC<AboutTabProps> = ({ projectId }) => {
  const { currentOrgId } = useUserIdentity() || {};

  // Subtab state management
  const [view, setView] = useQueryState(
    "view",
    parseAsString.withDefault("insights")
  );

  // URL state management with nuqs for topology navigation
  const [categoryParam, setCategoryParam] = useQueryState(
    "category",
    parseAsString.withDefault("")
  );
  const [selectedSubfacetId, setSelectedSubfacetId] = useQueryState(
    "subfacet",
    parseAsString.withDefault("")
  );

  const selectedCategory = (categoryParam ||
    null) as TopologySummaryCategory | null;

  // Derive view mode from URL state
  const viewMode: ViewMode = selectedSubfacetId
    ? "entities"
    : selectedCategory
    ? "subfacets"
    : "categories";

  // Fetch insights for Insights tab
  const {
    data: insights,
    isLoading: insightsLoading,
    error: insightsError,
  } = useArtifacts(currentOrgId, projectId, {
    type: ArtifactType.Insight,
    enabled: view === "insights",
  });

  // Fetch category summaries for Topology tab
  const {
    summaries: categorySummaries,
    isLoading: categoriesLoading,
    error: categoriesError,
  } = useTopologyCategorySummaries(currentOrgId, projectId);

  // Fetch subfacets for selected category
  const {
    subfacets,
    isLoading: subfacetsLoading,
    error: subfacetsError,
  } = useTopologySubfacets(currentOrgId, projectId, {
    category: selectedCategory || undefined,
    enabled: !!selectedCategory,
  });

  // Fetch entities for selected subfacet
  const {
    summaries: entitySummaries,
    isLoading: entitiesLoading,
    error: entitiesError,
  } = useTopologyEntitySummaries(currentOrgId, projectId, {
    subfacetId: selectedSubfacetId ? [selectedSubfacetId] : undefined,
    enabled: !!selectedSubfacetId,
  });

  // Find the current subfacet object for breadcrumbs
  const selectedSubfacet =
    subfacets.find((s) => s.id === selectedSubfacetId) || null;

  const handleCategoryClick = (category: TopologySummaryCategory) => {
    setCategoryParam(category);
    setSelectedSubfacetId("");
  };

  const handleSubfacetClick = (subfacetId: string) => {
    setSelectedSubfacetId(subfacetId);
  };

  const handleBackToCategories = () => {
    setCategoryParam("");
    setSelectedSubfacetId("");
  };

  const handleBackToSubfacets = () => {
    setSelectedSubfacetId("");
  };

  return (
    <TabContainer>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs value={view} onChange={(_, newValue) => setView(newValue)}>
          <Tab label="Insights" value="insights" />
          <Tab label="Topology" value="topology" />
        </Tabs>
      </Box>

      <Box sx={{ p: 3 }}>
        {view === "insights" && (
          <>
            {insightsLoading && (
              <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                <CircularProgress />
              </Box>
            )}

            {insightsError && (
              <Alert severity="error">
                Failed to load insights: {insightsError.message}
              </Alert>
            )}

            {!insightsLoading && !insightsError && insights.length === 0 && (
              <Box sx={{ textAlign: "center", p: 4 }}>
                <Typography variant="body1" color="text.secondary">
                  No insights have been generated for this project yet.
                </Typography>
              </Box>
            )}

            {!insightsLoading && !insightsError && insights.length > 0 && (
              <Stack spacing={2}>
                {insights.map((artifact) => (
                  <Artifact key={artifact.id} artifact={artifact} />
                ))}
              </Stack>
            )}

          </>
        )}

        {view === "topology" && (
          <>
            <TopologyBreadcrumbs
              selectedCategory={selectedCategory}
              selectedSubfacet={selectedSubfacet}
              onBackToCategories={handleBackToCategories}
              onBackToSubfacets={handleBackToSubfacets}
            />

            {viewMode === "categories" && (
              <CategoryList
                categorySummaries={categorySummaries}
                isLoading={categoriesLoading}
                error={categoriesError}
                onCategoryClick={handleCategoryClick}
              />
            )}

            {viewMode === "subfacets" && (
              <SubfacetList
                subfacets={subfacets}
                isLoading={subfacetsLoading}
                error={subfacetsError}
                onSubfacetClick={handleSubfacetClick}
              />
            )}

            {viewMode === "entities" && (
              <EntityList
                projectId={projectId}
                entitySummaries={entitySummaries}
                isLoading={entitiesLoading}
                error={entitiesError}
                onSubfacetClick={handleSubfacetClick}
              />
            )}
          </>
        )}
      </Box>
    </TabContainer>
  );
};
