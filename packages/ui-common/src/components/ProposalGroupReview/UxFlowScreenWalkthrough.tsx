import React, { useEffect, useMemo, useState } from "react";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import {
  deriveIncomingScreen,
  deriveScreenNextOptions,
  goBack,
  goToScreen,
  groupScreenNextOptions,
  orderFlowScreenIds,
  type UxFlowShape,
  type WalkthroughTrail,
} from "./deriveScreenNextOptions";

const RAIL_WIDTH = 72;

/** Left/right arrows step through screens unless the person is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * One UX flow screen at a time. The screen keeps nearly all the space; its
 * outgoing transitions sit behind a forward button on the right edge and the
 * screen the person came from behind a back button on the left edge.
 */
export const UxFlowScreenWalkthrough: React.FC<{
  flowName: string;
  flow: UxFlowShape;
  /** Positions saved on the Diagram, keyed by step id; they order the screens. */
  savedPositions: ReadonlyMap<string, { x: number; y: number }>;
  initialScreenId: string;
  renderScreen: (screenId: string) => React.ReactNode;
  onOpenFullFlow: () => void;
}> = ({
  flowName,
  flow,
  savedPositions,
  initialScreenId,
  renderScreen,
  onOpenFullFlow,
}) => {
  const [trail, setTrail] = useState<WalkthroughTrail>([initialScreenId]);
  const [panelOpen, setPanelOpen] = useState(false);
  const screenId = trail[trail.length - 1];
  const orderedIds = useMemo(
    () => orderFlowScreenIds(flow, savedPositions),
    [flow, savedPositions],
  );
  const names = useMemo(
    () => new Map(flow.steps.map((step) => [step.id, step.name])),
    [flow],
  );
  const groups = useMemo(
    () => groupScreenNextOptions(deriveScreenNextOptions(flow, screenId)),
    [flow, screenId],
  );
  const optionCount = groups.reduce(
    (count, group) => count + group.options.length,
    0,
  );
  const previousId = deriveIncomingScreen(trail);
  const position = orderedIds.indexOf(screenId) + 1;

  const show = (nextId: string) => {
    setTrail((current) => goToScreen(current, nextId));
    setPanelOpen(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      const step =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      const nextId = orderedIds[orderedIds.indexOf(screenId) + step];
      if (step !== 0 && nextId !== undefined) {
        event.preventDefault();
        setTrail((current) => goToScreen(current, nextId));
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [orderedIds, screenId]);

  return (
    <Stack
      data-testid="ux-flow-walkthrough"
      sx={{ height: "100%", minHeight: 0 }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={2}
        sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}
      >
        <Typography variant="subtitle1" fontWeight={600} noWrap>
          {flowName}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {`Screen ${position} of ${orderedIds.length}`}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          onClick={onOpenFullFlow}
          data-testid="ux-flow-open-full"
        >
          Open full flow
        </Button>
      </Stack>
      <Box
        sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}
      >
        <Box
          sx={{
            width: RAIL_WIDTH,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {previousId === null ? null : (
            <Stack alignItems="center" spacing={0.75}>
              <IconButton
                onClick={() => {
                  setTrail(goBack);
                  setPanelOpen(false);
                }}
                aria-label={`Back to ${names.get(previousId) ?? "previous screen"}`}
                data-testid="ux-flow-back-button"
                data-target-id={previousId}
                sx={{
                  width: 56,
                  height: 56,
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  "&:hover": { bgcolor: "primary.dark" },
                }}
              >
                <ArrowBackIcon fontSize="large" />
              </IconButton>
              <Typography variant="caption" noWrap>
                Back
              </Typography>
            </Stack>
          )}
        </Box>
        <Box
          data-testid="ux-flow-screen"
          data-screen-id={screenId}
          sx={{ flex: 1, minWidth: 0, overflow: "auto", p: 2 }}
        >
          {renderScreen(screenId)}
        </Box>
        <Box
          sx={{
            width: RAIL_WIDTH,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Stack alignItems="center" spacing={0.75}>
            <IconButton
              disabled={optionCount === 0}
              onClick={() => setPanelOpen((open) => !open)}
              aria-label={
                optionCount === 0 ? "No next options" : "Next options"
              }
              aria-expanded={panelOpen}
              data-testid="ux-flow-next-button"
              sx={{
                width: 56,
                height: 56,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                "&:hover": { bgcolor: "primary.dark" },
              }}
            >
              <ArrowForwardIcon fontSize="large" />
            </IconButton>
            <Typography variant="caption" noWrap>
              {optionCount > 1 ? `Next (${optionCount})` : "Next"}
            </Typography>
          </Stack>
        </Box>
        {panelOpen && optionCount > 0 ? (
          <Paper
            elevation={6}
            data-testid="ux-flow-next-panel"
            sx={{
              position: "absolute",
              top: "50%",
              transform: "translateY(-50%)",
              right: RAIL_WIDTH,
              width: 320,
              maxWidth: `calc(100% - ${RAIL_WIDTH * 2}px)`,
              maxHeight: "calc(100% - 32px)",
              overflow: "auto",
              p: 1.5,
            }}
          >
            <Stack spacing={1.5}>
              {groups.map((group) => (
                <Box
                  key={group.title}
                  data-testid="ux-flow-next-group"
                  data-role={group.role ?? "NONE"}
                >
                  <Typography variant="overline" color="text.secondary">
                    {group.title}
                  </Typography>
                  {group.options.map((option) => (
                    <ButtonBase
                      key={option.edgeId}
                      onClick={() => show(option.targetStepId)}
                      data-testid="ux-flow-next-option"
                      data-target-id={option.targetStepId}
                      sx={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        px: 1,
                        py: 0.75,
                        borderRadius: 1,
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      {option.actionLabel ? (
                        <Typography variant="body2" fontWeight={600}>
                          {option.actionLabel}
                        </Typography>
                      ) : null}
                      <Typography variant="caption" color="text.secondary">
                        {`→ ${option.targetName}`}
                      </Typography>
                    </ButtonBase>
                  ))}
                </Box>
              ))}
            </Stack>
          </Paper>
        ) : null}
      </Box>
    </Stack>
  );
};
