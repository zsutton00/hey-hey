import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COMMIT_SUBAGENT_MCP_ALLOWED_TOOLS } from './commit/commit.handler';
import { CODING_PLAN_SUBAGENT_MCP_ALLOWED_TOOLS } from './coding-plan/coding-plan.handler';
import { FINAL_ASSESSMENT_SUBAGENT_MCP_ALLOWED_TOOLS } from './final-assessment/final-assessment.handler';
import {
  PROJECT_REPORT_SECTION_MCP_TOOLS,
  SHARED_READ_MCP_TOOLS,
  resolveMcpToolNames,
  type McpToolUseCase,
} from './mcp-server-config';
import { buildPlatformSystemPrompt } from './prompts/common';
import { projectReportHandler } from './project-report/project-report.handler';
import { repositoryFeatureEnrichmentHandler } from './repository-feature-enrichment/repository-feature-enrichment.handler';
import { repositoryFirstWorkHandler } from './repository-first-work/repository-first-work.handler';
import { researchHandler } from './research/research.handler';
import { REVIEW_SUBAGENT_MCP_ALLOWED_TOOLS } from './review-subagent/review.handler';

/** Every platform tool a prompt can recommend, so a mention is detectable by name. */
const PLATFORM_TOOLS = [
  ...SHARED_READ_MCP_TOOLS,
  'create_work_item',
  'edit_work_item',
  'get_proposal',
  'get_report_body',
  'get_report_schema',
  'list_reports_by_entity',
  'search_features',
  'task_search',
  'update_proposal',
];

const toolsNamedIn = (source: string): string[] =>
  PLATFORM_TOOLS.filter((tool) => new RegExp(`\\b${tool}\\b`, 'u').test(source));

const promptSource = (relativePath: string): string =>
  readFileSync(join(__dirname, relativePath), 'utf8');

/** The tools the delivered shared prompt tells every agent to choose between. */
const sharedPromptReadTools = (): string[] => {
  const prompt = buildPlatformSystemPrompt([]);
  const section = prompt.slice(prompt.indexOf('## Choosing the Smallest Read'));
  const choices = section.slice(0, section.indexOf('\n\n## '));

  return toolsNamedIn(choices);
};

// Every use case that has a platform graph surface. Monitors, repository
// grounding and work-tracker import are tool-free by contract, so the shared
// read advice does not apply to them.
const USE_CASES_WITH_GRAPH_READS: Array<McpToolUseCase | undefined> = [
  undefined,
  'coding',
  'general',
  'planning',
  'plan_shaping',
  'research',
  'project_report',
  'release_notes',
  'repository_placement',
];

const CHILD_SURFACES: Array<{ name: string; tools: readonly string[] }> = [
  { name: 'coding plan', tools: CODING_PLAN_SUBAGENT_MCP_ALLOWED_TOOLS },
  { name: 'commit', tools: COMMIT_SUBAGENT_MCP_ALLOWED_TOOLS },
  { name: 'final assessment', tools: FINAL_ASSESSMENT_SUBAGENT_MCP_ALLOWED_TOOLS },
  { name: 'review', tools: REVIEW_SUBAGENT_MCP_ALLOWED_TOOLS },
  { name: 'project report section', tools: PROJECT_REPORT_SECTION_MCP_TOOLS },
  { name: 'research child', tools: researchHandler.childConfig?.mcpAllowedTools ?? [] },
];

describe('shared read advice and the tool surface', () => {
  it('recommends the full set of shared read tools', () => {
    expect([...sharedPromptReadTools()].sort()).toEqual([...SHARED_READ_MCP_TOOLS].sort());
  });

  it.each(USE_CASES_WITH_GRAPH_READS.map((useCase) => [useCase ?? 'default', useCase] as const))(
    'admits every tool the shared prompt recommends on the %s surface',
    (_name, useCase) => {
      const allowed = new Set(resolveMcpToolNames(useCase ? { useCase } : {}));

      const missing = sharedPromptReadTools().filter((tool) => !allowed.has(tool));

      expect(missing).toEqual([]);
    },
  );

  it.each(CHILD_SURFACES)(
    'admits every tool the shared prompt recommends to the $name subagent',
    ({ tools }) => {
      const allowed = new Set(tools);

      const missing = sharedPromptReadTools().filter((tool) => !allowed.has(tool));

      expect(missing).toEqual([]);
    },
  );
});

describe('handler prompts and the tool surface', () => {
  const SURFACES: Array<{
    name: string;
    useCase: McpToolUseCase;
    additionalTools?: readonly string[];
    promptFiles: string[];
  }> = [
    {
      name: 'repository placement',
      useCase: 'repository_placement',
      promptFiles: ['repository-placement/repository-placement-prompt.ts'],
    },
    {
      name: 'repository feature enrichment',
      useCase: repositoryFeatureEnrichmentHandler.mcpToolUseCase,
      additionalTools: repositoryFeatureEnrichmentHandler.additionalAllowedTools,
      promptFiles: ['repository-feature-enrichment/repository-feature-enrichment-prompt.ts'],
    },
    {
      name: 'repository first work',
      useCase: repositoryFirstWorkHandler.mcpToolUseCase,
      additionalTools: repositoryFirstWorkHandler.additionalAllowedTools,
      promptFiles: ['repository-first-work/repository-first-work-prompt.ts'],
    },
    {
      name: 'project report',
      useCase: projectReportHandler.mcpToolUseCase,
      promptFiles: ['project-report/project-report-prompt.ts'],
    },
    {
      name: 'research',
      useCase: 'research',
      promptFiles: ['prompts/research.ts', 'prompts/graph-research.ts'],
    },
  ];

  it.each(SURFACES)(
    'lets the $name handler call every platform tool its prompt names',
    ({ useCase, additionalTools, promptFiles }) => {
      const allowed = new Set(
        resolveMcpToolNames({ useCase, additionalTools: additionalTools ?? [] }),
      );
      const named = promptFiles.flatMap((file) => toolsNamedIn(promptSource(file)));

      expect(named.filter((tool) => !allowed.has(tool))).toEqual([]);
    },
  );
});
