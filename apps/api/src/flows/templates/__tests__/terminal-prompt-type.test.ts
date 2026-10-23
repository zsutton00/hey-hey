import { templates } from '../../index';

describe('Flow registry — terminalPromptType invariant', () => {
  it('does not register the removed legacy coding-prompts flow', () => {
    const ids = templates.map((template) => template.id);

    expect(ids).not.toContain('coding-prompts');
    expect(ids).toContain('coding-prompt-research');
  });

  it('every registered flow template declares a non-empty terminalPromptType', () => {
    expect(templates.length).toBeGreaterThan(0);
    for (const flow of templates) {
      expect(flow.terminalPromptType).toBeDefined();
      expect(typeof flow.terminalPromptType).toBe('string');
      expect(flow.terminalPromptType.length).toBeGreaterThan(0);
    }
  });
});
