import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { LAYOUT_CONSTANTS, CALCULATED_DIMENSIONS } from "../constants/layout";

interface WindowDimensions {
  width: number;
  height: number;
}

interface MainContentDimensions {
  /**
   * Available width for main content (excluding drawer when visible)
   */
  availableWidth: number;

  /**
   * Available height for main content (excluding header and padding)
   */
  availableHeight: number;

  /**
   * Content area width (available width minus padding)
   */
  contentWidth: number;

  /**
   * Content area height (available height minus padding)
   */
  contentHeight: number;
}

export interface AppDimensions {
  /**
   * Raw window dimensions
   */
  window: WindowDimensions;

  /**
   * Main content area dimensions
   */
  mainContent: MainContentDimensions;

  /**
   * Whether we're on a project page (affects drawer visibility)
   */
  isOnProjectPage: boolean;

  /**
   * Layout constants for reference
   */
  layout: typeof LAYOUT_CONSTANTS;
}

/**
 * Hook that provides comprehensive app dimension information
 * Automatically updates on window resize and route changes
 */
export const useAppDimensions = (): AppDimensions => {
  const location = useLocation();

  // Track window dimensions
  const [windowDimensions, setWindowDimensions] = useState<WindowDimensions>({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Determine if we're on a project page (affects drawer visibility)
  const isOnProjectPage =
    location.pathname.startsWith("/projects/") &&
    location.pathname.split("/").length >= 3 &&
    location.pathname.split("/")[2] !== "";

  // Update window dimensions on resize
  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Calculate main content dimensions
  const horizontalPadding =
    windowDimensions.width < 900
      ? LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.LEFT_XS +
        LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.RIGHT_XS
      : LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.LEFT_MD +
        LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.RIGHT_MD;

  const mainContent: MainContentDimensions = {
    availableWidth: isOnProjectPage
      ? windowDimensions.width - LAYOUT_CONSTANTS.DRAWER_WIDTH
      : windowDimensions.width,

    availableHeight: windowDimensions.height - LAYOUT_CONSTANTS.HEADER_HEIGHT,

    contentWidth: isOnProjectPage
      ? windowDimensions.width -
        LAYOUT_CONSTANTS.DRAWER_WIDTH -
        horizontalPadding
      : windowDimensions.width - horizontalPadding,

    contentHeight:
      windowDimensions.height - CALCULATED_DIMENSIONS.TOTAL_VERTICAL_OFFSET,
  };

  return {
    window: windowDimensions,
    mainContent,
    isOnProjectPage,
    layout: LAYOUT_CONSTANTS,
  };
};
