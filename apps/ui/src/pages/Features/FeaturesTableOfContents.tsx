import React, { useMemo } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { useTranslation } from "react-i18next";
import type { FeatureHierarchyNode } from "@hey-hey/ui-common/data";
import { sortByName } from "./featureTreeUtils";

export interface TocEntry {
  node: FeatureHierarchyNode;
  // 0 = top-level root; every level of nesting adds one.
  depth: number;
  // Id of the top-level root this entry descends from.
  rootId: string;
}

// Internal walk record: a TocEntry plus the ancestor ids needed to decide
// whether the entry is currently revealed.
interface WalkEntry extends TocEntry {
  ancestorIds: string[];
}

export interface FeaturesTableOfContentsProps {
  roots: FeatureHierarchyNode[];
  mobileVisible?: boolean;
  searchQuery?: string;
  // When provided, the TOC filters by these feature ids instead of by name.
  // Ancestors of matched features are kept for structural context.
  matchedFeatureIds?: Set<string>;
  // Feature ids whose child entries are revealed in the table of contents.
  expandedIds: Set<string>;
  selectedFeatureId: string | null;
  // Feature id of the section currently scrolled into view; only the document
  // view supplies this, so the tree view leaves it undefined.
  activeSectionId?: string | null;
  onActivate: (entry: TocEntry) => void;
  onToggleExpand: (featureId: string) => void;
}

// Keep a feature when its own name matches, or recurse into its children and
// keep it as a path to any descendant that matches. A self-match keeps the
// whole subtree so the reader can navigate into it.
const filterNode = (
  node: FeatureHierarchyNode,
  query: string,
): FeatureHierarchyNode | null => {
  if (node.feature.name.toLowerCase().includes(query)) return node;
  const children = node.children
    .map((child) => filterNode(child, query))
    .filter((child): child is FeatureHierarchyNode => child !== null);
  if (children.length > 0) return { ...node, children };
  return null;
};

// Keep a feature when its id is in matchedIds, or recurse into children and
// keep it as a structural ancestor of any match.
export const filterNodeByIds = (
  node: FeatureHierarchyNode,
  matchedIds: Set<string>,
): FeatureHierarchyNode | null => {
  if (matchedIds.has(node.feature.id)) return node;
  const children = node.children
    .map((child) => filterNodeByIds(child, matchedIds))
    .filter((child): child is FeatureHierarchyNode => child !== null);
  if (children.length > 0) return { ...node, children };
  return null;
};

export const FeaturesTableOfContents: React.FC<
  FeaturesTableOfContentsProps
