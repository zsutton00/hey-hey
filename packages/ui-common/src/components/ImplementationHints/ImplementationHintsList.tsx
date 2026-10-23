import React from "react";
import { Box } from "@mui/material";
import type { ImplementationHintDto } from "../../api";
import { useDeleteImplementationHint } from "../../data";
import {
  EntityGrid,
  EntityListItem,
  implementationHintAdapter,
} from "../Entity";

export interface ImplementationHintsListProps {
  organizationId: string;
  serviceId: string;
  hints: ImplementationHintDto[];
  isLoading?: boolean;
  searchTerm?: string;
  emptyMessage?: string;
  onHintClick?: (hint: ImplementationHintDto) => void;
  onHintDeleted?: (hint: ImplementationHintDto) => void;
}

export const ImplementationHintsList: React.FC<
  ImplementationHintsListProps
> = ({
  organizationId,
  serviceId,
  hints,
  isLoading = false,
  searchTerm = "",
  emptyMessage,
  onHintClick,
  onHintDeleted,
}) => {
  const { deleteImplementationHint } = useDeleteImplementationHint({
    organizationId,
    serviceId,
  });
  const fallbackEmptyMessage = searchTerm
    ? "No implementation hints match your search"
    : "No implementation hints found";
  const resolvedEmptyMessage = emptyMessage ?? fallbackEmptyMessage;

  const createDeleteHandler = (hint: ImplementationHintDto) => {
    return () => {
      void deleteImplementationHint(hint.id, {
        onSuccess: () => {
          onHintDeleted?.(hint);
        },
        onError: (error) => {
          console.error("Failed to delete implementation hint:", error);
        },
      });
    };
  };

  return (
    <Box data-testid="implementation-hints-list">
      <EntityGrid
        items={hints}
        loading={isLoading}
        renderItem={(hint) => {
          const handleDelete = createDeleteHandler(hint);
          const props = implementationHintAdapter.toEntityListItemProps(hint);
          const handleClick = onHintClick
            ? (event: React.MouseEvent<HTMLElement>) => {
                if (!props.href) {
                  event.preventDefault();
                }
                onHintClick(hint);
              }
            : undefined;

          return (
            <EntityListItem
              {...props}
              onClick={handleClick}
              onDelete={handleDelete}
            />
          );
        }}
        keyExtractor={(hint) => hint.id}
        emptyMessage={resolvedEmptyMessage}
      />
    </Box>
  );
};
