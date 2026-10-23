import React, { useMemo } from "react";
import { useTheme } from "@mui/material/styles";
import { useAppDimensions } from "../../hooks/useAppDimensions";

export type LayoutMode = "stack" | "compact" | "full";

export interface LayoutConfig {
  direction: "column" | "row";
  columnWidth: string;
  enableScrolling: boolean;
  showProgressBars: boolean;
  reducedAnimations: boolean;
  touchOptimized: boolean;
  stackSpacing: number;
}

export const useResponsiveLayout = () => {
  const { window: windowDims } = useAppDimensions();
  const theme = useTheme();

  const layoutMode = useMemo((): LayoutMode => {
    if (windowDims.width < theme.breakpoints.values.md) {
      return "stack"; // Mobile: Vertical stack (< 900px)
    } else if (windowDims.width < theme.breakpoints.values.lg) {
      return "compact"; // Tablet: Compact columns (900px - 1199px)
    } else {
      return "full"; // Desktop: Full experience (1200px+)
    }
  }, [windowDims.width, theme]);

  const layoutConfig: Record<LayoutMode, LayoutConfig> = {
    stack: {
      direction: "column",
      columnWidth: "100%",
      enableScrolling: false, // Traditional mobile scroll
      showProgressBars: false,
      reducedAnimations: true,
      touchOptimized: true,
      stackSpacing: 0,
    },
    compact: {
      direction: "row",
      columnWidth: "33.333%",
      enableScrolling: true, // Column scroll enabled
      showProgressBars: true,
      reducedAnimations: true, // Simplified animations for performance
      touchOptimized: true,
      stackSpacing: 2,
    },
    full: {
      direction: "row",
      columnWidth: "33.333%",
      enableScrolling: true, // Full column scroll experience
      showProgressBars: true,
      reducedAnimations: false, // Full animations
      touchOptimized: false,
      stackSpacing: 0,
    },
  };

  return {
    layoutMode,
    config: layoutConfig[layoutMode],
    windowDims,
    isMobile: layoutMode === "stack",
    isTablet: layoutMode === "compact",
    isDesktop: layoutMode === "full",
  };
};

interface ResponsiveHandlerProps {
  children: (layout: ReturnType<typeof useResponsiveLayout>) => React.ReactNode;
}

const ResponsiveHandler: React.FC<ResponsiveHandlerProps> = ({ children }) => {
  const layout = useResponsiveLayout();

  return <>{children(layout)}</>;
};

export default ResponsiveHandler;
