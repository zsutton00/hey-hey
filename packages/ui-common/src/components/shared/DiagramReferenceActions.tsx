import type { ComponentType } from "react";
import {
  Box,
  Button,
  IconButton,
  Tooltip,
  type SvgIconProps,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import {
  DiagramRoleIconBadge,
  getDiagramRoleBadgeSx,
} from "./DiagramRoleIconBadge";

interface DiagramReferenceActionsProps {
  Icon: ComponentType<SvgIconProps>;
  roleLabel: string;
  /** Where the card's role icon sits, measured from the card's outer edge. */
  position: { top: number; left: number };
  href: string | undefined;
  selected: boolean;
  onExplore: (() => void) | undefined;
}

export function DiagramReferenceActions({
  Icon,
  roleLabel,
  position,
  href,
  selected,
  onExplore,
}: DiagramReferenceActionsProps) {
  const action = href
    ? "Open linked Diagram"
    : "Linked Diagram navigation unavailable";

  return (
    <Box
      className="nodrag nopan"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Tooltip title={`${roleLabel}: ${action}`}>
        {/* Covers the card's role icon, so one icon names the role and opens. */}
        <Box
          sx={{
            position: "absolute",
            top: position.top,
            left: position.left,
            zIndex: 2,
            lineHeight: 0,
          }}
        >
          {href ? (
            <IconButton
              component={RouterLink}
              to={href}
              aria-label="Open linked Diagram"
              data-testid="diagram-reference-open"
              sx={{
                ...getDiagramRoleBadgeSx(),
                p: 0,
                "&:hover": {
                  bgcolor: getDiagramRoleBadgeSx().bgcolor,
                  opacity: 0.85,
                },
              }}
            >
              <Icon sx={{ fontSize: "1rem" }} />
            </IconButton>
          ) : (
            <DiagramRoleIconBadge Icon={Icon} />
          )}
        </Box>
      </Tooltip>
      {selected && onExplore ? (
        <Button
          size="small"
          data-testid="diagram-reference-expand"
          onClick={onExplore}
          sx={{
            position: "absolute",
            top: "100%",
            left: 0,
            bgcolor: "background.paper",
            zIndex: 1,
          }}
        >
          Explore linked Diagram
        </Button>
      ) : null}
    </Box>
  );
}
