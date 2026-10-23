import { useCallback, useMemo, useState } from "react";
import { keyframes, useTheme } from "@mui/material";
import type { SvgIconProps } from "@mui/material";
import type { MessageResponseDto } from "../../api";
import { useConversationMessages } from "../../data/hooks/useConversationMessages";
import { CapsuleAction } from "../ActionsCapsule/CapsuleAction";
import { ContextIcon } from "../ActionsCapsule/ContextIcon";
import { RunContextUsageModal } from "./RunContextUsageModal";
import type { AgentProvider } from "./runtime/types";

export interface ProviderSessionChoice {
  id: string;
  label: string;
}

export const collectProviderSessions = (
  messages: readonly MessageResponseDto[],
): ProviderSessionChoice[] => {
  const seen = new Set<string>();
  const choices: ProviderSessionChoice[] = [];
  const visit = (message: MessageResponseDto): void => {
    if (message.type === "SYSTEM") {
      const id = message.data.providerSessionId;
      if (id && !seen.has(id)) {
        seen.add(id);
        choices.push({
          id,
          label:
            message.data.promptHandler ||
            `Session ${String(choices.length + 1)}`,
        });
      }
    }
    message.responses?.forEach(visit);
  };
  messages.forEach(visit);
  return choices;
};

/**
 * The conversation's most recent provider session, which the capsule's live
 * context size must describe. Shares the messages cache the modal reads.
 */
export const useLatestProviderSessionId = (
  organizationId: string,
  projectId: string,
  conversationId: string | null | undefined,
): string | undefined => {
  const messages = useConversationMessages(
    organizationId,
    projectId,
    conversationId ?? undefined,
  );
  return useMemo(
    () => collectProviderSessions(messages.data ?? []).at(-1)?.id,
    [messages.data],
  );
};

/** Context size at which the capsule shows its warning state. */
export const CONTEXT_WARNING_TOKENS = 150_000;
/** Context size at which the capsule escalates to its alarm state. */
export const CONTEXT_ALARM_TOKENS = 500_000;
/**
 * Share of the model's context window at which the capsule alarms, so models
 * whose window is smaller than CONTEXT_ALARM_TOKENS still alarm before the wall.
 */
const CONTEXT_ALARM_WINDOW_SHARE = 0.8;

export type ContextSizeLevel = "unknown" | "normal" | "warning" | "alarm";

/** Alarm threshold: 500K, or 80% of a smaller known context window. */
export const getContextAlarmTokens = (contextWindowTokens?: number) =>
  contextWindowTokens === undefined
    ? CONTEXT_ALARM_TOKENS
    : Math.min(
        CONTEXT_ALARM_TOKENS,
        Math.floor(contextWindowTokens * CONTEXT_ALARM_WINDOW_SHARE),
      );

export const getContextSizeLevel = (
  contextTokens: number | undefined,
  contextWindowTokens?: number,
): ContextSizeLevel => {
  if (contextTokens === undefined) return "unknown";
  if (contextTokens >= getContextAlarmTokens(contextWindowTokens)) {
    return "alarm";
  }
  if (contextTokens >= CONTEXT_WARNING_TOKENS) return "warning";
  return "normal";
};

/** Whole K tokens, floored so a value below a threshold never reads as it. */
export const formatContextTokens = (contextTokens: number | undefined) =>
  contextTokens === undefined
    ? "\u2014"
    : `${String(Math.floor(contextTokens / 1_000))}K`;

const contextAlarmPulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(1.15); }
`;

/**
 * Gauge fill as a share of the model's context window. Without a known window
 * the dial fills toward the alarm threshold instead.
 */
export const getContextGaugeFill = (
  contextTokens: number | undefined,
  contextWindowTokens?: number,
) =>
  contextTokens === undefined
    ? 0
    : Math.min(
        contextTokens / (contextWindowTokens ?? CONTEXT_ALARM_TOKENS),
        1,
      );

/**
 * Capsule icons receive only presentation props, so the fill is closed over.
 * The alarm variant pulses like a siren; reduced-motion users get no motion.
 */
const createContextGaugeIcon = (fill: number, alarm: boolean) => {
  const ContextGaugeIcon = ({ sx, ...props }: SvgIconProps) => (
    <ContextIcon
      {...props}
      gaugeLevel={fill}
      data-gauge-fill={fill}
      sx={[
        alarm && {
          animation: `${contextAlarmPulse} 1s ease-in-out infinite`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
  ContextGaugeIcon.displayName = alarm ? "ContextAlarmIcon" : "ContextIcon";
  return ContextGaugeIcon;
};

export const RunContextUsageCapsules = ({
  organizationId,
  projectId,
  agentSessionId,
  conversationId,
  runId,
  provider,
  contextTokens,
  contextWindowTokens,
  contextReadState,
  order = 205,
}: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  runId: string;
  provider: AgentProvider;
  /**
   * Live context-window size for the latest provider session, pushed at turn
   * end. Presentational only: the capsule never reads or refreshes it.
   */
  contextTokens?: number;
  /**
   * Context-window capacity of the session's model, reported with the same
   * reading. Scales the gauge and lowers the alarm for small windows.
   */
  contextWindowTokens?: number;
  contextReadState?:
    { status: "ready" | "loading" } | { status: "error"; message: string };
  order?: number;
}) => {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const messages = useConversationMessages(
    organizationId,
    projectId,
    conversationId,
  );
  const sessions = useMemo(
    () => collectProviderSessions(messages.data ?? []),
    [messages.data],
  );
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const level = getContextSizeLevel(contextTokens, contextWindowTokens);
  const levelColor =
    level === "alarm"
      ? theme.palette.error.main
      : level === "warning"
        ? theme.palette.warning.main
        : undefined;
  const gaugeFill = getContextGaugeFill(contextTokens, contextWindowTokens);
  const icon = useMemo(
    () => createContextGaugeIcon(gaugeFill, level === "alarm"),
    [gaugeFill, level],
  );
  const iconStyle = useMemo(
    () => ({
      backgroundColor: "transparent",
      ...(levelColor && { color: levelColor }),
    }),
    [levelColor],
  );

  return (
    <>
      <CapsuleAction
        behavior="click"
        id="run-context"
        label={
          contextReadState?.status === "loading"
            ? "Loading"
            : contextReadState?.status === "error"
              ? "Error"
              : formatContextTokens(contextTokens)
        }
        title={
          contextReadState?.status === "error"
            ? contextReadState.message
            : "Context usage"
        }
        icon={icon}
        onClick={handleOpen}
        iconStyle={iconStyle}
        {...(levelColor && { textColor: levelColor })}
        actionGroup="page"
        tier="page"
        order={order}
      />
      {open ? (
        <RunContextUsageModal
          open
          onClose={handleClose}
          organizationId={organizationId}
          projectId={projectId}
          agentSessionId={agentSessionId}
          runId={runId}
          providerSessions={sessions}
          provider={provider}
        />
      ) : null}
    </>
  );
};
