import React from "react";
import { Box, Typography, Divider } from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";

interface CardHeaderProps {
  title: string;
  icon?: SvgIconComponent;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ title, icon: Icon }) => {
  return (
    <>
      <Box display="flex" alignItems="center" gap={1}>
        {Icon && <Icon sx={{ color: "heyhey.main" }} />}
        <Typography
          variant="subtitle2"
          color="heyhey.main"
          sx={{
            textTransform: "uppercase",
            fontWeight: 600,
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </Typography>
      </Box>
      <Divider />
    </>
  );
};