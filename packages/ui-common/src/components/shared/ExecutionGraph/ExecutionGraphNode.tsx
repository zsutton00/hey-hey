import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Box,
  Card,
  Chip,
  Stack,
  Typography,
  keyframes,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useMemo, type MouseEvent } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { renderMentionsAsText } from "../../../utils/mentionFormatting";
import { EntityIcon } from "../../Entity/EntityIcon";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import type {
  ExecutionGraphNodeState,
  ExecutionGraphViewModelNode,
} from "./executionGraphViewModel";

export interface ExecutionGraphNodeData {
  node: ExecutionGraphViewModelNode;
  hasIncomingEdges: boolean;
  hasOutgoingEdges: boolean;
  siblingIndex: number;
  siblingCount: number;
  animateCurrentTask: boolean;
}

const createCurrentTaskPulse = (color: string) => keyframes`
  0%, 100% { box-shadow: 0 0 0 0 ${alpha(color, 0.35)}; }
  50% { box-shadow: 0 0 0 7px ${alpha(color, 0)}; }
`;

type StateChipColor =
  | "default"
  | "secondary"
  | "error"
  | "success"
  | "warning"
  | "ready"
  | "active";

const statePresentation = (
  state: ExecutionGraphNodeState
): {
  label: string;
  color: StateChipColor;
  emphasized: boolean;
  opacity: number;
  completed: boolean;
} => {
  switch (state) {
    case "idle":
      return {
        label: "NOT STARTED",
        color: "ready",
        emphasized: false,
        opacity: 1,
        completed: false,
      };
    case "eligible":
      return {
        label: "NOT STARTED",
        color: "ready",
        emphasized: true,
        opacity: 1,
        completed: false,
      };
    case "active":
      return {
        label: "IN PROGRESS",
        color: "active",
        emphasized: true,
        opacity: 1,
        completed: false,
      };
    case "blocked":
      return {
        label: "BLOCKED",
        color: "error",
        emphasized: false,
        opacity: 1,
        completed: false,
      };
    case "waiting_for_user":
      return {
        label: "WAITING FOR USER",
        color: "warning",
        emphasized: false,
        opacity: 1,
        completed: false,
      };
    case "completed":
      return {
        label: "COMPLETE",
        color: "success",
        emphasized: false,
        opacity: 0.6,
        completed: true,
      };
    case "stopped":
      return {
        label: "STOPPED",
        color: "secondary",
        emphasized: false,
        opacity: 0.75,
        completed: false,
      };
    case "errored":
      return {
        label: "ERRORED",
        color: "error",
        emphasized: false,
        opacity: 1,
        completed: false,
      };
  }
};

// Minimal mentions navigate as links; keep that click from also reaching
// ReactFlow's onNodeClick, which owns card selection/navigation.
const stopMentionClickPropagation = (event: MouseEvent<HTMLElement>) => {
  const target = event.target as Element | null;
  if (target?.closest?.("[data-mention-token]")) {
    event.stopPropagation();
  }
};

