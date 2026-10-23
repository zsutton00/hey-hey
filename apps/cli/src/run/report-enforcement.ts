/**
 * Pure report-emission contract evaluator.
 *
 * Run uses this to decide whether the handler's declared `reports[]` contract
 * was satisfied across a *handler span* — the contiguous sequence of turns
 * driven by a single prompt-type handler. The evaluator is invoked when the
 * span ends (handler swap or run cleanup), not per-turn, because conversational
 * handlers (e.g. feature_sync_analyze) may legitimately span many turns before
 * the agent writes its terminal reports.
 *
 * Two branches:
 *   (a) handler.reports has at least one `required: true` entry — every
 *       required reportType must appear in the span's reports.
 *   (b) handler.reports is empty AND `madeChanges` is true — at least one
 *       entry of any type must appear in the span's reports.
 *
 * Returns the missing variant descriptors (or `null` when satisfied).
 */

import type { ReportType } from '../shared/api/index';
import type { PromptTypeHandler } from '../agents/prompt-type-handler';
import type { ReportChainEntry } from './types';

type ReportEnforcementMode = 'required-variants' | 'any-on-changes';

export interface ReportEnforcementMiss {
  /** Which branch produced the miss — useful for log lines. */
  mode: ReportEnforcementMode;
  /**
   * Required reportTypes that did not land. Populated for `required-variants`.
   * Empty for `any-on-changes` (any type would have satisfied that branch).
   */
  missingReportTypes: readonly ReportType[];
}

export function evaluateDeclaredReports(
  handler: Pick<PromptTypeHandler<unknown>, 'reports'>,
  spanReports: ReadonlyArray<Readonly<ReportChainEntry>>,
  madeChanges: boolean,
): ReportEnforcementMiss | null {
  const required = handler.reports.filter((spec) => spec.required);

  if (required.length > 0) {
    const emittedTypes = new Set(spanReports.map((entry) => entry.reportType));
    const missing = required
      .map((spec) => spec.reportType)
      .filter((reportType) => !emittedTypes.has(reportType));
    if (missing.length === 0) return null;
    return { mode: 'required-variants', missingReportTypes: missing };
  }

  if (handler.reports.length === 0 && madeChanges && spanReports.length === 0) {
    return { mode: 'any-on-changes', missingReportTypes: [] };
  }

  return null;
}
