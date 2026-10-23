import React, { useMemo } from "react";
import type { DesignDocResponseDto } from "../../api";
import { usePathService } from "../../contexts";
import { EntityGrid, EntityListItem, designDocAdapter } from "../Entity";

export interface DesignDocListProps {
  designDocs: DesignDocResponseDto[];
  projectId?: string;
  loading?: boolean;
  search?: string;
  sortBy?: string;
  onNavigate?: (doc: DesignDocResponseDto) => void;
  emptyMessage?: string;
}

export const DesignDocList: React.FC<DesignDocListProps> = ({
  designDocs,
  projectId,
  loading: externalLoading = false,
  search = "",
  sortBy = "created-desc",
  onNavigate,
  emptyMessage,
}) => {
  const pathService = usePathService();
  const isLoadingState = externalLoading;

  // Filter and sort design docs
  const filteredAndSortedLinks = useMemo(() => {
    let filtered = [...designDocs];

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((doc) => {
        const name = doc.name?.toLowerCase() || "";
        const docId = doc.id?.toLowerCase() || "";
        return name.includes(searchLower) || docId.includes(searchLower);
      });
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "created-asc": {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return aTime - bTime;
        }
        case "created-desc": {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return bTime - aTime;
        }
        case "name-asc": {
          const aName = a.name || "";
          const bName = b.name || "";
          return aName.localeCompare(bName);
        }
        case "name-desc": {
          const aName = a.name || "";
          const bName = b.name || "";
          return bName.localeCompare(aName);
        }
        default: {
          // Default to created-desc (newest first)
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return bTime - aTime;
        }
      }
    });

    return filtered;
  }, [designDocs, search, sortBy]);

  return (
    <EntityGrid
      items={filteredAndSortedLinks}
      loading={isLoadingState}
      renderItem={(doc) => {
        const handleClick = onNavigate
          ? () => {
              onNavigate(doc);
            }
          : undefined;

        const props = designDocAdapter.toEntityListItemProps(doc, {
          projectId,
          pathService,
          onClick: handleClick,
        });

        return <EntityListItem {...props} />;
      }}
      keyExtractor={(doc) => doc.id}
      emptyMessage={emptyMessage || "No design documents available"}
      spacing={0}
    />
  );
};
