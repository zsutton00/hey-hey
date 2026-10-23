import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type {
  ProjectReportEvidenceReference,
  ProjectReportScope,
  ProjectReportSubject,
} from '../../shared/api/generated/api';
import { PROJECT_REPORT_SECTION_MCP_TOOLS } from '../mcp-server-config';
import type { PromptTypeHandler } from '../prompt-type-handler';
import type { ProjectReportSubjectDigest } from './project-report-evidence-reader';
import type { ProjectReportGroupKind } from './project-report-grouping';
import { buildProjectReportSectionPrompt } from './project-report-section-prompt';

export const PROJECT_REPORT_SECTION_HANDLER_ID = 'project_report_section';

export interface ProjectReportSectionPayload {
  request: {
    question: string;
    scope: ProjectReportScope;
    exclusions: ProjectReportSubject[];
  };
  group: { key: string; kind: ProjectReportGroupKind; title: string };
  subjects: ProjectReportSubjectDigest[];
  /** Only the references for this group's subjects. */
  evidenceReferences: ProjectReportEvidenceReference[];
  toolCallBudget: number;
}

/** A group the host summarised through its own section child. */
export interface ProjectReportSection {
  groupKey: string;
  kind: ProjectReportGroupKind;
  title: string;
  subjectCount: number;
  html: string;
  citedEvidenceKeys: string[];
}

/** A group listed in one line instead of a section, with why. */
export interface ProjectReportMention {
  groupKey: string;
  kind: ProjectReportGroupKind;
  title: string;
  subjectCount: number;
  changeCount: number;
  reason: 'OUTSIDE_BUDGET' | 'BUDGET_EXHAUSTED' | 'FAILED' | 'PROVIDER_UNSUPPORTED';
}

/**
 * Reads the single <section> fragment a child returns. Citations are kept only
 * when they name a key the host supplied for this group.
 */
export const parseProjectReportSectionOutput = (
  outputText: string | undefined,
  allowedEvidenceKeys: ReadonlySet<string>,
): { html: string; citedEvidenceKeys: string[] } | null => {
  const text = outputText ?? '';
  const start = text.search(/<section[\s>]/iu);
  const end = text.toLowerCase().lastIndexOf('</section>');
  if (start < 0 || end < start) return null;
  const html = text.slice(start, end + '</section>'.length);
  const cited = new Set<string>();
  for (const [, key] of html.matchAll(/data-evidence-key="([^"]+)"/gu)) {
    if (key !== undefined && allowedEvidenceKeys.has(key)) cited.add(key);
  }
  return { html, citedEvidenceKeys: [...cited] };
};

/**
 * Child-only handler that summarises one work group for a project report.
 * Read-only graph tools, no submission tools, no built-ins, read-only sandbox:
 * it returns a section to the parent report agent, never a report.
 */
export const projectReportSectionHandler: PromptTypeHandler<ProjectReportSectionPayload> = {
  id: PROJECT_REPORT_SECTION_HANDLER_ID,
  promptType: LocalPromptType.ProjectReport,
  service: 'optional',
  launchEntity: 'none',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: false,
  reports: [],
  replaceProviderSystemPrompt: true,
  childConfig: {
    adapterId: 'project-report-section-subagent',
    mcpAllowedTools: PROJECT_REPORT_SECTION_MCP_TOOLS,
    builtinAllowedTools: [],
    submissionTools: 'none',
    codexSandboxMode: 'read-only',
    includePriorReports: false,
  },
  buildPrompt: buildProjectReportSectionPrompt,
};
