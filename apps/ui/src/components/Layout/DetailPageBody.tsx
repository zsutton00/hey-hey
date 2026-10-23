import React from "react";
import { Box, Stack, useMediaQuery, useTheme } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import {
  DetailPageContextualRail,
  DetailPageContextualRailToggle,
} from "./DetailPageContextualRail";

type DetailPageBodyWidthStrategy = "fixed-sidebar" | "equal-split";

interface DetailPageBodyPanePadding {
  content?: SxProps<Theme>;
  sidebar?: SxProps<Theme>;
}

interface DetailPageContextualRailConfig {
  id: string;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  sx?: SxProps<Theme>;
}

export interface DetailPageBodyProps {
  sidebar: React.ReactNode;
  content: React.ReactNode;
  sidebarSide?: "left" | "right";
  widthStrategy?: DetailPageBodyWidthStrategy;
  gap?: number;
  panePadding?: DetailPageBodyPanePadding;
  contextualRail?: DetailPageContextualRailConfig;
  fillHeight?: boolean;
}

const SIDEBAR_WIDTH_PX = 400;

const wrapWithPadding = (
  node: React.ReactNode,
  padding: SxProps<Theme> | undefined,
): React.ReactNode => {
  if (padding === undefined) {
    return node;
  }
  return <Box sx={padding}>{node}</Box>;
};

export const DetailPageBody: React.FC<DetailPageBodyProps> = ({
  sidebar,
  content,
  sidebarSide = "left",
  widthStrategy = "fixed-sidebar",
  gap = 3,
  panePadding,
  contextualRail,
  fillHeight = false,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const hasSidebarContent =
    sidebar !== null && sidebar !== undefined && sidebar !== false;
  const hasSidebar =
    hasSidebarContent && (!contextualRail || contextualRail.expanded);

  const paddedContent = wrapWithPadding(content, panePadding?.content);
  const paddedSidebar = wrapWithPadding(sidebar, panePadding?.sidebar);

  const renderRail = (node: React.ReactNode) =>
    contextualRail ? (
      <DetailPageContextualRail
        expanded={contextualRail.expanded}
        label={contextualRail.label}
        controlsId={contextualRail.id}
        onToggle={contextualRail.onToggle}
        side={sidebarSide}
        fillHeight={fillHeight && !isMobile}
        sx={contextualRail.sx}
      >
        {node}
      </DetailPageContextualRail>
    ) : (
      node
    );

  const renderCollapsedToggle = contextualRail ? (
    <Box
      sx={{
        position: "absolute",
        right: sidebarSide === "right" ? 16 : "auto",
        left: sidebarSide === "left" ? 16 : "auto",
        top: 8,
        zIndex: 1,
      }}
    >
      <DetailPageContextualRailToggle
        expanded={false}
        label={contextualRail.label}
        controlsId={contextualRail.id}
        onToggle={contextualRail.onToggle}
      />
    </Box>
  ) : null;

  const renderContentOnly = () => {
    if (contextualRail && !hasSidebar) {
      return (
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: "100%",
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {paddedContent}
          {renderCollapsedToggle}
        </Box>
      );
    }
    return paddedContent;
  };

  if (isMobile) {
    if (!hasSidebar) {
      return <>{renderContentOnly()}</>;
    }
    return (
      <Stack spacing={gap}>
        {paddedContent}
        {renderRail(paddedSidebar)}
      </Stack>
    );
  }

  if (!hasSidebar) {
    if (panePadding?.content === undefined && !contextualRail) {
      return <>{content}</>;
    }
    return (
      <Box sx={{ width: "100%", minWidth: 0, minHeight: 0 }}>
        {renderContentOnly()}
      </Box>
    );
  }

  const sidebarSizingSx =
    widthStrategy === "equal-split"
      ? { flex: "1 1 50%", minWidth: 0 }
      : {
          flex: `0 0 ${SIDEBAR_WIDTH_PX}px`,
          width: SIDEBAR_WIDTH_PX,
          maxWidth: SIDEBAR_WIDTH_PX,
          minWidth: 0,
        };
  const contentSizingSx =
    widthStrategy === "equal-split"
      ? { flex: "1 1 50%", minWidth: 0 }
      : { flex: "1 1 0", minWidth: 0 };

  const sidebarBox = (
    <Box
      sx={{
        ...sidebarSizingSx,
        ...(fillHeight
          ? {
              display: "flex",
              flexDirection: "column",
              height: "100%",
              minHeight: 0,
            }
          : {}),
        ...(panePadding?.sidebar as object),
      }}
    >
      {renderRail(sidebar)}
    </Box>
  );
  const contentBox = (
    <Box
      sx={{
        ...contentSizingSx,
        ...(fillHeight
          ? {
              display: "flex",
              flexDirection: "column",
              height: "100%",
              minHeight: 0,
            }
          : {}),
        ...(panePadding?.content as object),
      }}
    >
      {content}
    </Box>
  );

  return (
    <Box
      sx={{
        display: "flex",
        gap,
        width: "100%",
        minWidth: 0,
        ...(fillHeight ? { flex: 1, height: "100%", minHeight: 0 } : {}),
      }}
    >
      {sidebarSide === "left" ? sidebarBox : contentBox}
      {sidebarSide === "left" ? contentBox : sidebarBox}
    </Box>
  );
};
