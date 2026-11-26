import type { ComponentType } from "react";
import { Box, type SvgIconProps } from "@mui/material";
import { getFallbackEntityColors } from "../../utils/entityIcons";

export const DIAGRAM_ROLE_BADGE_SIZE = 20;

export const getDiagramRoleBadgeSx = () => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  width: DIAGRAM_ROLE_BADGE_SIZE,
  height: DIAGRAM_ROLE_BADGE_SIZE,
  borderRadius: "2px",
  bgcolor: getFallbackEntityColors().background,
  color: getFallbackEntityColors().color,
  lineHeight: 0,
});

/** The role icon on its tile, as Diagram Element cards show it. */
export function DiagramRoleIconBadge({
  Icon,
  iconTestId,
}: {
  Icon: ComponentType<SvgIconProps>;
  iconTestId?: string;
}) {
  return (
    <Box component="span" sx={getDiagramRoleBadgeSx()}>
      <Icon aria-hidden data-testid={iconTestId} sx={{ fontSize: "1rem" }} />
    </Box>
  );
}