const ExecutionGraphCard = ({
  data,
  selected,
}: {
  data: ExecutionGraphNodeData;
  selected: boolean;
}) => {
  const theme = useTheme();
  const { node } = data;
  const presentation = statePresentation(node.state);
  const emphasized = presentation.emphasized;
  const currentTask = node.state === "active";
  const blocked = node.state === "blocked";
  const selectedBackground =
    theme.palette.mode === "dark"
      ? theme.palette.common.white
      : theme.palette.grey[200];
  const selectedTextColor =
    theme.palette.mode === "dark"
      ? theme.palette.grey[900]
      : theme.palette.text.primary;
  const defaultBackground =
    theme.palette.mode === "dark" ? "grey.900" : "background.paper";
  const blockedBackground =
    theme.palette.mode === "dark" ? "grey.800" : "grey.50";
  const currentTaskPulse = useMemo(
    () => createCurrentTaskPulse(theme.palette.warning.main),
    [theme.palette.warning.main]
  );
  const emphasizedStatusBackground =
    node.state === "active"
      ? theme.palette.active?.main ?? theme.palette.primary.main
      : theme.palette.mode === "dark"
      ? theme.palette.grey[200]
      : theme.palette.common.white;
  const emphasizedStatusColor =
    node.state === "active"
      ? theme.palette.active?.contrastText ?? theme.palette.primary.contrastText
      : theme.palette.mode === "dark"
      ? theme.palette.grey[900]
      : theme.palette.text.primary;

  return (
    <Card
      data-testid="execution-graph-node"
      data-node-state={node.state}
      data-selected={selected ? "true" : "false"}
      data-current-task={currentTask ? "true" : "false"}
      data-primary-emphasis={emphasized ? "true" : "false"}
      sx={{
        width: 400,
        cursor: "pointer",
        transition: "all 0.2s",
        opacity: presentation.opacity,
        border: emphasized ? 2 : 1,
        borderStyle: "solid",
        borderColor: currentTask
          ? "warning.main"
          : emphasized
          ? "primary.main"
          : "divider",
        backgroundColor: selected
          ? selectedBackground
          : emphasized
          ? "primary.main"
          : blocked
          ? blockedBackground
          : defaultBackground,
        color: selected
          ? selectedTextColor
          : emphasized
          ? "primary.contrastText"
          : "text.primary",
        outline: currentTask
          ? `2px solid ${theme.palette.warning.main}`
          : "none",
        outlineOffset: currentTask ? 2 : 0,
        animation: currentTask && data.animateCurrentTask
          ? `${currentTaskPulse} 1.8s ease-in-out infinite`
          : "none",
        "&:hover": { boxShadow: 4 },
        position: "relative",
        zIndex: 10,
      }}
    >
      {presentation.completed ? (
        <CheckCircleIcon
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            color: "success.main",
            fontSize: 20,
          }}
        />
      ) : null}

      {data.siblingCount > 1 ? (
        <Box
          sx={{
            position: "absolute",
            left: -20,
            top: "50%",
            transform: "translateY(-50%)",
            backgroundColor: "primary.main",
            color: "primary.contrastText",
            borderRadius: "50%",
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.7rem",
            fontWeight: 600,
          }}
        >
          {data.siblingIndex + 1}
        </Box>
      ) : null}

      <Box sx={{ p: 2.5 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            {node.entityType ? (
              <EntityIcon entityType={node.entityType} size={24} />
            ) : null}
            <Typography
              variant="body1"
              fontWeight={600}
              sx={{ flex: 1, whiteSpace: "normal", overflowWrap: "anywhere" }}
              title={renderMentionsAsText(node.title)}
              onClick={stopMentionClickPropagation}
            >
              {renderInlineMentions(node.title, "minimal")}
            </Typography>
          </Stack>

          {node.summary ? (
            <Typography
              variant="body2"
              onClick={stopMentionClickPropagation}
              sx={{
                color: selected
                  ? selectedTextColor
                  : emphasized
                  ? "attention.contrastText"
                  : "text.secondary",
                fontStyle: "italic",
                display: "-webkit-box",
                WebkitLineClamp: 5,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {renderInlineMentions(node.summary, "minimal")}
            </Typography>
          ) : null}

          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={presentation.color}
              label={presentation.label}
              sx={{
                fontSize: "0.8rem",
                height: 24,
                ...(emphasized && {
                  backgroundColor: emphasizedStatusBackground,
                  color: emphasizedStatusColor,
                  borderColor: "transparent",
                }),
              }}
            />
            {node.metadata.map((badge) => (
              <Chip
                key={badge.id}
                size="small"
                variant="outlined"
                label={badge.label}
                sx={{
                  fontSize: "0.8rem",
                  height: 24,
                  ...(emphasized && !selected && {
                    backgroundColor: "transparent",
                    color: "common.white",
                    borderColor: "common.white",
                  }),
                  ...(selected && {
                    backgroundColor: "transparent",
                    color: selectedTextColor,
                    borderColor: selectedTextColor,
                  }),
                }}
              />
            ))}
          </Stack>

          {node.notices?.map((notice) => (
            <Stack
              key={notice.id}
              direction="row"
              spacing={0.75}
              alignItems="center"
            >
              <WarningAmberIcon color={notice.tone} fontSize="small" />
              <Typography
                variant="caption"
                sx={{
                  color: selected
                    ? selectedTextColor
                    : emphasized
                    ? "primary.contrastText"
                    : "text.primary",
                }}
              >
                {notice.text}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Card>
  );
};

export const ExecutionGraphNode = ({
  data,
  selected,
}: NodeProps<ExecutionGraphNodeData>) => (
  <>
    {data.hasIncomingEdges ? (
      <Handle type="target" position={Position.Left} style={{ border: 0 }} />
    ) : null}
    <ExecutionGraphCard data={data} selected={selected} />
    {data.hasOutgoingEdges ? (
      <Handle type="source" position={Position.Right} style={{ border: 0 }} />
    ) : null}
  </>
);
