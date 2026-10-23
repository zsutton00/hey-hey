import type { ComponentType } from "react";
import {
  Box,
  Button,
  IconButton,
  Tooltip,
  type SvgIconProps,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

interface DiagramReferenceActionsProps {
  Icon: ComponentType<SvgIconProps>;
  href: string | undefined;
  selected: boolean;
  onExplore: (() => void) | undefined;
}

export function DiagramReferenceActions({
  Icon,
  href,
  selected,
  onExplore,
}: DiagramReferenceActionsProps) {
  return (
    <Box
      className="nodrag nopan"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Tooltip
        title={
          href ? "Open linked Diagram" : "Linked Diagram navigation unavailable"
        }
      >
        <Box sx={{ position: "absolute", top: 4, left: 8 }}>
          {href ? (
            <IconButton
              component={RouterLink}
              to={href}
              size="small"
              aria-label="Open linked Diagram"
              data-testid="diagram-reference-open"
            >
              <Icon sx={{ fontSize: "1rem" }} />
            </IconButton>
          ) : (
            <Icon color="disabled" sx={{ fontSize: "1rem" }} />
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
