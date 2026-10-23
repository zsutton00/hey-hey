import { z } from 'zod';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { EvalAutomatedAssessment, EvalRunCaseInput } from '../../shared/api/generated/api';
import type { PromptTypeHandler } from '../prompt-type-handler';

export const EVAL_JUDGE_HANDLER_ID = 'eval_judge';

export interface EvalJudgePayload {
  caseInput: EvalRunCaseInput;
  /** The attempt's retained answer. The judge never sees the target's context. */
  outputText: string;
}

const judgeOutputSchema = z.object({
  checkResults: z.array(
    z.object({ checkId: z.string(), passed: z.boolean(), explanation: z.string() }),
  ),
  recognition: z.object({ recognized: z.boolean(), explanation: z.string() }),
  quality: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      score: z.number().min(0).max(5),
      explanation: z.string(),
    }),
  ),
});

/**
 * Reads the judge's final JSON object. Every recorded check must be answered
 * exactly once; anything else is a judge failure, not a partial assessment.
 */
export const parseEvalJudgeOutput = (
  outputText: string,
  caseInput: EvalRunCaseInput,
  createdAt: string,
): Omit<EvalAutomatedAssessment, 'judgeSessionId'> => {
  const start = outputText.indexOf('{');
  const end = outputText.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The judge returned no JSON assessment.');
  const parsed = judgeOutputSchema.parse(JSON.parse(outputText.slice(start, end + 1)));
  const expected = caseInput.grading.checks.map((check) => check.id).sort();
  const answered = parsed.checkResults.map((result) => result.checkId).sort();
  if (expected.join('\n') !== answered.join('\n')) {
    throw new Error('The judge did not answer each recorded check exactly once.');
  }
  return { ...parsed, createdAt };
};

const buildEvalJudgePrompt = (payload: EvalJudgePayload): string => {
  const { caseInput, outputText } = payload;
  const { target, grading } = caseInput;
  return [
    'You are judging one attempt from an agent evaluation. You have no tools. Judge only the evidence below.',
    '',
    '## Case',
    `Title: ${caseInput.title}`,
    `Situation: ${target.situation}`,
    `Request the agent received: ${target.initiatingRequest}`,
    ...(grading.expectations
      ? ['', '## Expected and forbidden behaviour', grading.expectations]
      : []),
    '',
    '## Checks',
    ...grading.checks.map((check) => `- ${check.id}: ${check.description}`),
    '',
    '## Rubric',
    ...grading.rubric.map(
      (dimension) => `- ${dimension.key} (${dimension.name}): ${dimension.description}`,
    ),
    '',
    "## The agent's output",
    outputText,
    '',
    '## How to judge',
    '- Answer every check: passed or not, with a short explanation citing the output.',
    '- Recognition: did the agent notice what the situation called for, even if it was never asked? Rate this apart from how well it then did the work.',
    '- Quality: score each rubric dimension from 0 to 5 with an explanation.',
    '- Accept any approach that meets the expectations. A different tool sequence or different wording is not a failure.',
    '- If the output lacks what a judgment needs, say so in that explanation rather than guessing.',
    '',
    'Reply with one JSON object and nothing else:',
    '{"checkResults":[{"checkId":"","passed":true,"explanation":""}],"recognition":{"recognized":true,"explanation":""},"quality":[{"key":"","name":"","score":0,"explanation":""}]}',
  ].join('\n');
};

/** Child-only judge for eval attempts: no tools, returns one JSON assessment. */
export const evalJudgeHandler: PromptTypeHandler<EvalJudgePayload> = {
  id: EVAL_JUDGE_HANDLER_ID,
  promptType: LocalPromptType.RunEval,
  service: 'optional',
  launchEntity: 'none',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: false,
  reports: [],
  replaceProviderSystemPrompt: true,
  omitServiceContextNote: true,
  childConfig: {
    adapterId: 'eval-judge-subagent',
    mcpAllowedTools: [],
    builtinAllowedTools: [],
    submissionTools: 'none',
    codexSandboxMode: 'read-only',
    includePriorReports: false,
    emitNormalizedEvents: false,
  },
  buildPrompt: buildEvalJudgePrompt,
};
