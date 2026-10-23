import React from "react";
import { Box, Divider, Stack, Typography } from "@mui/material";

export interface MetadataItem {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}

export interface MetadataPanelProps {
  items: MetadataItem[];
}

export const MetadataPanel: React.FC<MetadataPanelProps> = ({ items }) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <Box>
      <Stack divider={<Divider />} spacing={2}>
        {items.map((item, index) => (
          <Box key={index}>
            <Stack direction="row" spacing={1} alignItems="center">
              {item.icon}
              <Box>
                <Typography variant="body2" color="text.secondary">
                  {item.label}
                </Typography>
                <Typography variant="body2">{item.value}</Typography>
              </Box>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
};
