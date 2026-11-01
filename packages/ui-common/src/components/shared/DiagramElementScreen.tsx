import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { Box, Skeleton, Stack, Typography } from "@mui/material";
import React from "react";
import { WorkItemTypeSectionDefinitionKindEnum } from "../../api";
import {
  type DiagramElementScreenState,
  type DiagramScreenLayout,
  SCREEN_NAME_LINE_HEIGHT,
} from "./diagramScreenResolution";
import { HtmlCssSectionThumbnail } from "./HtmlCssSectionThumbnail";
import { StructuredMockupSectionThumbnail } from "./StructuredMockupSectionThumbnail";

export const DIAGRAM_SCREEN_UNAVAILABLE_TEXT = "Mockup preview unavailable";

export const DiagramElementScreenBody: React.FC<{
  state: Extract<DiagramElementScreenState, { kind: "loading" | "ready" }>;
  layout: DiagramScreenLayout;
  title: string;
  titleFontSize: string;
  titleColor: string;
  organizationId: string;
  projectId: string;
}> = ({
  state,
  layout,
  title,
  titleFontSize,
  titleColor,
  organizationId,
  projectId,
}) => (
  <Stack
    alignItems="center"
    sx={{
      height: "100%",
      minHeight: 0,
      boxSizing: "border-box",
      rowGap: `${layout.gap}px`,
    }}
  >
    <Box
      data-testid="diagram-element-screen"
      data-screen-state={state.kind}
      sx={{
        width: "100%",
        height: layout.areaHeight,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {state.kind === "loading" ? (
        <Skeleton
          variant="rounded"
          animation={false}
          aria-busy
          aria-label="Loading Mockup preview"
          data-testid="diagram-element-screen-loading"
          width={layout.areaWidth}
          height={layout.areaHeight}
        />
      ) : (
        <Box
          role="img"
          aria-label={`Mockup screen: ${state.mockupName || title}`}
          sx={{
            width: state.section.box.width,
            height: state.section.box.height,
            flexShrink: 0,
            pointerEvents: "none",
          }}
        >
          {state.section.definition.kind ===
          WorkItemTypeSectionDefinitionKindEnum.HtmlCss ? (
            <HtmlCssSectionThumbnail
              content={state.section.content}
              definition={state.section.definition}
              width={layout.areaWidth}
              maxHeight={layout.areaHeight}
              title={`${state.mockupName || title} screen`}
            />
          ) : (
            <StructuredMockupSectionThumbnail
              content={state.section.content}
              definition={state.section.definition}
              width={layout.areaWidth}
              maxHeight={layout.areaHeight}
              organizationId={organizationId}
              projectId={projectId}
            />
          )}
        </Box>
      )}
    </Box>
    <Typography
      data-testid="workflow-inline-step-title"
      variant="body2"
      fontWeight={700}
      sx={{
        width: "100%",
        textAlign: "center",
        color: titleColor,
        fontSize: titleFontSize,
        lineHeight: SCREEN_NAME_LINE_HEIGHT,
        flexShrink: 0,
        overflow: "hidden",
        whiteSpace: "normal",
        display: "-webkit-box",
        overflowWrap: "anywhere",
        WebkitLineClamp: layout.nameLineClamp,
        WebkitBoxOrient: "vertical",
      }}
    >
      {title}
    </Typography>
  </Stack>
);

/** Visible failure shown on the plain card when a Mockup screen cannot render. */
export const DiagramElementScreenUnavailable: React.FC = () => (
  <Stack
    direction="row"
    alignItems="center"
    spacing={0.5}
    role="status"
    data-testid="diagram-element-screen-unavailable"
    sx={{ color: "warning.main", flexShrink: 0 }}
  >
    <ErrorOutlineIcon aria-hidden sx={{ fontSize: "0.875rem" }} />
    <Typography
      variant="caption"
      sx={{ fontSize: "0.625rem", lineHeight: 1.2, fontWeight: 600 }}
    >
      {DIAGRAM_SCREEN_UNAVAILABLE_TEXT}
    </Typography>
  </Stack>
);
