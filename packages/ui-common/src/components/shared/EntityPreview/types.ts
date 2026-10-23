import type { SearchEntity } from "../../AdvancedSearch/types";
import type { RelatedEntityDto } from "../../../types/secondaryActions";

export type PreviewableEntity = SearchEntity | RelatedEntityDto;

export interface NormalizedEntity {
  id: string;
  type: string;
  name: string;
  description?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface EntityPreviewAction {
  label: string;
  onClick: () => void;
  variant?: "text" | "outlined" | "contained";
  disabled?: boolean;
  testId?: string;
}

export interface EntityPreviewProps {
  entity: PreviewableEntity;
  organizationId: string;
  projectId: string;
  onClose: () => void;
  secondaryAction?: EntityPreviewAction;
  additionalActions?: EntityPreviewAction[];
  showCloseButton?: boolean;
  headerContent?: React.ReactNode;
}
