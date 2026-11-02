import type { TFunction } from "i18next";

import { EvalTargetHandlerKey, type EvalConfiguration } from "../../api";
import type { EvalRunReport } from "./evalRuns";

/**
 * A run's name when it has none of its own, built from what the run recorded:
 * its setups, then the handler it executed, then whether Project Assistant
 * prepared it. Runs recorded before handlers were chosen have no handler
 * settings, so those parts are left out. Never stored.
 */
export function generateEvalRunName(
  configurations: readonly EvalConfiguration[],
  t: TFunction,
): string {
  const setups = configurations.map(({ target }) =>
    [target.model, target.reasoningEffort].filter(Boolean).join(" · "),
  );
  const handlerConfig = configurations[0]?.target.handlerConfig;
  if (!handlerConfig) return setups.join(", ");

  const handler = handlerConfig.handler;
  const preparationOff = handlerConfig.projectAssistant?.enabled === false;
  const parts: string[] = [];
  if (handler) {
    parts.push(t(`eval.run.handler.${handler}`));
  }
  if (handler !== EvalTargetHandlerKey.ProjectAssistant) {
    if (!preparationOff && handler) {
      parts.push(t("eval.run.name.projectAssistantPrepares"));
    }
    if (preparationOff && !handler) {
      parts.push(t("eval.run.name.projectAssistantOff"));
    }
  }
  return [setups.join(", "), parts.join(", ")].filter(Boolean).join(" · ");
}

/** The name every place that shows a run uses: its own, else the generated one. */
export const evalRunName = (run: EvalRunReport, t: TFunction): string =>
  run.payload.name ?? generateEvalRunName(run.payload.configurations, t);
