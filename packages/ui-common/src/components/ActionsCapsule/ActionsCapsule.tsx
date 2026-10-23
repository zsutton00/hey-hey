import CloseIcon from "@mui/icons-material/Close";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  Box,
  IconButton,
  Slide,
  Typography,
  useMediaQuery,
  useTheme,
  type SxProps,
  type Theme,
} from "@mui/material";
import { motion } from "motion/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { capsuleExpandVariants } from "../../animations/variants";
import { useActionsCapsule } from "./ActionsCapsuleContext";
import { CapsuleActionButton } from "./CapsuleActionButton";
import { CapsuleMenuItemsList } from "./CapsuleMenuItemsList";
import { sortCapsuleActions } from "./sortCapsuleActions";
import { useSearchAction } from "./useSearchAction";
import { ScratchpadDropTarget } from "../Scratchpad/ScratchpadDropTarget";
import { useScratchpadCapsuleAction } from "../Scratchpad/useScratchpadCapsuleAction";
import { useDndContextSafe } from "../../contexts/DndContext";
import type { CapsuleActionRegistration } from "./types";

type CapsuleAnchor = "bottom-right" | "bottom-left";

const getCapsuleSx = (
  isExpanded: boolean,
  isFullSize: boolean,
  anchor: CapsuleAnchor,
  hasTopContent: boolean
): SxProps<Theme> => ({
  position: "fixed",
  bottom: 32,
  ...(anchor === "bottom-right" ? { right: 32 } : { left: 32 }),
  width: isFullSize ? "calc(100vw - 300px)" : isExpanded ? 800 : "auto",
  maxHeight: isFullSize
    ? "calc(100vh - 150px)"
    : isExpanded
    ? 620
    : hasTopContent
    ? 200
    : 82,
  bgcolor: "background.paper",
  border: 1,
  borderColor: (theme) =>
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.24)"
      : theme.palette.divider,
  borderRadius: hasTopContent ? "16px" : "32px",
  boxShadow: (theme) =>
    theme.palette.mode === "dark"
      ? "0 0 0 1px rgba(255, 255, 255, 0.08), 0 12px 28px rgba(0, 0, 0, 0.6)"
      : theme.shadows[3],
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  transformOrigin: anchor === "bottom-right" ? "bottom right" : "bottom left",
  zIndex: (theme) => theme.zIndex.drawer + 1,
});

const dividerSx = {
  width: "1px",
  height: "32px",
  mx: 0.5,
  flexShrink: 0,
  backgroundColor: (theme: Theme) =>
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.26)"
      : "rgba(0, 0, 0, 0.2)",
} as const;

