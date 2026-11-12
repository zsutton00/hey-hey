import { oneMessageInputs } from './eval-case-inputs.fixture';
import { describe, expect, it } from 'vitest';
import type { EvalRunCaseInput } from '@hey-hey/contracts/api/models';
import { evalJudgeHandler, parseEvalJudgeOutput } from './eval-judge.handler';

const caseInput: EvalRunCaseInput = {
  id: 'case',
  evalCaseId: 'eval-case',
  title: 'Mockup maintenance',
  target: {
    situation: 'The feature changed.',
    inputs: oneMessageInputs('Add a filter.'),
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
  it('limits the judge to uncertainty reporting and gives it the checks, rubric and output', () => {
    expect(evalJudgeHandler.childConfig).toMatchObject({
      mcpAllowedTools: [],
      builtinAllowedTools: [],
      submissionTools: 'run-registered',
      submissionToolNames: ['raise_uncertainty'],
    });
    const prompt = evalJudgeHandler.buildPrompt({ caseInput, outputText: 'THE-OUTPUT' });
    expect(prompt).toContain('finds-mockup: Finds the existing mockup');
    expect(prompt).toContain('grounding (Grounding)');
    expect(prompt).toContain('THE-OUTPUT');
    expect(prompt).toContain('not a failure');
  });
});

const codingCase = (kind: 'NEW' | 'UPDATE'): EvalRunCaseInput => ({
  ...caseInput,
  coding: {
    serviceId: 'service',
    pinnedCommit: { sha: 'abc', shortMessage: 'start' },
    knownGoodDiff: 'good',
    knownBadDiff: 'bad',
    mockupChecklist: {
      mockupId: 'mockup',
      kind,
      items: [
        { id: 'a', description: 'Shows the filter' },
        { id: 'b', description: 'Clears the filter' },
      ],
    },
  },
});

const codingOutput = {
  ...valid,
  checklistResults: [
    { itemId: 'a', hit: true, explanation: 'added' },
    { itemId: 'b', hit: false, explanation: 'missing' },
  ],
  regressions: ['Sorting no longer works'],
};

describe('coding judgments', () => {
  it('shows the judge the checklist and asks for regressions only on an update', () => {
    const update = evalJudgeHandler.buildPrompt({
      caseInput: codingCase('UPDATE'),
      outputText: 'PATCHES',
    });
    const created = evalJudgeHandler.buildPrompt({
      caseInput: codingCase('NEW'),
      outputText: 'PATCHES',
    });
    expect(update).toContain('a: Shows the filter');
    expect(update).toContain('"regressions"');
    expect(created).toContain('b: Clears the filter');
    expect(created).not.toContain('"regressions"');
  });

  it("shows the judge a case's examples as labelled reference, only when it has them", () => {
    const {
      knownGoodDiff: _good,
      knownBadDiff: _bad,
      ...codingWithoutExamples
    } = codingCase('NEW').coding!;
    const base = { ...codingCase('NEW'), coding: codingWithoutExamples };
    const withExamples = {
      ...base,
      coding: { ...base.coding, knownGoodDiff: 'GOOD PATCH', knownBadDiff: 'BAD PATCH' },
    };
    const prompt = evalJudgeHandler.buildPrompt({
      caseInput: withExamples,
      outputText: 'ATTEMPT PATCH',
    });
    const without = evalJudgeHandler.buildPrompt({ caseInput: base, outputText: 'ATTEMPT PATCH' });

    expect(prompt).toContain('a good way to do this task');
    expect(prompt).toContain('GOOD PATCH');
    expect(prompt).toContain('a bad way to do this task');
    expect(prompt).toContain('BAD PATCH');
    expect(prompt).toContain('not the attempt under judgment');
    expect(without).not.toContain('Reference examples');
  });

  it('rejects a judgment that leaves a checklist item unanswered', () => {
    const missing = {
      ...codingOutput,
      checklistResults: codingOutput.checklistResults.slice(0, 1),
    };
    expect(() =>
      parseEvalJudgeOutput(JSON.stringify(missing), codingCase('UPDATE'), 'now'),
    ).toThrow('checklist item');
  });

  it('records checklist results and keeps regressions for an update only', () => {
    const updated = parseEvalJudgeOutput(JSON.stringify(codingOutput), codingCase('UPDATE'), 'now');
    expect(updated.checklistResults).toEqual(codingOutput.checklistResults);
    expect(updated.regressions).toEqual(['Sorting no longer works']);

    const created = parseEvalJudgeOutput(JSON.stringify(codingOutput), codingCase('NEW'), 'now');
    expect(created.checklistResults).toEqual(codingOutput.checklistResults);
    expect(created).not.toHaveProperty('regressions');
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

describe('judging a scripted conversation', () => {
  it('shows earlier messages as context only and judges the final message and its own tool calls', () => {
    const prompt = evalJudgeHandler.buildPrompt({
      caseInput,
      outputText: 'FINAL-REPLY',
      toolCalls: {
        state: 'COLLECTED',
        calls: [{ toolName: 'FINAL-TOOL', origin: 'RUN_OBSERVED', truncated: false }],
      },
      conversation: {
        earlierTurns: [
          {
            index: 0,
            input: 'EARLIER-USER',
            state: 'COMPLETED',
            reply: 'EARLIER-REPLY',
            recordedToolCalls: {
              state: 'COLLECTED',
              calls: [{ toolName: 'EARLIER-TOOL', origin: 'RUN_OBSERVED', truncated: false }],
            },
          },
        ],
        judgedTurn: { index: 1, input: 'FINAL-USER', state: 'COMPLETED', reply: 'FINAL-REPLY' },
      },
    });

    const [context, final] = prompt.split("## The agent's output for the message under test");
    expect(context).toContain('Earlier conversation (context only)');
    expect(context).toContain('EARLIER-USER');
    expect(context).toContain('EARLIER-TOOL');
    expect(context).toContain('can satisfy a check or earn credit');
    expect(final).toContain('FINAL-REPLY');
    expect(final).toContain('FINAL-TOOL');
    expect(final).not.toContain('EARLIER-TOOL');
  });
});
