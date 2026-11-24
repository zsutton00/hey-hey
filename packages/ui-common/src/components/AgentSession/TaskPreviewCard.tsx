import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { renderInlineMentions } from "../SmarterTextAreaCard/renderInlineMentions";

const taskContentSx = {
  maxWidth: "100ch",
  lineHeight: 1.6,
  fontSize: "1.1rem",
} as const;

interface TaskPreviewCardProps {
  task: WorkItemResponseDto;
  defaultExpanded?: boolean;
  collapseOnEscape: boolean;
  /**
   * Caps the rendered body height in px. Taller content is clipped with an
   * expand control instead of scrolling inside the card.
   */
  bodyHeightLimit?: number;
}

export const TaskPreviewCard = ({
  task,
  defaultExpanded = true,
  collapseOnEscape,
  bodyHeightLimit,
}: TaskPreviewCardProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showFull, setShowFull] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (bodyHeightLimit === undefined || !content) {
      return;
    }

    const measure = () =>
      setOverflowing(content.scrollHeight > bodyHeightLimit);
    measure();

    const observer = globalThis.ResizeObserver
      ? new ResizeObserver(measure)
      : undefined;
    observer?.observe(content);
    return () => observer?.disconnect();
  }, [bodyHeightLimit, expanded]);

  const clipped = bodyHeightLimit !== undefined && overflowing && !showFull;

  useEffect(() => {
    if (!collapseOnEscape || !expanded) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      // Skip Escape presses another component already handled, such as an
      // open menu or the composer's autocomplete.
      if (event.key === "Escape" && !event.defaultPrevented) {
        setExpanded(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [collapseOnEscape, expanded]);

  const description = task.sections?.find(
    (s) => s.key === "description",
  )?.materializedMarkdown;

  const acceptanceCriteria = task.sections?.find(
    (s) => s.key === "acceptanceCriteria",
  )?.materializedMarkdown;

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="task-preview-card">
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ cursor: "pointer" }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ minWidth: 0, maxWidth: "1200px" }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ flexShrink: 0 }}
          >
            Task
          </Typography>
          <Typography
            component="div"
            variant="body2"
            fontWeight={600}
            sx={{
              minWidth: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {renderInlineMentions(task.name)}
          </Typography>
        </Stack>
        <IconButton size="small" aria-label={expanded ? "collapse" : "expand"}>
          {expanded ? (
            <ExpandLessIcon fontSize="small" />
          ) : (
            <ExpandMoreIcon fontSize="small" />
          )}
        </IconButton>
      </Stack>

      <Collapse in={expanded}>
        <Box
          maxWidth="1200px"
          data-testid="task-preview-card-body"
          sx={
            bodyHeightLimit === undefined
              ? {
                  // Keep the whole card within two-thirds of the viewport: the
                  // header and padding take ~5rem, the body scrolls in the
                  // rest. Once the body reaches its end, the wheel scrolls the
                  // page.
                  maxHeight: "calc(66.667dvh - 5rem)",
                  overflowY: "auto",
                }
              : {
                  position: "relative",
                  maxHeight: clipped ? bodyHeightLimit : undefined,
                  overflow: clipped ? "hidden" : "visible",
                }
          }
        >
          <Stack ref={contentRef} id={contentId} spacing={1.5} sx={{ mt: 1.5 }}>
            {description ? (
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  Description
                </Typography>
                <MarkdownRenderer mentionMode="minimal" sx={taskContentSx}>
                  {description}
                </MarkdownRenderer>
              </Stack>
            ) : null}

            {acceptanceCriteria ? (
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  Acceptance Criteria
                </Typography>
                <MarkdownRenderer mentionMode="minimal" sx={taskContentSx}>
                  {acceptanceCriteria}
                </MarkdownRenderer>
              </Stack>
            ) : null}
          </Stack>
          {clipped ? (
            <Box
              aria-hidden
              data-testid="task-preview-card-fade"
              sx={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: 48,
                pointerEvents: "none",
                background: (theme) =>
                  `linear-gradient(to bottom, transparent, ${theme.palette.background.paper})`,
              }}
            />
          ) : null}
        </Box>
        {bodyHeightLimit !== undefined && overflowing ? (
          <Button
            size="small"
            aria-expanded={showFull}
            aria-controls={contentId}
            onClick={() => setShowFull((prev) => !prev)}
            sx={{ mt: 1 }}
          >
            {showFull ? "Show less" : "Show full task"}
          </Button>
        ) : null}
      </Collapse>
    </Paper>
  );
};