> = ({
  roots,
  mobileVisible = false,
  searchQuery,
  matchedFeatureIds,
  expandedIds,
  selectedFeatureId,
  activeSectionId,
  onActivate,
  onToggleExpand,
}) => {
  const { t } = useTranslation();

  const query = searchQuery?.trim().toLowerCase() ?? "";

  const filteredRoots = useMemo<FeatureHierarchyNode[]>(() => {
    if (matchedFeatureIds) {
      return sortByName(
        roots
          .map((root) => filterNodeByIds(root, matchedFeatureIds))
          .filter((root): root is FeatureHierarchyNode => root !== null),
      );
    }
    if (!query) return sortByName(roots);
    return sortByName(
      roots
        .map((root) => filterNode(root, query))
        .filter((root): root is FeatureHierarchyNode => root !== null),
    );
  }, [roots, query, matchedFeatureIds]);

  // Walk the (filtered) tree into a flat, ordered list with one entry per
  // feature at every depth.
  const tocEntries = useMemo<WalkEntry[]>(() => {
    const entries: WalkEntry[] = [];
    const walk = (
      node: FeatureHierarchyNode,
      depth: number,
      rootId: string,
      ancestorIds: string[],
    ): void => {
      entries.push({ node, depth, rootId, ancestorIds });
      const childAncestors = [...ancestorIds, node.feature.id];
      for (const child of sortByName(node.children)) {
        walk(child, depth + 1, rootId, childAncestors);
      }
    };
    for (const root of filteredRoots) {
      walk(root, 0, root.feature.id, []);
    }
    return entries;
  }, [filteredRoots]);

  // While a name filter or id-based search is active, reveal every branch of
  // the filtered tree so matches at any depth show without manual expansion.
  const effectiveExpandedIds = useMemo<Set<string>>(() => {
    if (!query && !matchedFeatureIds) return expandedIds;
    const ids = new Set(expandedIds);
    for (const entry of tocEntries) {
      if (entry.node.children.length > 0) ids.add(entry.node.feature.id);
    }
    return ids;
  }, [query, matchedFeatureIds, expandedIds, tocEntries]);

  // An entry appears only once every one of its ancestors is expanded; the
  // rendered list drives both display and keyboard navigation so the two
  // stay in sync.
  const visibleEntries = useMemo<WalkEntry[]>(
    () =>
      tocEntries.filter((entry) =>
        entry.ancestorIds.every((id) => effectiveExpandedIds.has(id)),
      ),
    [tocEntries, effectiveExpandedIds],
  );

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    index: number,
    entries: WalkEntry[] = visibleEntries,
  ): void => {
    if (entries.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onActivate(entries[(index + 1) % entries.length]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      onActivate(entries[(index - 1 + entries.length) % entries.length]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate(entries[index]);
    }
  };

  const renderEntries = (
    entries: WalkEntry[],
    expandedIdsForEntries: Set<string>,
  ): React.ReactNode => {
    if (entries.length === 0) {
      return (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ px: 2, py: 2 }}
        >
          {t("features.view.wikiTocEmpty", "No features to display.")}
        </Typography>
      );
    }

    return entries.map((entry, index) => {
      const featureId = entry.node.feature.id;
      const isSelected = featureId === selectedFeatureId;
      const isActive = featureId === activeSectionId;
      const isHighlighted = isSelected || isActive;
      const isRoot = entry.depth === 0;
      const hasChildren = entry.node.children.length > 0;
      const isExpanded = expandedIdsForEntries.has(featureId);
      return (
        <Box
          key={featureId}
          role="button"
          tabIndex={0}
          data-testid={`features-wiki-toc-entry-${featureId}`}
          data-selected={isSelected ? "true" : "false"}
          data-active={isActive ? "true" : "false"}
          data-depth={entry.depth}
          onClick={() => onActivate(entry)}
          onKeyDown={(event) => handleKeyDown(event, index, entries)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            pl: 1 + entry.depth * 2,
            pr: 2,
            minHeight: { xs: 48, md: "auto" },
            py: { xs: 1, md: isRoot ? 1 : 0.75 },
            cursor: "pointer",
            bgcolor: isHighlighted ? "action.selected" : "transparent",
            "&:hover": {
              bgcolor: isHighlighted ? "action.selected" : "action.hover",
            },
            "&:focus-visible": {
              outline: 2,
              outlineColor: "primary.main",
              outlineOffset: -2,
            },
          }}
        >
          {hasChildren ? (
            <IconButton
              size="small"
              data-testid={`features-wiki-toc-toggle-${featureId}`}
              aria-expanded={isExpanded}
              aria-label={
                isExpanded
                  ? t("features.view.wikiTocCollapse", "Collapse section")
                  : t("features.view.wikiTocExpand", "Expand section")
              }
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand(featureId);
              }}
              onKeyDown={(event) => event.stopPropagation()}
              sx={{ p: 0.25, ml: -0.25 }}
            >
              <KeyboardArrowRightIcon
                fontSize="small"
                sx={{
                  transition: (theme) =>
                    theme.transitions.create("transform", {
                      duration: theme.transitions.duration.shortest,
                    }),
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                }}
              />
            </IconButton>
          ) : (
            <Box sx={{ width: 24, flexShrink: 0 }} />
          )}
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              minWidth: 0,
              fontWeight: isRoot ? 600 : isHighlighted ? 600 : 400,
              fontSize: {
                xs: isRoot ? "1.1rem" : "1rem",
                md: isRoot ? "1.1rem" : "1rem",
              },
              color: isHighlighted ? "text.primary" : "text.secondary",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {entry.node.feature.name}
          </Typography>
        </Box>
      );
    });
  };

  return (
    <Box
      data-testid="features-wiki-toc-container"
      sx={{
        width: { xs: "100%", md: 280 },
        flex: { xs: "1 1 0", md: "0 0 280px" },
        display: { xs: mobileVisible ? "flex" : "none", md: "flex" },
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <Box
        component="nav"
        id="features-wiki-toc"
        aria-label={t("features.view.wikiTocAriaLabel", "Feature index")}
        data-testid="features-wiki-toc"
        sx={{
          width: "100%",
          flex: 1,
          border: 1,
          borderColor: "divider",
          bgcolor: "action.hover",
          borderRadius: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <Box
          data-testid="features-wiki-toc-scroll"
          sx={{ flex: 1, overflowY: "auto", px: 1, py: 1.5, minHeight: 0 }}
        >
          {renderEntries(visibleEntries, effectiveExpandedIds)}
        </Box>
      </Box>
    </Box>
  );
};
