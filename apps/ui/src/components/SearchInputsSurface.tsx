import React from "react";
import {
  Box,
  type BoxProps,
  useMediaQuery,
  useTheme,
} from "@mui/material";

export const SearchInputsSurface = React.forwardRef<
  HTMLDivElement,
  BoxProps
>(function SearchInputsSurface({ sx, ...props }, ref) {
  const theme = useTheme();
  const isMobileViewport = useMediaQuery(theme.breakpoints.down("md"));

  const searchHelperSx = {
    "& .MuiInputAdornment-root, & .MuiInputBase-adornedEnd > .MuiTypography-root": {
      display: isMobileViewport ? "none" : "flex",
    },
  };

  return (
    <Box
      ref={ref}
      {...props}
      sx={[searchHelperSx, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  );
});

