import React from "react";
import { Button, Box } from "@mui/material";
import type { ButtonProps } from "@mui/material";
import { HoverScale, LoadingSpinner } from "../animations";

interface AnimatedButtonProps extends Omit<ButtonProps, "component"> {
  loading?: boolean;
  animate?: boolean;
}

const AnimatedButton: React.FC<AnimatedButtonProps> = ({
  loading = false,
  animate = true,
  children,
  disabled,
  startIcon,
  ...buttonProps
}) => {
  return (
    <HoverScale
      disabled={disabled || loading || !animate}
      scaleAmount={1.05}
      style={{
        flex: (buttonProps.sx as { flex?: string })?.flex || "initial",
        width: (buttonProps.sx as { width?: string })?.width || "auto",
        minWidth:
          (buttonProps.sx as { minWidth?: string | number })?.minWidth ||
          "auto",
        display: "flex", // Ensure flex behavior is preserved
      }}
    >
      <Button
        {...buttonProps}
        disabled={disabled || loading}
        startIcon={!loading ? startIcon : undefined}
        sx={{
          ...buttonProps.sx,
          width: "100%", // Make button fill the HoverScale container
        }}
      >
        {loading ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              width: "100%",
            }}
          >
            <LoadingSpinner size={16} />
          </Box>
        ) : (
          children
        )}
      </Button>
    </HoverScale>
  );
};

export default AnimatedButton;
