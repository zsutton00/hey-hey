import { useState } from "react";
import {
  Box,
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
}

export const TaskPreviewCard = ({
  task,
  defaultExpanded = true,
}: TaskPreviewCardProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

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
        <Box maxWidth="1200px">
          <Stack spacing={1.5} sx={{ mt: 1.5 }}>
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
        </Box>
      </Collapse>
    </Paper>
  );
};
