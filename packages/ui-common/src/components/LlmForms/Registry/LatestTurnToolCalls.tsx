import {
  Box,
  ButtonBase,
  Chip,
  CircularProgress,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import React, { useState } from "react";
import type { CliReadToolCall, CliReadToolCallText } from "../../../api";

/** Most recent tool calls shown before any narration exists. */
export const TOOL_CALLS_BEFORE_NARRATION_LIMIT = 5;
/** Most recent tool calls shown after each narration message. */
export const TOOL_CALLS_PER_NARRATION_LIMIT = 2;

const isSubagentCall = ({ lane }: CliReadToolCall): boolean =>
  lane.subagentTurnId !== null ||
  lane.providerThreadId !== null ||
  lane.parentToolUseId !== null;

const ToolCallStatusIcon: React.FC<{ call: CliReadToolCall }> = ({ call }) => {
  if (call.status === "running") {
    return <CircularProgress size={12} aria-label="Running" />;
  }
  if (call.status === "failed") {
    return (
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          color: "error.main",
        }}
      >
        <ErrorOutlineIcon sx={{ fontSize: 14 }} aria-label="Failed" />
        {call.exitCode !== null ? (
          <Typography variant="caption">exit {call.exitCode}</Typography>
        ) : null}
      </Box>
    );
  }
  return (
    <CheckIcon
      sx={{ fontSize: 14, color: "success.main" }}
      aria-label="Completed"
    />
  );
};

const ToolCallDetailSection: React.FC<{
  label: string;
  value: CliReadToolCallText | null;
}> = ({ label, value }) => {
  if (!value) return null;
  return (
    <Box data-testid={`tool-call-detail-${label.toLowerCase()}`} sx={{ mb: 1 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontWeight: 600 }}
      >
        {label}
        {value.truncated ? (
          <Typography
            component="span"
            variant="caption"
            color="warning.main"
            data-testid="tool-call-truncated"
            sx={{ ml: 1 }}
          >
            truncated
          </Typography>
        ) : null}
      </Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          fontFamily: "monospace",
          fontSize: "0.8rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 240,
          overflow: "auto",
          color: "text.secondary",
        }}
      >
        {value.text}
      </Box>
    </Box>
  );
};

const ToolCallRow: React.FC<{ call: CliReadToolCall; isNewest: boolean }> = ({
  call,
  isNewest,
}) => {
  // null follows the default (newest expanded); a viewer toggle overrides it.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const expanded = toggled ?? isNewest;
  const subagent = isSubagentCall(call);

  return (
    <Box data-testid="tool-call-row" sx={{ pl: subagent ? 3 : 0 }}>
      <ButtonBase
        aria-expanded={expanded}
        onClick={() => setToggled(!expanded)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          width: "100%",
          justifyContent: "flex-start",
          textAlign: "left",
          py: 0.25,
          color: "text.secondary",
          borderRadius: 1,
        }}
      >
        <ToolCallStatusIcon call={call} />
        {subagent ? (
          <Chip
            label="subagent"
            size="small"
            variant="outlined"
            sx={{ height: 18, fontSize: "0.7rem" }}
          />
        ) : null}
        <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>
          {call.toolName ? (
            <Box component="span" sx={{ fontWeight: 600 }}>
              {call.toolName}
              {" · "}
            </Box>
          ) : null}
          {call.summary}
        </Typography>
      </ButtonBase>
      {expanded ? (
        <Box data-testid="tool-call-detail" sx={{ pl: 3, pt: 0.5 }}>
          <ToolCallDetailSection label="Input" value={call.detail.input} />
          <ToolCallDetailSection label="Output" value={call.detail.output} />
          <ToolCallDetailSection label="Result" value={call.detail.result} />
        </Box>
      ) : null}
    </Box>
  );
};

/**
 * A run of tool calls, oldest first, each expandable to its detail. Rows are
 * keyed on entryId so reveal and expansion state survive polling replacing
 * the whole snapshot.
 */
export const LatestTurnToolCalls: React.FC<{
  toolCalls: readonly CliReadToolCall[];
  /** Earlier calls the read omitted or evicted; captioned when non-zero. */
  hiddenCount: number;
  /** Most recent calls shown before the reveal control; all when omitted. */
  visibleLimit?: number;
  /** entryId of the newest call in the whole view; rendered expanded. */
  newestEntryId: string | null;
}> = ({ toolCalls, hiddenCount, visibleLimit, newestEntryId }) => {
  const [showAll, setShowAll] = useState(false);
  if (toolCalls.length === 0 && hiddenCount === 0) return null;

  const collapsedCount =
    showAll || visibleLimit === undefined
      ? 0
      : Math.max(0, toolCalls.length - visibleLimit);
  const visible = toolCalls.slice(collapsedCount);

  return (
    <Box
      data-testid="latest-turn-tool-calls"
      sx={{ pl: { xs: 4, sm: 4.5 }, pb: 1 }}
    >
      {hiddenCount > 0 ? (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="tool-calls-hidden-count"
        >
          {hiddenCount} earlier tool {hiddenCount === 1 ? "call" : "calls"} not
          shown
        </Typography>
      ) : null}
      {collapsedCount > 0 ? (
        <ButtonBase
          data-testid="tool-calls-show-earlier"
          onClick={() => setShowAll(true)}
          sx={{
            display: "flex",
            justifyContent: "flex-start",
            py: 0.25,
            color: "text.secondary",
            borderRadius: 1,
          }}
        >
          <Typography variant="caption">
            Show {collapsedCount} earlier tool{" "}
            {collapsedCount === 1 ? "call" : "calls"}
          </Typography>
        </ButtonBase>
      ) : null}
      {visible.map((call) => (
        <ToolCallRow
          key={call.entryId}
          call={call}
          isNewest={call.entryId === newestEntryId}
        />
      ))}
    </Box>
  );
};
