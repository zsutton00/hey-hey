import { describe, expect, it } from 'vitest';
import type { EvalRunCaseInput } from '../../shared/api/generated/api';
import { evalJudgeHandler, parseEvalJudgeOutput } from './eval-judge.handler';

const caseInput: EvalRunCaseInput = {
  id: 'case',
  evalCaseId: 'eval-case',
  title: 'Mockup maintenance',
  target: {
    situation: 'The feature changed.',
    initiatingRequest: 'Add a filter.',
    targetHandler: 'entity_conversation',
  },
  grading: {
    expectations: 'Proposes a mockup update.',
    checks: [{ id: 'finds-mockup', description: 'Finds the existing mockup' }],
    rubric: [{ key: 'grounding', name: 'Grounding', description: 'Cites real items' }],
  },
};

const valid = {
  checkResults: [{ checkId: 'finds-mockup', passed: true, explanation: 'cited it' }],
  recognition: { recognized: true, explanation: 'noticed the mockup' },
  quality: [{ key: 'grounding', name: 'Grounding', score: 4, explanation: 'cited' }],
};

describe('evalJudgeHandler', () => {
  it('has no tools and gives the judge the checks, rubric and output', () => {
    expect(evalJudgeHandler.childConfig).toMatchObject({
      mcpAllowedTools: [],
      builtinAllowedTools: [],
      submissionTools: 'none',
    });
    const prompt = evalJudgeHandler.buildPrompt({ caseInput, outputText: 'THE-OUTPUT' });
    expect(prompt).toContain('finds-mockup: Finds the existing mockup');
    expect(prompt).toContain('grounding (Grounding)');
    expect(prompt).toContain('THE-OUTPUT');
    expect(prompt).toContain('not a failure');
  });
});

describe('parseEvalJudgeOutput', () => {
  it('reads the assessment, with recognition apart from quality', () => {
    expect(parseEvalJudgeOutput(`Here:\n${JSON.stringify(valid)}`, caseInput, 'now')).toEqual({
      ...valid,
      createdAt: 'now',
    });
  });

  it('rejects an assessment that skips a recorded check', () => {
    expect(() =>
      parseEvalJudgeOutput(JSON.stringify({ ...valid, checkResults: [] }), caseInput, 'now'),
    ).toThrow('each recorded check');
  });

  it('rejects output with no JSON', () => {
    expect(() => parseEvalJudgeOutput('looks fine', caseInput, 'now')).toThrow('no JSON');
  });
});
