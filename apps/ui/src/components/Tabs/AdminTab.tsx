import React from "react";
import { Box, Stack, Typography } from "@mui/material";
import { MetadataPanel, type MetadataItem } from "../Layout";
import { TabContainer } from "./TabContainer";

export interface StandardAdminMetadataInput {
  createdBy?: React.ReactNode;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  archivedAt?: string | Date | null;
  owner?: React.ReactNode;
}

export interface AdminTabProps {
  metadataItems?: MetadataItem[];
  actions?: React.ReactNode;
  emptyMessage?: string;
}

const formatAdminDate = (value?: string | Date | null): string | null => {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : null;
  }

  return date.toLocaleString();
};

export const buildAdminMetadataItems = (
  input: StandardAdminMetadataInput,
): MetadataItem[] => {
  const items: MetadataItem[] = [];

  if (input.createdBy) {
    items.push({ label: "Created By", value: input.createdBy });
  }

  const createdAt = formatAdminDate(input.createdAt);
  if (createdAt) {
    items.push({ label: "Created At", value: createdAt });
  }

  const updatedAt = formatAdminDate(input.updatedAt);
  if (updatedAt) {
    items.push({ label: "Updated At", value: updatedAt });
  }

  const archivedAt = formatAdminDate(input.archivedAt);
  if (archivedAt) {
    items.push({ label: "Archived At", value: archivedAt });
  }

  if (input.owner) {
    items.push({ label: "Owner", value: input.owner });
  }

  return items;
};

export const AdminTab: React.FC<AdminTabProps> = ({
  metadataItems = [],
  actions,
  emptyMessage = "No admin metadata available.",
}) => {
  const hasMetadata = metadataItems.length > 0;
  const hasActions = Boolean(actions);

  return (
    <TabContainer>
      {!hasMetadata && !hasActions ? (
        <Typography variant="body2" color="text.secondary">
          {emptyMessage}
        </Typography>
      ) : (
        <Stack spacing={3}>
          {hasMetadata && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Metadata
              </Typography>
              <MetadataPanel items={metadataItems} />
            </Box>
          )}
          {hasActions && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Actions
              </Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap">
                {actions}
              </Stack>
            </Box>
          )}
        </Stack>
      )}
    </TabContainer>
  );
};
