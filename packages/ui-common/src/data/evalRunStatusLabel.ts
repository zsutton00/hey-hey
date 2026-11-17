import type { TFunction } from "i18next";
import { EvalRunStatus, type EvalSessionStatus } from "../api";

export function evalRunStatusLabel(
  t: TFunction,
  run: Pick<EvalSessionStatus, "status" | "total" | "ended" | "errors">,
): string {
  switch (run.status) {
    case EvalRunStatus.Queued:
      return t("eval.page.runs.status.QUEUED");
    case EvalRunStatus.Running:
      return t("eval.run.page.statusRunning", {
        ended: run.ended,
        total: run.total,
      });
    case EvalRunStatus.Stopped:
      return t("eval.run.page.statusStopped");
    case EvalRunStatus.Finished:
      return run.errors > 0
        ? t("eval.run.page.statusFinishedWithErrors", { count: run.errors })
        : t("eval.run.page.statusFinished");
  }
}
