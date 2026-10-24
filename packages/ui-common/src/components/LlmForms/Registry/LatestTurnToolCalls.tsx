import {
  Box,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CliReadToolCall, CliReadToolCallText } from "../../../api";

/** Most recent tool calls shown before any narration exists. */
export const TOOL_CALLS_BEFORE_NARRATION_LIMIT = 5;
/** Most recent tool calls shown after each narration message. */
export const TOOL_CALLS_PER_NARRATION_LIMIT = 2;
/** Expanded tool details show this many lines before they are revealed. */
export const TOOL_CALL_DETAIL_CLAMP_LINES = 6;

const TOOL_CALL_DETAIL_FONT_SIZE = "0.8rem";
const TOOL_CALL_DETAIL_LINE_HEIGHT = 1.25;
const TOOL_CALL_DETAIL_CLAMP_SIZE_EM =
  TOOL_CALL_DETAIL_CLAMP_LINES * TOOL_CALL_DETAIL_LINE_HEIGHT;
const TOOL_CALL_DETAIL_REVEAL_ROW_HEIGHT = 24;

interface ToolCallDisplayPreference {
  /** null keeps the derived newest-call default. */
  expanded: boolean | null;
  showAll: boolean;
}

interface ToolCallDisplayStateContextValue {
  preferences: Map<string, ToolCallDisplayPreference>;
  updatePreference: (
    entryId: string,
    update: Partial<ToolCallDisplayPreference>,
  ) => void;
}

const EMPTY_TOOL_CALL_PREFERENCES = new Map<
  string,
  ToolCallDisplayPreference
>();

const ToolCallDisplayStateContext =
  createContext<ToolCallDisplayStateContextValue | null>(null);

/**
 * Shares per-call presentation choices between the pre-narration and
 * interleaved render locations in one Conversation Viewer.
 */
export const ToolCallDisplayStateProvider: React.FC<
  React.PropsWithChildren<{ scopeKey: string }>
> = ({ children, scopeKey }) => {
  const [state, setState] = useState(() => ({
    scopeKey,
    preferences: new Map<string, ToolCallDisplayPreference>(),
  }));
  const preferences =
    state.scopeKey === scopeKey
      ? state.preferences
      : EMPTY_TOOL_CALL_PREFERENCES;
  const updatePreference = useCallback(
    (entryId: string, update: Partial<ToolCallDisplayPreference>) => {
      setState((current) => {
        const next = new Map(
          current.scopeKey === scopeKey
            ? current.preferences
            : EMPTY_TOOL_CALL_PREFERENCES,
        );
        next.set(entryId, {
          expanded: null,
          showAll: false,
          ...(current.scopeKey === scopeKey
            ? current.preferences.get(entryId)
            : undefined),
          ...update,
        });
        return { scopeKey, preferences: next };
      });
    },
    [scopeKey],
  );
  const value = useMemo(
    () => ({ preferences, updatePreference }),
    [preferences, updatePreference],
  );

  return (
    <ToolCallDisplayStateContext.Provider value={value}>
      {children}
    </ToolCallDisplayStateContext.Provider>
  );
};

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
    <Box
      component="span"
      data-testid={`tool-call-detail-${label.toLowerCase()}`}
      sx={{ color: "text.secondary" }}
    >
      <Box component="span" sx={{ fontWeight: 600 }}>
        {label}
      </Box>
      {value.truncated ? (
        <Box
          component="span"
          color="warning.main"
          data-testid="tool-call-truncated"
          sx={{ ml: 0.5 }}
        >
          (truncated)
        </Box>
      ) : null}
      : {value.text}
    </Box>
  );
};

