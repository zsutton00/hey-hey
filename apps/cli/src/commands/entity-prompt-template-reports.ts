import type {
  CodingResearchReportPayload,
  ReportPayload,
  ReportType,
} from '@hey-hey/contracts/api/models';
import type { EntityPromptTemplateNode } from '../shared/api/generated/entity-prompt-template-language';
import { renderCodingResearchMemo } from '../agents/prompts/coding-research-memo';

/** What a template can read about the newest saved report of one type. */
export interface EntityPromptTemplateReportValue {
  /** Readable body with the report date, rendered for `reports.<TYPE>.latest`. */
  readonly latest: string;
  /** Short handoff summary, rendered for `reports.<TYPE>.latest.summary`. */
  readonly summary: string;
}

/** Newest saved report of each referenced type, keyed by report type. Absent types have no entry. */
export type EntityPromptTemplateReports = Readonly<Record<string, EntityPromptTemplateReportValue>>;

/** A report chosen to stand for its type, before its body is read. */
export interface SelectableReport {
  readonly reportId: string;
  readonly reportType: string;
  readonly createdAt: string;
}

/**
 * Evaluation artifacts are retained but are not ordinary project knowledge, so a
 * template can never pull them in as saved context.
 */
export const TEMPLATE_EXCLUDED_REPORT_TYPES: ReadonlySet<string> = new Set([
  'EVAL_RUN',
  'EVAL_ATTEMPT',
  'EVAL_HUMAN_REVIEW',
]);

const REPORT_PATH_PATTERN = /^reports\.([A-Z][A-Z0-9_]*)\.latest(\.summary)?$/u;

export interface ReportPath {
  readonly reportType: string;
  readonly field: keyof EntityPromptTemplateReportValue;
}

/** Parse a `reports.<TYPE>.latest[.summary]` path; null for any other path. */
export const parseReportPath = (path: string): ReportPath | null => {
  const match = REPORT_PATH_PATTERN.exec(path);
  const reportType = match?.[1];
  if (!reportType) {
    return null;
  }

  return { reportType, field: match[2] ? 'summary' : 'latest' };
};

/** Report types referenced anywhere in a parsed template, including conditions and nested branches. */
export const collectReferencedReportTypes = (
  nodes: readonly EntityPromptTemplateNode[],
): ReadonlySet<string> => {
  const types = new Set<string>();
  const visit = (branch: readonly EntityPromptTemplateNode[]): void => {
    for (const node of branch) {
      if (node.type === 'text') {
        continue;
      }

      const reference = parseReportPath(node.path);
      if (reference) {
        types.add(reference.reportType);
      }

      if (node.type === 'if') {
        visit(node.then);
        if (node.else) {
          visit(node.else);
        }
      }
    }
  };
  visit(nodes);

  return types;
};

const timestampOf = (report: SelectableReport): number => {
  const timestamp = Date.parse(report.createdAt);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
};

/**
 * Newest report by creation time, never by position. Duplicates collapse by
 * report identity; equal timestamps resolve to the greater identity so the
 * choice is the same on every read.
 */
export const selectNewestReport = <T extends SelectableReport>(
  candidates: readonly T[],
): T | null => {
  const byId = new Map<string, T>();
  for (const candidate of candidates) {
    byId.set(candidate.reportId, candidate);
  }

  let newest: T | null = null;
  for (const candidate of byId.values()) {
    if (newest === null) {
      newest = candidate;
      continue;
    }

    const difference = timestampOf(candidate) - timestampOf(newest);
    if (difference > 0 || (difference === 0 && candidate.reportId > newest.reportId)) {
      newest = candidate;
    }
  }

  return newest;
};

type ReportBodyFormatter<T extends ReportType> = (
  payload: Extract<ReportPayload, { reportType: T }>,
) => string;

/** Dedicated readable bodies. A type without an entry renders its summary. */
const reportBodyFormatters: {
  [T in ReportType]?: ReportBodyFormatter<T>;
} = {
  CODING_RESEARCH: (payload: CodingResearchReportPayload) => renderCodingResearchMemo(payload),
};

const formatReportBody = (payload: ReportPayload): string | null => {
  if (payload.reportType === 'CODING_RESEARCH') {
    return reportBodyFormatters.CODING_RESEARCH?.(payload) ?? null;
  }

  return null;
};

/** Build the template values for one report from its saved payload. */
export const buildReportValue = (
  report: SelectableReport,
  payload: ReportPayload,
): EntityPromptTemplateReportValue => {
  const summary = payload.summary ?? '';
  const body = formatReportBody(payload) ?? summary;

  return {
    latest: `### ${report.reportType} report — ${report.createdAt}\n\n${body}`,
    summary,
  };
};
