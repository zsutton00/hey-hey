import { Box, Link, useTheme } from "@mui/material";
import type { TaskResponseDto, WorkItemTypeDefinitionDto } from "../../api";
import { Link as RouterLink } from "react-router-dom";
import { DiagramElementCardFace } from "./DiagramElementCardFace";
import { DiagramElementScreenBody } from "./DiagramElementScreen";
import { DiagramRoleIconBadge } from "./DiagramRoleIconBadge";
import {
  DIAGRAM_CARD_TEXT,
  getDiagramCardGeometry,
} from "./diagramElementCardGeometry";
import { getDiagramElementMetadata } from "./diagramElementMetadata";
import {
  getDiagramRoleDefinitions,
  getDiagramRoleIcon,
} from "./diagramElementRoles";
import {
  getDiagramScreenPlacement,
  useDiagramElementScreen,
  useDiagramScreenLayout,
} from "./diagramScreenResolution";

const size = { nodeSize: 140, cardPadding: 1.5, titleFontSize: "0.875rem" };

export function DiagramElementHoverFace({
  entity,
  definition,
  titleHref,
}: {
  entity: TaskResponseDto;
  titleHref: string;
  definition: WorkItemTypeDefinitionDto | undefined;
}) {
  const theme = useTheme();
  const metadata = getDiagramElementMetadata(entity);
  const roleKey = metadata?.role ?? "GENERIC";
  const role = getDiagramRoleDefinitions(definition).find(
    ({ key }) => key === roleKey,
  );
  const notation = role?.notation;
  const Icon = getDiagramRoleIcon(roleKey, notation);
  const layout = useDiagramScreenLayout(size);
  const scope = {
    organizationId: entity.organizationId,
    projectId: entity.projectId,
  };
  const screen = useDiagramElementScreen({
    ...scope,
    canonicalReference: metadata?.canonicalReference,
    projectedTarget: undefined,
    layout,
  });
  const showsScreen = screen.kind === "ready" || screen.kind === "loading";
  const placement =
    screen.kind === "ready"
      ? getDiagramScreenPlacement(size.nodeSize, screen)
      : undefined;
  const { content } = getDiagramCardGeometry("medium", size.nodeSize, notation);
  const frame = notation === "frame" && !showsScreen;
  const borderWidth = frame ? 3 : 1;
  const titleLink = (
    <Link
      component={RouterLink}
      to={titleHref}
      color="inherit"
      underline="hover"
      data-testid="entity-hover-card-title-link"
    >
      {entity.name}
    </Link>
  );
  const roleIcon = (
    <Box
      component="span"
      role="img"
      aria-label={role?.label ?? roleKey}
      sx={{ display: "inline-flex", flexShrink: 0 }}
    >
      <DiagramRoleIconBadge Icon={Icon} />
    </Box>
  );

  return (
    <Box
      data-testid="diagram-element-hover-face"
      sx={{
        position: "relative",
        boxSizing: "border-box",
        width: size.nodeSize,
        height: size.nodeSize,
        overflow: "hidden",
        borderWidth,
        borderStyle: frame ? "double" : "solid",
        borderColor: frame
          ? "grey.500"
          : theme.palette.mode === "dark"
            ? "grey.700"
            : "grey.300",
        borderRadius: !showsScreen && notation === "cylinder" ? "45% / 12%" : 1,
        bgcolor: theme.palette.mode === "dark" ? "grey.800" : "common.white",
        p: showsScreen ? size.cardPadding : undefined,
        ...(!showsScreen && {
          padding: `${content.top - borderWidth}px ${content.side - borderWidth}px ${content.bottom - borderWidth}px`,
        }),
      }}
    >
      {showsScreen ? (
        <>
          <Box
            sx={{
              position: "absolute",
              zIndex: 1,
              top: placement ? placement.top + 5 : 6,
              left: placement ? placement.left + 5 : 6,
            }}
          >
            {roleIcon}
          </Box>
          <DiagramElementScreenBody
            state={screen}
            layout={layout}
            title={entity.name}
            titleLink={titleLink}
            titleFontSize={size.titleFontSize}
            titleColor={theme.palette.text.primary}
            {...scope}
          />
        </>
      ) : (
        <DiagramElementCardFace
          roleIcon={roleIcon}
          title={titleLink}
          summary={null}
          textColor={undefined}
          text={DIAGRAM_CARD_TEXT.medium}
          isSmall={false}
          isScreenUnavailable={screen.kind === "unavailable"}
          bottomReserve={0}
        />
      )}
    </Box>
  );
}
