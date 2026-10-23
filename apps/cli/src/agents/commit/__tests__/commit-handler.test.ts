import { describe, expect, it } from 'vitest';
import { CommitHandler } from '../commit.handler';
import type { LocalCommitPromptPayload } from '../../../shared/agent-bridge-contract/runtime-types';
import { ReportAudience, ReportType } from '../../../shared/api/index';
import { makeCreateReportProxy } from '../../submission-tools/create-report-proxy.test-support';

const commitHandler = new CommitHandler(makeCreateReportProxy());

const makePayload = (
  overrides: Partial<LocalCommitPromptPayload> = {},
): LocalCommitPromptPayload => ({
  changedFiles: ['src/foo.ts'],
  userMessage: '',
  ...overrides,
});

describe('CommitHandler', () => {
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
