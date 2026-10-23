import {
  Alert,
  Box,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type React from "react";
import type {
  CliReadProviderUsage,
  CliReadProviderUsageLimitWindow,
  CliReadProviderUsageProviderEnum,
} from "../../../api";
import { formatActivityTimestamp } from "../activityFormatting";
import {
  ClaudeCodeIcon,
  CodexIcon,
  OpencodeIcon,
  type ProviderIconProps,
} from "../providerIcons";
import {
  elapsedPercent,
  presentLimitWindow,
} from "./resolveProviderUsageViewState";

const CLOCK_REFRESH_INTERVAL_MS = 1_000;

const PROVIDERS: Record<
  CliReadProviderUsageProviderEnum,
  { label: string; Icon: React.FC<ProviderIconProps> }
> = {
  claude: { label: "Claude Code", Icon: ClaudeCodeIcon },
  codex: { label: "Codex", Icon: CodexIcon },
  opencode: { label: "OpenCode", Icon: OpencodeIcon },
};

const LimitWindowRow = ({
  label,
  testId,
  window,
  windowHours,
  now,
}: {
  label: string;
  testId: string;
  window: CliReadProviderUsageLimitWindow | null;
  windowHours: number;
  now: number;
}) => {
  const presentation = presentLimitWindow(window, formatActivityTimestamp);
  const usedPercent = window?.usedPercent ?? null;
  const pacePercent =
    usedPercent !== null
      ? elapsedPercent(window?.resetsAt, windowHours, now)
      : null;
  return (
    <Stack data-testid={testId} spacing={0.5}>
      <Stack direction="row" justifyContent="space-between" spacing={1}>
        <Typography variant="body2">{label}</Typography>
        <Typography color="text.secondary" variant="body2">
          {presentation.used}
        </Typography>
      </Stack>
      {usedPercent !== null ? (
        <Box sx={{ position: "relative" }}>
          <LinearProgress
            value={Math.min(100, Math.max(0, usedPercent))}
            variant="determinate"
          />
          {pacePercent !== null ? (
            <Box
              aria-hidden="true"
              data-testid={`${testId}-pace-marker`}
              sx={{
                backgroundColor: "text.primary",
                height: 12,
                left: `${pacePercent}%`,
                pointerEvents: "none",
                position: "absolute",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 2,
                zIndex: 1,
              }}
            />
          ) : null}
        </Box>
      ) : null}
      <Typography color="text.secondary" variant="caption">
        Resets {presentation.resets}
      </Typography>
    </Stack>
  );
};

export interface ProviderUsageCardProps {
  usage: CliReadProviderUsage;
}

export const ProviderUsageCard = ({ usage }: ProviderUsageCardProps) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = setInterval(
      () => setNow(Date.now()),
      CLOCK_REFRESH_INTERVAL_MS
    );
    return () => clearInterval(intervalId);
  }, []);

  const { label, Icon } = PROVIDERS[usage.provider];
  return (
    <Paper
      data-testid={`provider-usage-card-${usage.provider}`}
      sx={{ height: "100%", p: 2 }}
    >
      <Stack spacing={1.5}>
        <Stack alignItems="center" direction="row" spacing={1}>
          <Icon size={20} />
          <Typography component="h3" variant="subtitle1">
            {label}
          </Typography>
        </Stack>
        {usage.status === "error" ? (
          <Alert
            data-testid={`provider-usage-card-${usage.provider}-error`}
            severity="warning"
          >
            Couldn't read usage for {label}.
          </Alert>
        ) : (
          <>
            {usage.fiveHour ? (
              <LimitWindowRow
                label="5-hour limit"
                testId={`provider-usage-card-${usage.provider}-five-hour`}
                window={usage.fiveHour}
                windowHours={5}
                now={now}
              />
            ) : null}
            <LimitWindowRow
              label="Weekly limit"
              testId={`provider-usage-card-${usage.provider}-weekly`}
              window={usage.weekly}
              windowHours={168}
              now={now}
            />
            {usage.observedAt ? (
              <Typography color="text.secondary" variant="caption">
                Read {formatActivityTimestamp(usage.observedAt)}
              </Typography>
            ) : null}
          </>
        )}
      </Stack>
    </Paper>
  );
};
