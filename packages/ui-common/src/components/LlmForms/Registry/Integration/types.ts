import React from "react";

export interface Integration {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  isConfigured: boolean;
  createdAt: string;
}

interface IntegrationConfigField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  description?: string;
}

export interface AvailableIntegration {
  type: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  configFields: IntegrationConfigField[];
  isApiDriven?: boolean; // Flag to indicate if this integration uses the new API system
}

export interface IntegrationSearchProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  disabled?: boolean;
}

export interface AvailableIntegrationCardProps {
  integration: AvailableIntegration;
  onAdd: (type: string) => void;
  disabled?: boolean;
}

export interface ConfiguredIntegrationsListProps {
  integrations: Integration[];
  onEdit: (integration: Integration) => void;
  onDelete: (integrationId: string) => void;
  disabled?: boolean;
}

export interface IntegrationConfigDialogProps {
  open: boolean;
  onClose: () => void;
  integration: AvailableIntegration | null;
  existingConfig?: Record<string, string>;
  onSave: (config: Record<string, string>) => void;
  isEditing?: boolean;
}
