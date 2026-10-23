import React from "react";
import { Box, Typography, Card, CardActionArea } from "@mui/material";
import type { AvailableIntegrationCardProps } from "./types";

export const AvailableIntegrationCard: React.FC<
  AvailableIntegrationCardProps
> = ({ integration, onAdd, disabled = false }) => {
  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: "all 0.2s ease-in-out",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: 2,
          borderColor: "primary.main",
        },
      }}
    >
      <CardActionArea
        onClick={() => onAdd(integration.type)}
        disabled={disabled}
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          p: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          {integration.icon}
          <Typography variant="h6" component="h3" sx={{ ml: 1 }}>
            {integration.name}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {integration.description}
        </Typography>
      </CardActionArea>
    </Card>
  );
};
