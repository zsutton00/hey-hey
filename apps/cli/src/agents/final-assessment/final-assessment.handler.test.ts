import { describe, expect, it } from 'vitest';
import { finalAssessmentHandler } from './final-assessment.handler';
import { resolveHintPromptAccess } from '../mcp-server-config';

describe('finalAssessmentHandler', () => {
  it('uses graph Hints in place of legacy implementation-hint tools', () => {
    const allowedTools = finalAssessmentHandler.subagentConfig?.mcpAllowedTools ?? [];

    for (const tool of [
      'get_hints_for_items',
      'create_hint',
      'add_hint_connection',
      'delete_hint',
    ]) {
      expect(allowedTools).toContain(tool);
    }
    expect(resolveHintPromptAccess(true, [...allowedTools])).toBe('write');

    for (const tool of [
      'search_implementation_hints',
      'create_implementation_hint',
      'edit_implementation_hint',
      'delete_implementation_hint',
    ]) {
      expect(allowedTools).not.toContain(tool);
    }
  });
});
