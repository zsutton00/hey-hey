import React from "react";
import {
  Box,
  Typography,
  Stack,
  Divider,
  IconButton,
  CircularProgress,
} from "@mui/material";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { useNavigate } from "react-router-dom";
import {
  createProjectCollectionPreviewRequest,
  usePreviewHost,
  useTheme,
} from "@hey-hey/ui-common/context";
import { MINI_DEMO_TARGETS } from "@hey-hey/ui-common/components";
import { useTranslation } from "react-i18next";
import { KEYS } from "@hey-hey/ui-common/i18n";
import type { ExplorerTreeProps, ExplorerNode, ExplorerSection } from "./types";
import { ExplorerTreeNode } from "./ExplorerTreeNode";
import { ExplorerSectionDisclosure } from "./ExplorerSectionDisclosure";
import { FeatureChildren } from "./FeatureChildren";

function getSectionLabel(section: ExplorerSection): string {
  const displayCount =
    section.count !== undefined
      ? section.count
      : section.isLoading
      ? "…"
      : section.nodes.length;

  return `${section.label.toUpperCase()} (${displayCount})`;
}

/**
 * Explorer tree view component
 * Displays entities in a grouped, hierarchical tree structure
 */
export const ExplorerTree: React.FC<ExplorerTreeProps> = ({
  nodes,
  expandedNodes,
  selectedNodeId,
  onToggleNode,
  onSelectNode,
  isSearching,
  expandedEntityGroups,
  onToggleEntityGroup,
  sections,
  organizationId,
  projectId: projectIdProp,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mode } = useTheme();
  const previewHost = usePreviewHost();

  // Use prop if provided, otherwise extract from URL
  const projectId =
    projectIdProp ?? window.location.pathname.split("/")[2] ?? "";

  // Render tree nodes with children support
  const renderTreeNodes = (
    nodesToRender: ExplorerNode[],
    allNodes: ExplorerNode[] = nodes
  ) => {
    return nodesToRender.map((node) => {
      const isExpanded = expandedNodes.has(node.id);
      const isFeature = node.type === "feature";

      // For non-feature nodes, find children from allNodes
      const nonFeatureChildren =
        !isFeature && isExpanded && node.hasChildren
          ? allNodes
              .filter((n) => n.parentId === node.id)
              .sort((a, b) =>
                a.name.localeCompare(b.name, undefined, {
                  sensitivity: "base",
                })
              )
          : [];

      return (
        <Box key={node.id}>
          <ExplorerTreeNode
            node={node}
            isExpanded={isExpanded}
            isSelected={selectedNodeId === node.id}
            onToggle={() => onToggleNode(node.id)}
            onSelect={() => onSelectNode(node)}
            disableDepthIndent={isSearching}
            organizationId={organizationId}
            projectId={projectId}
          />

          {/* Feature children are fetched on-demand via FeatureChildren */}
          {isFeature &&
            isExpanded &&
            node.hasChildren &&
            organizationId &&
            projectId && (
              <FeatureChildren
                parentFeatureId={node.id}
                organizationId={organizationId}
                projectId={projectId}
                expandedNodes={expandedNodes}
                selectedNodeId={selectedNodeId}
                onToggleNode={onToggleNode}
                onSelectNode={onSelectNode}
                parentDepth={node.depth}
              />
            )}

          {/* Non-feature children from allNodes */}
          {!isFeature && isExpanded && nonFeatureChildren.length > 0 && (
            <Box sx={{ pl: 1 }}>
              {renderTreeNodes(nonFeatureChildren, allNodes)}
            </Box>
          )}
        </Box>
      );
    });
  };

  const renderSection = (
    section: ExplorerSection,
    index: number,
    searchMode: boolean
  ) => {
    const isGroupExpanded = searchMode || expandedEntityGroups.has(section.key);
    const sectionNodes = searchMode
      ? nodes.filter((node) => node.sectionKey === section.key)
      : section.nodes;
    const nodesToRender = searchMode
      ? sectionNodes
      : sectionNodes.filter((node) => !node.parentId);
    const sectionPath = section.path;

    return (
      <Box key={section.key}>
        {index > 0 && <Divider sx={{ my: 1 }} />}

        <ExplorerSectionDisclosure
          sectionKey={section.key}
          label={section.label}
          expanded={isGroupExpanded}
          onToggle={() => onToggleEntityGroup(section.key)}
          headerColor={headerColor}
          header={
            <>
              {sectionPath ? (
                <Box
                  component="a"
                  href={sectionPath}
                  onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    if (
                      !e.ctrlKey &&
                      !e.metaKey &&
                      !e.shiftKey &&
                      e.button === 0
                    ) {
                      e.preventDefault();
                      navigate(sectionPath);
                    }
                  }}
                  data-demo-target={
                    section.previewCollection === "features"
                      ? MINI_DEMO_TARGETS.featuresNavLink
                      : section.previewCollection === "services"
                      ? MINI_DEMO_TARGETS.servicesNavLink
                      : undefined
                  }
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    px: 1,
                    py: 0.75,
                    flex: 1,
                    textDecoration: "none",
                    cursor: "pointer",
                    borderRadius: 1,
                    transition: "background-color 0.2s",
                    "&:hover": {
                      bgcolor: "action.hover",
                    },
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      fontSize: "0.875rem",
                      color: headerColor,
                      textAlign: "left",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexGrow: 1,
                    }}
                  >
                    {getSectionLabel(section)}
                  </Typography>
                </Box>
              ) : (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    px: 1,
                    py: 0.75,
                    flex: 1,
                    borderRadius: 1,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      fontSize: "0.875rem",
                      color: headerColor,
                      textAlign: "left",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexGrow: 1,
                    }}
                  >
                    {getSectionLabel(section)}
                  </Typography>
                </Box>
              )}

              {section.previewCollection ? (
                <IconButton
                  size="small"
                  aria-label={`Preview ${section.label}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    previewHost.openPreview(
                      createProjectCollectionPreviewRequest(
                        section.previewCollection!
                      )
                    );
                  }}
                  sx={{ color: headerColor, flexShrink: 0 }}
                >
                  <VisibilityOutlinedIcon fontSize="small" />
                </IconButton>
              ) : null}
            </>
          }
        >
          {section.isLoading && nodesToRender.length === 0 ? (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                py: 2,
              }}
            >
              <CircularProgress size={20} />
            </Box>
          ) : (
            <Stack spacing={0.5}>
              {renderTreeNodes(nodesToRender, sectionNodes)}
            </Stack>
          )}
        </ExplorerSectionDisclosure>
      </Box>
    );
  };

  const headerColor = mode === "light" ? "heyhey.main" : "cadetblue";

  return (
    <Box
      role="tree"
      aria-label={t(KEYS.explorer.treeAriaLabel)}
      sx={{ width: "100%" }}
    >
      <Stack spacing={0}>
        {sections.map((section, index) =>
          renderSection(section, index, Boolean(isSearching))
        )}
      </Stack>
    </Box>
  );
};
