import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { ProjectReportScope, ProjectReportSubject } from '../../shared/api/generated/api';
import { PROJECT_REPORT_SECTION_MCP_TOOLS } from '../mcp-server-config';
import type { PromptTypeHandler } from '../prompt-type-handler';
import { READ_EVIDENCE_SHARD_TOOL_NAME } from '../submission-tools/read-evidence-shard-tool';
import type { ProjectReportShardEntry } from './project-report-evidence-store';
import type { ProjectReportGroupKind } from './project-report-grouping';
import { buildProjectReportSectionPrompt } from './project-report-section-prompt';

export const PROJECT_REPORT_SECTION_HANDLER_ID = 'project_report_section';

/** One shard a section child must read, and the pages of it still unread. */
export interface ProjectReportSectionShard extends ProjectReportShardEntry {
  pagesToRead: number[];
}

export interface ProjectReportSectionPayload {
  request: {
    question: string;
    scope: ProjectReportScope;
    exclusions: ProjectReportSubject[];
  };
  group: { key: string; kind: ProjectReportGroupKind; title: string };
  shards: ProjectReportSectionShard[];
  toolCallBudget: number;
}

/**
 * Child-only handler that reads one work group's evidence shards and returns
 * dated findings per subject to the parent report agent.
 *
 * Read-only graph tools, no built-ins, read-only sandbox, and one submission
 * tool: `read_evidence_shard`. It never submits or creates anything.
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
    submissionTools: 'run-registered',
    submissionToolNames: [READ_EVIDENCE_SHARD_TOOL_NAME],
    codexSandboxMode: 'read-only',
    includePriorReports: false,
  },
  buildPrompt: buildProjectReportSectionPrompt,
};
