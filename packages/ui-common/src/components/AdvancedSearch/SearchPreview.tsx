import React from "react";
import type { SearchEntity } from "./types";
import { EntityPreview } from "../shared/EntityPreview";

export interface SearchPreviewProps {
  entity: SearchEntity;
  organizationId: string;
  projectId: string;
  onClose: () => void;
  onSelect?: () => void;
  allowSelection: boolean;
  isSelected: boolean;
}

export const SearchPreview: React.FC<SearchPreviewProps> = ({
  entity,
  organizationId,
  projectId,
  onClose,
  onSelect,
  allowSelection,
  isSelected,
}) => {
  const secondaryAction =
    allowSelection && !isSelected && onSelect
      ? {
          label: "Select and Return",
          onClick: onSelect,
          testId: "search-preview-select-button",
        }
      : undefined;

  return (
    <EntityPreview
      entity={entity}
      organizationId={organizationId}
      projectId={projectId}
      onClose={onClose}
      secondaryAction={secondaryAction}
    />
  );
};
