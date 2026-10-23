/**
 * Shared rendering of the Run's append-only report chain. Used by both the
 * provider-session prompt resolver and the subagent spawner boundary so the
 * same rendered shape reaches every prompt downstream.
 *
 * Entries combine task-scoped seeds (reports persisted on this task by prior
 * Runs) and live in-Run appends, so the block reads as "every report on this
 * task so far," not just the current Run's. The body shown for each entry is
 * the report's `summary` field — a short phase handoff written by the agent
 * that produced the report. The full structured payload is reachable via the
 * `get_report_body` MCP tool keyed on the printed `reportId`.
 */

import type { ReportChainEntry } from '../../run/types';

export const CODING_AGENT_REPORT_TYPES: ReadonlySet<string> = new Set([
  'PLAN',
  'IMPLEMENT',
  'FEATURE_SYNC',
  'FEATURE_SYNC_HANDOFF',
  'CODING_RESEARCH',
]);

const HEADER = `## Prior reports on this task

The entries below are reports that prior turns or runs persisted on this task. Each shows the report's \`summary\` field — a 50–100 word handoff to the next phase. To read the full structured payload (file lists, decisions, discrepancies, plan steps, etc.) call the \`get_report_body\` MCP tool with the listed \`reportId\`.`;

const NO_SUMMARY_PLACEHOLDER =
  '_(no summary recorded — older report types do not carry one yet; use `get_report_body` with the reportId above to read the payload)_';

export const renderReportChainBlock = (
  entries: ReadonlyArray<Readonly<ReportChainEntry>>,
): string => {
  const sections = entries.map((entry) => {
    const summaryBody = entry.summary.trim().length > 0 ? entry.summary : NO_SUMMARY_PLACEHOLDER;
    return [
      `### ${entry.reportType} report — ${entry.createdAt}`,
      `- reportId: \`${entry.reportId}\``,
      `- phase: ${entry.phase}`,
      `- audience: ${entry.audience}`,
      '',
      summaryBody,
    ].join('\n');
  });
  return `${HEADER}\n\n${sections.join('\n\n')}`;
};

/**
 * Prepend the rendered report-chain block to a prompt body. No-op when the
 * chain is empty so callers can call this unconditionally without having to
 * branch themselves.
 */
export const prependPriorReports = (
  body: string,
  entries: ReadonlyArray<Readonly<ReportChainEntry>>,
): string => {
  if (entries.length === 0) return body;
  return `${renderReportChainBlock(entries)}\n\n---\n\n${body}`;
};