export const ActionsCapsule: React.FC = () => {
  const {
    actions,
    activeActionId,
    activeMenuItemId,
    isFullSize,
    isMinimized,
    expandAction,
    collapseAction,
    toggleFullSize,
    toggleMinimize,
    setActiveMenuItem,
  } = useActionsCapsule();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const searchAction = useSearchAction();
  const scratchpadAction = useScratchpadCapsuleAction();
  const dndState = useDndContextSafe();
  const isDragging = dndState?.isDragging ?? false;

  const containerRef = useRef<HTMLDivElement>(null);
  const [inactiveWidth, setInactiveWidth] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<CapsuleAnchor>(() => {
    const stored = localStorage.getItem("capsule-anchor");
    return stored === "bottom-left" ? "bottom-left" : "bottom-right";
  });

  const sortedActions = sortCapsuleActions([
    ...actions,
    searchAction,
    ...(scratchpadAction ? [scratchpadAction] : []),
  ]);
  const scrollableActions = sortedActions.filter((a) => a.tier !== "site");
  const pinnedActions = sortedActions.filter((a) => a.tier === "site");

  const activeAction = sortedActions.find((a) => a.id === activeActionId);
  const activeExpandableAction =
    activeAction?.behavior === "expand" ? activeAction : null;
  const isExpanded = activeExpandableAction !== null;
  const hasTopContent = isExpanded || isDragging;
  const isBottomRightAnchor = anchor === "bottom-right";

  const handleToggleAnchor = useCallback(() => {
    setAnchor((currentAnchor) => {
      const next =
        currentAnchor === "bottom-right" ? "bottom-left" : "bottom-right";
      localStorage.setItem("capsule-anchor", next);
      return next;
    });
  }, []);

  const handleActionClick = useCallback(
    (action: CapsuleActionRegistration) => {
      if (action.behavior === "click") {
        action.onClick();
        return;
      }
      if (action.id === activeActionId) {
        collapseAction();
      } else {
        expandAction(action.id);
      }
    },
    [activeActionId, collapseAction, expandAction]
  );

  useEffect(() => {
    if (isExpanded || !containerRef.current) return;

    const observer = new ResizeObserver(() => {
      const width = containerRef.current?.offsetWidth;
      if (width) setInactiveWidth(width);
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        collapseAction();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isExpanded, collapseAction]);

  if (isMinimized && !isMobile) {
    return (
      <Box
        component={motion.div}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        sx={{
          position: "fixed",
          bottom: 32,
          ...(anchor === "bottom-right" ? { right: 32 } : { left: 32 }),
          zIndex: (theme) => theme.zIndex.drawer + 1,
        }}
        data-testid="actions-capsule-minimized"
      >
        <IconButton
          onClick={toggleMinimize}
          aria-label="Restore actions capsule"
          data-testid="capsule-restore-button"
          sx={{
            bgcolor: "background.paper",
            border: 1,
            borderColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(255, 255, 255, 0.24)"
                : theme.palette.divider,
            boxShadow: (theme) =>
              theme.palette.mode === "dark"
                ? "0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 16px rgba(0, 0, 0, 0.6)"
                : theme.shadows[3],
            width: 44,
            height: 44,
            "&:hover": {
              bgcolor: "action.hover",
            },
          }}
        >
          <OpenInNewIcon fontSize="small" />
        </IconButton>
      </Box>
    );
  }

  if (isMobile) {
    return (
      <Box
        ref={containerRef}
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          paddingBottom: "env(safe-area-inset-bottom)",
          bgcolor: "background.paper",
          borderTop: 1,
          borderColor: "divider",
          zIndex: (theme) => theme.zIndex.drawer + 1,
        }}
        data-testid="actions-capsule"
      >
        <Slide direction="up" in={isExpanded} mountOnEnter unmountOnExit>
          <Box
            sx={{
              overflowX: "hidden",
              overflowY: "auto",
              p: 3,
              maxHeight: 400,
            }}
            data-testid="capsule-expanded-content"
          >
            {activeExpandableAction?.menuItems &&
            activeExpandableAction.menuItems.length > 0 &&
            !activeMenuItemId ? (
              <CapsuleMenuItemsList
                menuItems={activeExpandableAction.menuItems}
                onItemClick={(itemId) => setActiveMenuItem(itemId)}
                colorIndex={sortedActions.findIndex(
                  (a) => a.id === activeActionId
                )}
                inactiveWidth={inactiveWidth}
              />
            ) : (
              activeExpandableAction?.renderContent()
            )}
          </Box>
        </Slide>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1,
            height: 48,
            flexShrink: 0,
            overflow: "hidden",
          }}
          data-testid="actions-capsule-toolbar"
        >
          <Box
            sx={{
              flex: 1,
              overflowX: "auto",
              display: "flex",
              alignItems: "center",
              gap: 1,
              position: "relative",
            }}
          >
            {scrollableActions.map((action, localIdx) => {
              const globalIdx = sortedActions.findIndex(
                (a) => a.id === action.id
              );
              const previousAction =
                localIdx > 0 ? scrollableActions[localIdx - 1] : null;
              const showDivider =
                previousAction !== null && previousAction.tier !== action.tier;

              return (
                <React.Fragment key={action.id}>
                  {showDivider && <Box sx={dividerSx} />}
                  <Box sx={{ flexShrink: 0 }}>
                    <CapsuleActionButton
                      action={action}
                      idx={globalIdx}
                      isActive={action.id === activeActionId}
                      inProgress={action.inProgress}
                      isAnyExpanded={isExpanded}
                      onClick={() => handleActionClick(action)}
                      compact
                    />
                  </Box>
                </React.Fragment>
              );
            })}
          </Box>

          {scrollableActions.length > 0 && pinnedActions.length > 0 && (
            <Box sx={dividerSx} />
          )}

          <Box
            sx={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            {pinnedActions.map((action) => {
              const globalIdx = sortedActions.findIndex(
                (a) => a.id === action.id
              );
              return (
                <CapsuleActionButton
                  key={action.id}
                  action={action}
                  idx={globalIdx}
                  isActive={action.id === activeActionId}
                  inProgress={action.inProgress}
                  isAnyExpanded={isExpanded}
                  onClick={() => handleActionClick(action)}
                  compact
                />
              );
            })}
          </Box>

          {isExpanded && (
            <IconButton
              size="small"
              onClick={collapseAction}
              data-testid="capsule-close-button"
            >
              <CloseIcon />
            </IconButton>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      component={motion.div}
      variants={capsuleExpandVariants}
      initial="inactive"
      animate={
        isExpanded
          ? isFullSize
            ? "full-size"
            : "active"
          : isDragging
          ? "drag"
          : "inactive"
      }
      sx={getCapsuleSx(isExpanded, isFullSize, anchor, hasTopContent)}
      data-testid="actions-capsule"
    >
      {isExpanded && activeExpandableAction?.title && (
        <Box
          sx={{
            bgcolor: "rgb(66, 66, 66)",
            color: "white",
            px: 3,
            py: 1.5,
            flexShrink: 0,
          }}
          data-testid="capsule-title-bar"
        >
          <Typography variant="h6" fontWeight={600}>
            {activeExpandableAction.title}
          </Typography>
        </Box>
      )}

      {isExpanded && activeExpandableAction && (
        <Box
          sx={{
            flex: 1,
            overflowX: "hidden",
            overflowY: "auto",
            p: 3,
            maxHeight: isFullSize ? "none" : 400,
          }}
          data-testid="capsule-expanded-content"
        >
          {activeExpandableAction.menuItems &&
          activeExpandableAction.menuItems.length > 0 &&
          !activeMenuItemId ? (
            <CapsuleMenuItemsList
              menuItems={activeExpandableAction.menuItems}
              onItemClick={(itemId) => setActiveMenuItem(itemId)}
              colorIndex={sortedActions.findIndex(
                (a) => a.id === activeActionId
              )}
              inactiveWidth={inactiveWidth}
            />
          ) : (
            activeExpandableAction.renderContent()
          )}
        </Box>
      )}

      <ScratchpadDropTarget isExpanded={isExpanded} />

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 3,
          height: 82,
          flexShrink: 0,
          borderTop: isExpanded ? 1 : 0,
          borderColor: "divider",
          overflow: "hidden",
        }}
        data-testid="actions-capsule-toolbar"
      >
        <Box
          sx={{
            flex: 1,
            overflowX: "auto",
            display: "flex",
            alignItems: "center",
            gap: 1,
            position: "relative",
          }}
        >
          {scrollableActions.map((action, localIdx) => {
            const globalIdx = sortedActions.findIndex(
              (a) => a.id === action.id
            );
            const previousAction =
              localIdx > 0 ? scrollableActions[localIdx - 1] : null;
            const showDivider =
              previousAction !== null && previousAction.tier !== action.tier;

            return (
              <React.Fragment key={action.id}>
                {showDivider && <Box sx={dividerSx} />}
                <Box sx={{ flexShrink: 0 }}>
                  <CapsuleActionButton
                    action={action}
                    idx={globalIdx}
                    isActive={action.id === activeActionId}
                    inProgress={action.inProgress}
                    isAnyExpanded={isExpanded}
                    onClick={() => handleActionClick(action)}
                  />
                </Box>
              </React.Fragment>
            );
          })}

          {isExpanded && (
            <Box
              data-testid="actions-capsule-overlay"
              sx={{
                position: "absolute",
                inset: -2,
                bgcolor: (theme) =>
                  theme.palette.mode === "dark"
                    ? "rgba(0, 0, 0, 0.45)"
                    : "rgba(255, 255, 255, 0.6)",
                pointerEvents: "none",
                borderRadius: 1,
              }}
            />
          )}
        </Box>

        {scrollableActions.length > 0 && pinnedActions.length > 0 && (
          <Box sx={dividerSx} />
        )}

        <Box
          sx={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          {pinnedActions.map((action) => {
            const globalIdx = sortedActions.findIndex(
              (a) => a.id === action.id
            );
            return (
              <CapsuleActionButton
                key={action.id}
                action={action}
                idx={globalIdx}
                isActive={action.id === activeActionId}
                inProgress={action.inProgress}
                isAnyExpanded={isExpanded}
                onClick={() => handleActionClick(action)}
              />
            );
          })}
        </Box>

        <IconButton
          size="small"
          onClick={handleToggleAnchor}
          data-testid="capsule-position-button"
          aria-label={
            isBottomRightAnchor
              ? "Move actions capsule to bottom left"
              : "Move actions capsule to bottom right"
          }
        >
          {isBottomRightAnchor ? (
            <KeyboardDoubleArrowLeftIcon />
          ) : (
            <KeyboardDoubleArrowRightIcon />
          )}
        </IconButton>

        <IconButton
          size="small"
          onClick={toggleMinimize}
          data-testid="capsule-minimize-button"
          aria-label="Minimize actions capsule"
        >
          <RemoveIcon />
        </IconButton>

        {isExpanded && activeExpandableAction?.expandable && (
          <IconButton
            size="small"
            onClick={toggleFullSize}
            data-testid="capsule-fullsize-button"
          >
            {isFullSize ? <CloseFullscreenIcon /> : <OpenInFullIcon />}
          </IconButton>
        )}

        {isExpanded && (
          <IconButton
            size="small"
            onClick={collapseAction}
            data-testid="capsule-close-button"
          >
            {activeExpandableAction?.resumable ? (
              <KeyboardArrowDownIcon />
            ) : (
              <CloseIcon />
            )}
          </IconButton>
        )}
      </Box>
    </Box>
  );
};
