import {
  Box,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  useEvalAttemptOutput,
  type EvalAttemptReport,
  type EvalRunReport,
} from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";

import {
  attemptCellView,
  formatElapsed,
  setupLabel,
  type AttemptCellView,
} from "./evalRunView";

const cellBackground: Record<
  AttemptCellView["kind"] | "missing",
  (theme: Theme) => string
> = {
  queued: () => "transparent",
  missing: () => "transparent",
  running: (theme) => theme.palette.action.hover,
  finished: (theme) => `${theme.palette.success.main}14`,
  stopped: (theme) => `${theme.palette.warning.main}1f`,
  error: (theme) => `${theme.palette.error.main}14`,
};

const OutputCounts: React.FC<{
  organizationId: string;
  attempt: EvalAttemptReport;
  partial: boolean;
}> = ({ organizationId, attempt, partial }) => {
  const { t } = useTranslation();
  const output = useEvalAttemptOutput(organizationId, attempt);
  let text: string | null;
  if (!output.hasRecordedConversation || output.error) {
    text = t("eval.run.cell.outputsUnavailable");
  } else if (!output.data) {
    text = null;
  } else {
    const parts = [
      output.data.proposals.length > 0
        ? t("eval.run.cell.proposals", { count: output.data.proposals.length })
        : null,
      output.data.reports.length > 0
        ? t("eval.run.cell.reports", { count: output.data.reports.length })
        : null,
    ].filter((part): part is string => part !== null);
    text = parts.length > 0 ? parts.join(" · ") : t("eval.run.cell.noOutput");
  }
  if (text === null) return null;
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      component="div"
      data-testid={`eval-attempt-outputs-${attempt.id}`}
    >
      {partial ? t("eval.run.cell.partialOutput", { outputs: text }) : text}
    </Typography>
  );
};

const elapsedText = (elapsedMs: number | null, unavailable: string): string =>
  elapsedMs === null ? unavailable : formatElapsed(elapsedMs);

interface AttemptCellProps {
  organizationId: string;
  projectId: string;
  attempt: EvalAttemptReport;
  view: AttemptCellView;
}

const AttemptCellContent: React.FC<AttemptCellProps> = ({
  organizationId,
  projectId,
  attempt,
  view,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const unavailable = t("eval.run.cell.elapsedUnavailable");
  switch (view.kind) {
    case "queued":
      return <>{t("eval.run.cell.queued")}</>;
    case "running": {
      const running = t("eval.run.cell.running", {
        elapsed: elapsedText(view.elapsedMs, unavailable),
      });
      return (
        <>
          {view.phase
            ? `${running} · ${t(`eval.run.cell.phase.${view.phase}`)}`
            : running}
        </>
      );
    }
    case "finished":
      return (
        <>
          {t("eval.run.cell.finished", {
            elapsed: elapsedText(view.elapsedMs, unavailable),
          })}
          <OutputCounts
            organizationId={organizationId}
            attempt={attempt}
            partial={false}
          />
        </>
      );
    case "stopped":
      return (
        <>
          {t(`eval.run.cell.stopped.${view.stop.reason}`, {
            limit: view.stop.limit ?? t("eval.run.cell.recordedLimit"),
          })}
          <OutputCounts
            organizationId={organizationId}
            attempt={attempt}
            partial
          />
        </>
      );
    case "error": {
      const href = view.sessionId
        ? WebPathService.agentSession({
            projectId,
            agentSessionId: view.sessionId,
          })
        : null;
      return (
        <>
          {view.message
            ? t("eval.run.cell.error", { message: view.message })
            : t("eval.run.cell.errorNoMessage")}
          {href && (
            <Box>
              <Link
                href={href}
                variant="caption"
                data-testid={`eval-attempt-open-session-${attempt.id}`}
                onClick={(event: React.MouseEvent) => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey) return;
                  event.preventDefault();
                  navigate(href);
                }}
              >
                {t("eval.run.cell.openSession")}
              </Link>
            </Box>
          )}
        </>
      );
    }
  }
};

export interface AttemptGridProps {
  organizationId: string;
  projectId: string;
  run: EvalRunReport;
  attempts: readonly EvalAttemptReport[];
  now: number;
}

/** Every recorded case under every recorded setup, one cell per attempt. */
export const AttemptGrid: React.FC<AttemptGridProps> = ({
  organizationId,
  projectId,
  run,
  attempts,
  now,
}) => {
  const { t } = useTranslation();
  const { cases, configurations, settings, coordinatorAgentSessionId } =
    run.payload;
  const byCell = new Map(
    attempts.map((attempt) => [
      `${attempt.payload.caseInputId}|${attempt.payload.configuration.id}`,
      attempt,
    ]),
  );
  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small" data-testid="eval-attempt-grid">
        <TableHead>
          <TableRow>
            <TableCell>{t("eval.run.page.case")}</TableCell>
            {configurations.map((configuration) => (
              <TableCell key={configuration.id}>
                {setupLabel(configuration.target)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {cases.map((caseInput) => (
            <TableRow key={caseInput.id}>
              <TableCell component="th" scope="row">
                {caseInput.title}
              </TableCell>
              {configurations.map((configuration) => {
                const attempt = byCell.get(
                  `${caseInput.id}|${configuration.id}`,
                );
                const view = attempt
                  ? attemptCellView(
                      attempt,
                      settings,
                      now,
                      coordinatorAgentSessionId,
                    )
                  : null;
                return (
                  <TableCell
                    key={configuration.id}
                    data-testid={`eval-attempt-cell-${caseInput.id}-${configuration.id}`}
                    data-state={view?.kind ?? "missing"}
                    sx={{
                      verticalAlign: "top",
                      bgcolor: cellBackground[view?.kind ?? "missing"],
                    }}
                  >
                    {attempt && view ? (
                      <AttemptCellContent
                        organizationId={organizationId}
                        projectId={projectId}
                        attempt={attempt}
                        view={view}
                      />
                    ) : (
                      t("eval.run.cell.missing")
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};