const ToolCallRow: React.FC<{ call: CliReadToolCall; isNewest: boolean }> = ({
  call,
  isNewest,
}) => {
  const displayState = useContext(ToolCallDisplayStateContext);
  const [localPreference, setLocalPreference] =
    useState<ToolCallDisplayPreference>({ expanded: null, showAll: false });
  const preference =
    displayState?.preferences.get(call.entryId) ?? localPreference;
  const expanded = preference.expanded ?? isNewest;
  const showAll = preference.showAll;
  const detailClampRef = useRef<HTMLDivElement>(null);
  const detailContentRef = useRef<HTMLPreElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const subagent = isSubagentCall(call);

  const updatePreference = (
    update: Partial<ToolCallDisplayPreference>,
  ): void => {
    if (displayState) {
      displayState.updatePreference(call.entryId, update);
      return;
    }
    setLocalPreference((current) => ({ ...current, ...update }));
  };

  useLayoutEffect(() => {
    if (!expanded) return;

    const measureOverflow = () => {
      const clamp = detailClampRef.current;
      const content = detailContentRef.current;
      if (!clamp || !content) return;
      const fontSize = Number.parseFloat(getComputedStyle(clamp).fontSize);
      const clampHeight = fontSize * TOOL_CALL_DETAIL_CLAMP_SIZE_EM;
      const sections = [
        call.detail.input,
        call.detail.output,
        call.detail.result,
      ].filter((section): section is CliReadToolCallText => section !== null);
      const explicitLineCount = sections.reduce(
        (count, section) => count + section.text.split("\n").length,
        Math.max(0, sections.length - 1),
      );
      const hasNoLayout = content.getBoundingClientRect().width === 0;
      setHasOverflow(
        content.scrollHeight > clampHeight + 1 ||
          (hasNoLayout && explicitLineCount > TOOL_CALL_DETAIL_CLAMP_LINES),
      );
    };

    measureOverflow();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureOverflow);
    if (detailClampRef.current) observer.observe(detailClampRef.current);
    if (detailContentRef.current) observer.observe(detailContentRef.current);
    return () => observer.disconnect();
  }, [
    call.detail.input?.text,
    call.detail.input?.truncated,
    call.detail.output?.text,
    call.detail.output?.truncated,
    call.detail.result?.text,
    call.detail.result?.truncated,
    expanded,
  ]);

  return (
    <Box data-testid="tool-call-row" sx={{ pl: subagent ? 3 : 0 }}>
      <ButtonBase
        aria-expanded={expanded}
        onClick={() => updatePreference({ expanded: !expanded })}
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
      {/* Only deliberate viewer changes animate. Animating the automatic
          handoff temporarily shrinks the list and can clamp the scroll owner. */}
      <Collapse
        in={expanded}
        timeout={preference.expanded === null ? 0 : "auto"}
        unmountOnExit
      >
        <Box sx={{ pl: 3, pt: 0.5 }}>
          <Collapse
            in={showAll}
            collapsedSize={`${TOOL_CALL_DETAIL_CLAMP_SIZE_EM}em`}
            timeout="auto"
            ref={detailClampRef}
            sx={{ fontSize: TOOL_CALL_DETAIL_FONT_SIZE }}
          >
            <Box
              component="pre"
              data-testid="tool-call-detail"
              ref={detailContentRef}
              sx={{
                m: 0,
                fontFamily: "monospace",
                fontSize: TOOL_CALL_DETAIL_FONT_SIZE,
                lineHeight: TOOL_CALL_DETAIL_LINE_HEIGHT,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "text.secondary",
              }}
            >
              <ToolCallDetailSection label="Input" value={call.detail.input} />
              {call.detail.input && (call.detail.output || call.detail.result)
                ? "\n"
                : null}
              <ToolCallDetailSection
                label="Output"
                value={call.detail.output}
              />
              {call.detail.output && call.detail.result ? "\n" : null}
              <ToolCallDetailSection
                label="Result"
                value={call.detail.result}
              />
            </Box>
          </Collapse>
          {hasOverflow || showAll ? (
            <ButtonBase
              data-testid="tool-call-show-all"
              aria-expanded={showAll}
              onClick={() =>
                updatePreference({
                  showAll: !showAll,
                  ...(showAll ? {} : { expanded: true }),
                })
              }
              sx={{
                display: "flex",
                justifyContent: "flex-start",
                minHeight: TOOL_CALL_DETAIL_REVEAL_ROW_HEIGHT,
                color: "text.secondary",
                borderRadius: 1,
              }}
            >
              <Typography variant="caption">
                {showAll ? "Show less" : "Show all"}
              </Typography>
            </ButtonBase>
          ) : expanded ? (
            <Box
              aria-hidden="true"
              sx={{ height: TOOL_CALL_DETAIL_REVEAL_ROW_HEIGHT }}
            />
          ) : null}
        </Box>
      </Collapse>
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
  const [showEarlierCalls, setShowEarlierCalls] = useState(false);
  if (toolCalls.length === 0 && hiddenCount === 0) return null;

  const collapsedCount =
    showEarlierCalls || visibleLimit === undefined
      ? 0
      : Math.max(0, toolCalls.length - visibleLimit);
  const visible = toolCalls.slice(collapsedCount);

  return (
    <Box
      data-testid="latest-turn-tool-calls"
      // Calls are a sliding, transient window. Anchoring to a surviving row
      // follows its relocation when an earlier row is evicted. Let native
      // anchoring retain surrounding conversation content instead.
      sx={{ pl: { xs: 4, sm: 4.5 }, pb: 1, overflowAnchor: "none" }}
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
          onClick={() => setShowEarlierCalls(true)}
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
