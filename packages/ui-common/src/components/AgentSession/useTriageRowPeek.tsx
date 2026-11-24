import { Paper, Popper, Typography } from "@mui/material";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LayoutRow } from "../../data/triage/replay";
import { useCanHover } from "../../hooks/useCanHover";
import { EntityHoverCard } from "../shared/EntityHoverCard";

/** Same rest delay as the Open Items sidebar's Peek. */
export const TRIAGE_PEEK_DELAY_MS = 400;
/** Same row-to-card handoff window as the sidebar. */
const CLOSE_HANDOFF_MS = 120;

type PeekTarget = NonNullable<Extract<LayoutRow, { kind: "item" }>["peek"]>;

export interface TriagePeekScope {
  organizationId: string;
  projectId: string;
}

export interface RowPeekHandlers {
  onMouseEnter: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
}

/**
 * The sidebar's transient Peek for the triage preview rows: opens after a
 * 400 ms rest, never on devices that cannot hover, and is purely
 * observational (it touches no suggestion highlight and triggers no replay).
 */
export function useTriageRowPeek(scope: TriagePeekScope): {
  peekHandlers: (target: PeekTarget | null) => RowPeekHandlers | undefined;
  peekNode: ReactNode;
} {
  const canHover = useCanHover();
  const [open, setOpen] = useState<{
    anchor: HTMLElement;
    target: PeekTarget;
  } | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const clearOpen = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearOpen();
    clearClose();
    closeTimer.current = setTimeout(() => setOpen(null), CLOSE_HANDOFF_MS);
  }, [clearClose, clearOpen]);

  const scheduleOpen = useCallback(
    (anchor: HTMLElement, target: PeekTarget) => {
      clearClose();
      clearOpen();
      openTimer.current = setTimeout(() => {
        openTimer.current = null;
        // A scroll under a stationary pointer can skip mouseleave.
        if (!anchor.matches(":hover")) {
          return;
        }
        setOpen({ anchor, target });
      }, TRIAGE_PEEK_DELAY_MS);
    },
    [clearClose, clearOpen],
  );

  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleScroll = () => setOpen(null);
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [isOpen]);

  useEffect(
    () => () => {
      clearOpen();
      clearClose();
    },
    [clearClose, clearOpen],
  );

  const peekHandlers = (target: PeekTarget | null) => {
    if (!canHover || !target) {
      return undefined;
    }
    return {
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) =>
        scheduleOpen(event.currentTarget, target),
      onMouseLeave: scheduleClose,
    };
  };

  let peekNode: ReactNode = null;
  if (open) {
    peekNode = open.target.note ? (
      <Popper
        anchorEl={open.anchor}
        open
        placement="right-start"
        sx={{ zIndex: (theme) => theme.zIndex.tooltip }}
      >
        <Paper
          elevation={6}
          onMouseEnter={clearClose}
          onMouseLeave={scheduleClose}
          sx={{ maxWidth: 320, ml: 1, p: 1.5 }}
        >
          <Typography
            data-testid="triage-preview-peek-note"
            variant="body2"
            sx={{ whiteSpace: "pre-wrap" }}
          >
            {open.target.note}
          </Typography>
        </Paper>
      </Popper>
    ) : (
      <EntityHoverCard
        entityId={open.target.entityId}
        entityType={open.target.entityType}
        organizationId={scope.organizationId}
        projectId={scope.projectId}
        anchorEl={open.anchor}
        placement="right-start"
        onPopoverMouseEnter={clearClose}
        onPopoverMouseLeave={scheduleClose}
      />
    );
  }

  return { peekHandlers, peekNode };
}
