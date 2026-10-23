import React, { useMemo } from "react";
import { Box, CircularProgress } from "@mui/material";
import {
  useFeatureHierarchy,
  useFeatureDocumentContent,
} from "@hey-hey/ui-common/data";
import { ExplorerTreeNode } from "./ExplorerTreeNode";
import type { ExplorerNode } from "./types";

interface FeatureChildrenProps {
  parentFeatureId: string;
  organizationId: string;
  projectId: string;
  expandedNodes: Set<string>;
  selectedNodeId?: string;
  onToggleNode: (nodeId: string) => void;
  onSelectNode: (node: ExplorerNode) => void;
  parentDepth: number;
}

/**
 * Fetches and renders child features for an expanded feature node.
 * Supports recursive expansion of subfeatures.
 */
export const FeatureChildren: React.FC<FeatureChildrenProps> = ({
  parentFeatureId,
  organizationId,
  projectId,
  expandedNodes,
  selectedNodeId,
  onToggleNode,
  onSelectNode,
  parentDepth,
}) => {
  const hierarchy = useFeatureHierarchy(organizationId, projectId);
  const children = hierarchy.nodes.get(parentFeatureId)?.children;
  const ids = children?.map((node) => node.feature.id) ?? [];
  const { entries } = useFeatureDocumentContent(
    organizationId,
    projectId,
    ids,
    undefined,
    "metadata"
  );
  const isLoading = hierarchy.isLoading;
  const childNodes = useMemo<ExplorerNode[]>(
    () =>
      (children ?? []).map((node) => {
        const metadata = entries.get(node.feature.id)?.data;
        return {
          id: node.feature.id,
          type: "feature",
          name: node.feature.name,
          status: metadata?.status,
          priority: metadata?.priority,
          hasChildren: node.children.length > 0,
          depth: parentDepth + 1,
          parentId: node.feature.parentTaskId ?? undefined,
          updatedAt: metadata?.updatedAt
            ? new Date(metadata.updatedAt)
            : undefined,
          createdAt: metadata?.createdAt
            ? new Date(metadata.createdAt)
            : undefined,
        };
      }),
    [children, entries, parentDepth]
  );

  if (isLoading && childNodes.length === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          py: 1,
        }}
      >
        <CircularProgress size={16} />
      </Box>
    );
  }

  return (
    <Box sx={{ pl: 1 }}>
      {childNodes.map((node) => {
        const isExpanded = expandedNodes.has(node.id);
        return (
          <Box key={node.id}>
            <ExplorerTreeNode
              node={node}
              isExpanded={isExpanded}
              isSelected={selectedNodeId === node.id}
              onToggle={() => onToggleNode(node.id)}
              onSelect={() => onSelectNode(node)}
              organizationId={organizationId}
              projectId={projectId}
            />
            {isExpanded && node.hasChildren && (
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
          </Box>
        );
      })}
    </Box>
  );
};
