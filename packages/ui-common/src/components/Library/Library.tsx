import { useCallback, useMemo, useState } from "react";
import {
  type DesignDocLibraryNodeDto,
  type DesignDocLibraryNodeType,
} from "../../api";
import { Box, Collapse } from "@mui/material";
import { EntityGrid } from "../Entity/EntityGrid";
import { LibraryListItem } from "./LibraryListItem";

export interface LibraryProps {
  library: DesignDocLibraryNodeDto[];
  onEntityClick?: (node: DesignDocLibraryNodeDto) => void;
  selectedId?: string;
  searchQuery?: string;
  ariaLabel?: string;
}

type LibraryNodeKey = `${DesignDocLibraryNodeType}:${string}`;

const DEFAULT_ARIA_LABEL = "Design doc library";

const buildNodeKey = (node: DesignDocLibraryNodeDto): LibraryNodeKey =>
  `${node.type}:${node.id}`;

const hasChildren = (node: DesignDocLibraryNodeDto): boolean =>
  node.children.length > 0;

export function Library({
  library,
  onEntityClick,
  selectedId,
  searchQuery,
  ariaLabel = DEFAULT_ARIA_LABEL,
}: LibraryProps) {
  const [expanded, setExpanded] = useState<Set<LibraryNodeKey>>(
    () => new Set()
  );

  const normalizedQuery = searchQuery?.trim().toLowerCase() ?? "";

  const autoExpandedKeys = useMemo(() => {
    if (!normalizedQuery) {
      return null;
    }

    const keys = new Set<LibraryNodeKey>();

    const matchesNode = (node: DesignDocLibraryNodeDto): boolean => {
      return (
        node.name.toLowerCase().includes(normalizedQuery) ||
        (node.designDoc?.name
          ? node.designDoc.name.toLowerCase().includes(normalizedQuery)
          : false)
      );
    };

    const walk = (node: DesignDocLibraryNodeDto): boolean => {
      const childrenMatch = node.children.some((child) => walk(child));
      const nodeMatches = matchesNode(node);

      if (childrenMatch) {
        keys.add(buildNodeKey(node));
      }

      return nodeMatches || childrenMatch;
    };

    library.forEach((node) => {
      walk(node);
    });

    return keys;
  }, [library, normalizedQuery]);

  const handleToggle = useCallback((nodeKey: LibraryNodeKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) {
        next.delete(nodeKey);
      } else {
        next.add(nodeKey);
      }
      return next;
    });
  }, []);

  const renderNodes = useCallback(
    (nodes: DesignDocLibraryNodeDto[], depth: number) => {
      return (
        <EntityGrid
          items={nodes}
          keyExtractor={(node) => buildNodeKey(node)}
          renderItem={(node) => {
            const nodeKey = buildNodeKey(node);
            const isExpanded = autoExpandedKeys
              ? autoExpandedKeys.has(nodeKey)
              : expanded.has(nodeKey);
            const isSelected = selectedId ? node.id === selectedId : false;
            const hasNestedChildren = hasChildren(node);

            return (
              <Box>
                <LibraryListItem
                  node={node}
                  depth={depth}
                  isExpanded={isExpanded}
                  isSelected={isSelected}
                  hasNestedChildren={hasNestedChildren}
                  isAutoExpanded={Boolean(autoExpandedKeys)}
                  onToggle={
                    autoExpandedKeys ? undefined : () => handleToggle(nodeKey)
                  }
                  onClick={onEntityClick}
                />
                {hasNestedChildren ? (
                  <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                    {renderNodes(node.children, depth + 1)}
                  </Collapse>
                ) : null}
              </Box>
            );
          }}
          spacing={0.5}
          variant="list"
        />
      );
    },
    [autoExpandedKeys, expanded, handleToggle, onEntityClick, selectedId]
  );

  return (
    <Box component="nav" aria-label={ariaLabel}>
      {renderNodes(library, 0)}
    </Box>
  );
}
