import React from "react";
import { Box, type SxProps, type Theme } from "@mui/material";

interface ColumnScrollContainerProps {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

const ColumnScrollContainer: React.FC<ColumnScrollContainerProps> = ({
  children,
  sx,
}) => {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "85vh", // Reduced from 100vh to show footer content below
        width: "100%",
        ...sx,
      }}
    >
      <Box
        data-column-scroll-container
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          height: "60vh", // Reduced from 66vh to show more of what's below
          // Now we can use 2/3 of the actual viewport width
          width: "66.67vw",
          maxWidth: "none",
          overflow: "hidden",
          contain: "layout style paint",
          cursor: "grab",
          borderRadius: 2,
          "&:active": {
            cursor: "grabbing",
          },
        }}
      >
        {children}
      </Box>
    </Box>
  );
};

export default ColumnScrollContainer;
