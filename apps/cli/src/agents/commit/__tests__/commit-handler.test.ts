import { describe, expect, it } from 'vitest';
import { CommitHandler } from '../commit.handler';
import type { LocalCommitPromptPayload } from '../../../shared/agent-bridge-contract/runtime-types';
import { ReportAudience, ReportType } from '../../../shared/api/index';
import { makeCreateReportProxy } from '../../submission-tools/create-report-proxy.test-support';
import { resolveHintPromptAccess } from '../../mcp-server-config';

const commitHandler = new CommitHandler(makeCreateReportProxy());

const makePayload = (
  overrides: Partial<LocalCommitPromptPayload> = {},
): LocalCommitPromptPayload => ({
  changedFiles: ['src/foo.ts'],
  userMessage: '',
  ...overrides,
});

describe('CommitHandler', () => {
  it('can read graph Hints where the legacy service-hint search was available', () => {
    expect(commitHandler.subagentConfig?.mcpAllowedTools).toContain('get_hints_for_items');
  });

  it('has promptType "commit"', () => {
    expect(commitHandler.promptType).toBe('commit');
  });

  it('has a prepare step that enriches the payload with services', () => {
    expect(typeof commitHandler.prepare).toBe('function');
  });

  it('accepts only the typed commit-message result and requires the runtime COMMIT report', () => {
    expect(commitHandler.submissionTools?.map((tool) => tool.name)).toEqual([
      'submit_commit_message',
    ]);
    expect(commitHandler.reports).toEqual([
      { reportType: ReportType.Commit, audience: ReportAudience.ProjectVisible, required: true },
    ]);
    expect(typeof commitHandler.onSubagentComplete).toBe('function');
  });

  it('does not load prior reports into the commit subagent', () => {
    expect(commitHandler.subagentConfig?.includePriorReports).toBe(false);
  });

  it('gets graph-Hints read guidance where legacy hint search was available', () => {
    const allowedTools = commitHandler.subagentConfig?.mcpAllowedTools ?? [];
    expect(allowedTools).toContain('get_hints_for_items');
    expect(allowedTools).not.toContain('search_implementation_hints');
    expect(resolveHintPromptAccess(true, [...allowedTools])).toBe('read');
  });

  describe('buildPrompt', () => {
    it('returns a non-empty prompt string', () => {
      const prompt = commitHandler.buildPrompt(makePayload());
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('src/foo.ts');
    });
  });

  describe('buildStartingMessage', () => {
    it('returns the standard progress message', () => {
      expect(commitHandler.buildStartingMessage!(makePayload())).toBe(
        'Generating commit message...',
      );
    });
  });
});
