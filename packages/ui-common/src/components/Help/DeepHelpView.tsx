import SearchIcon from "@mui/icons-material/Search";
import {
  Box,
  Grid,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";

import { useHelpSearch, useHelpTree } from "../../data/hooks";
import { HELP_DEMO_FALLBACK } from "./helpCapabilities";
import type {
  HelpDemoFallback,
  HelpDemoMap,
  PlatformDemo,
} from "./helpCapabilities";
import {
  mapHelpSearchResultsToTopicList,
  mapHelpTreeToTopicList,
  selectProjectHelpTree,
} from "./helpContentSource";
import type { ProjectHelpSection } from "./helpContentSource";
import { useHelp } from "./HelpContext";
import { HELP_SCENARIO_CATALOG } from "./helpScenarioCatalog";
import { HelpScenarioCard } from "./HelpScenarioCard";
import { HelpTableOfContents } from "./HelpTableOfContents";
import { HelpTopicCard } from "./HelpTopicCard";

const renderDemo = (demo: PlatformDemo | HelpDemoFallback): React.ReactNode => {
  if (demo === HELP_DEMO_FALLBACK) {
    return null;
  }
  return demo as React.ReactNode;
};

const hasScenarioDemo = (
  demos: HelpDemoMap,
  scenarioId: string
): scenarioId is keyof HelpDemoMap =>
  Object.prototype.hasOwnProperty.call(demos, scenarioId);

const renderScenarioDemo = (
  scenarioId: string,
  demos: HelpDemoMap
): React.ReactNode => {
  if (!hasScenarioDemo(demos, scenarioId)) {
    return null;
  }
  return renderDemo(demos[scenarioId]);
};

export interface DeepHelpViewProps {
  rootSection?: ProjectHelpSection;
  excludedTopicIds?: readonly string[];
}

const filterAndRenumberTopics = <
  T extends { id: string; slug: string; number: number },
>(topics: readonly T[], excludedTopicIds: ReadonlySet<string>): T[] =>
  topics
    .filter(
      (topic) =>
        !excludedTopicIds.has(topic.id) && !excludedTopicIds.has(topic.slug)
    )
    .map((topic, index) => ({ ...topic, number: index + 1 }));

export const DeepHelpView: React.FC<DeepHelpViewProps> = ({
  rootSection,
  excludedTopicIds = [],
}) => {
  const { data, demos } = useHelp();
  const {
    tree,
    isLoading: isTreeLoading,
    error: treeError,
  } = useHelpTree();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const {
    results: searchResults,
    isLoading: isSearchLoading,
    error: searchError,
  } = useHelpSearch(query);
  const excludedTopicIdSet = useMemo(
    () => new Set(excludedTopicIds),
    [excludedTopicIds]
  );

  const browseTopics = useMemo(
    () =>
      filterAndRenumberTopics(
        tree
          ? mapHelpTreeToTopicList(
              rootSection ? selectProjectHelpTree(tree, rootSection) : tree
            )
          : [],
        excludedTopicIdSet
      ),
    [excludedTopicIdSet, rootSection, tree]
  );
  const searchedTopics = useMemo(
    () =>
      filterAndRenumberTopics(
        mapHelpSearchResultsToTopicList(searchResults),
        excludedTopicIdSet
      ),
    [excludedTopicIdSet, searchResults]
  );
  const isSearching = normalizedQuery.length > 0;
  const topics = isSearching ? searchedTopics : browseTopics;
  const isLoading = isSearching ? isSearchLoading : isTreeLoading;
  const error = isSearching ? searchError : treeError;
  const showCatalogFallback =
    !isSearching && !isLoading && !error && tree?.items.length === 0;

  return (
    <Box
      data-testid="deep-help-view"
      sx={{ py: 2, width: "100%", maxWidth: 1280 }}
    >
      <Stack spacing={3.5}>
        <TextField
          fullWidth
          placeholder="Search help"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          slotProps={{
            htmlInput: { "data-testid": "deep-help-search-input" },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        {error ? (
          <Typography
            data-testid="deep-help-error-state"
            variant="body1"
            color="error"
          >
            Help topics are unavailable right now.
          </Typography>
        ) : isLoading ? (
          <Typography
            data-testid="deep-help-loading-state"
            variant="body1"
            color="text.secondary"
          >
            {isSearching ? "Searching help topics..." : "Loading help topics..."}
          </Typography>
        ) : showCatalogFallback ? (
          <>
            <Typography
              data-testid="deep-help-fallback-state"
              variant="h5"
              sx={{ fontWeight: 600 }}
            >
              Getting started
            </Typography>
            {HELP_SCENARIO_CATALOG.filter(
              (scenario) => !excludedTopicIdSet.has(scenario.id)
            ).map((scenario, index) => (
              <HelpScenarioCard
                key={scenario.id}
                scenario={scenario}
                number={index + 1}
                features={data.features}
                demo={renderScenarioDemo(scenario.id, demos)}
                titleVariant="h6"
                titleComponent="h3"
              />
            ))}
          </>
        ) : topics.length === 0 ? (
          <Typography
            data-testid="deep-help-empty-state"
            variant="body1"
            color="text.secondary"
          >
            No help topics match your search.
          </Typography>
        ) : isSearching ? (
          topics.map((topic) => (
            <HelpTopicCard
              key={topic.id}
              topic={topic}
              features={data.features}
              demo={renderScenarioDemo(topic.slug, demos)}
            />
          ))
        ) : (
          <Grid container spacing={4}>
            <Grid size={{ xs: 12, md: 3 }}>
              <Box
                data-testid="help-table-of-contents-column"
                sx={{
                  position: { md: "sticky" },
                  top: { md: 16 },
                  maxHeight: { md: "calc(100vh - 32px)" },
                  overflowY: { md: "auto" },
                }}
              >
                <HelpTableOfContents topics={browseTopics} />
              </Box>
            </Grid>
            <Grid size={{ xs: 12, md: 9 }}>
              <Stack spacing={3.5}>
                {browseTopics.map((topic) => (
                  <HelpTopicCard
                    key={topic.id}
                    topic={topic}
                    features={data.features}
                    demo={renderScenarioDemo(topic.slug, demos)}
                  />
                ))}
              </Stack>
            </Grid>
          </Grid>
        )}
      </Stack>
    </Box>
  );
};
