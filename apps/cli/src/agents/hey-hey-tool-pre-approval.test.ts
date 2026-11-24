import { describe, expect, it } from 'vitest';
import { BROWSER_ALLOWED_TOOLS } from './browser-tools/mcp-config';
import { HeyHeyToolPreApproval } from './hey-hey-tool-pre-approval';

describe('HeyHeyToolPreApproval', () => {
  const preApproval = new HeyHeyToolPreApproval({
    platformAllowedTools: ['mcp__heyhey-platform__get_context', 'mcp__user-server__get_context'],
    activeSubmissionToolNames: ['report_changed_files'],
    browserAllowedTools: BROWSER_ALLOWED_TOOLS,
  });

  it('holds the turn’s active platform, submission and browser tools by qualified name', () => {
    expect(preApproval.has('mcp__heyhey-platform__get_context')).toBe(true);
    expect(preApproval.has('mcp__heyhey-submission-tools__report_changed_files')).toBe(true);
    expect(preApproval.has('mcp__heyhey-browser__navigate')).toBe(true);
  });

  it('holds nothing outside Hey Hey servers or the active set, matching whole names only', () => {
    expect(preApproval.has('mcp__user-server__get_context')).toBe(false);
    expect(preApproval.has('mcp__heyhey-platform__create_report')).toBe(false);
    expect(preApproval.has('mcp__heyhey-platform__get_context_extra')).toBe(false);
    expect(preApproval.has('Bash')).toBe(false);
  });
});
