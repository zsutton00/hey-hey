import { z } from 'zod';
import { SessionRole, LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import {
  EvalCaseMockupChecklistKindEnum,
  ReadRestriction,
  type EvalAutomatedAssessment,
  type EvalCaseCoding,
  type EvalRunCaseInput,
} from '@hey-hey/contracts/api/models';
import type { PromptTypeHandler } from '../prompt-type-handler';

export const EVAL_JUDGE_HANDLER_ID = 'eval_judge';

export interface EvalJudgePayload {
  caseInput: EvalRunCaseInput;
  /**
   * The attempt's retained answer. For a coding case this is the rendered saved
   * changes, never the chat reply. The judge never sees the target's context.
   */
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
  checklistResults: z
    .array(z.object({ itemId: z.string(), hit: z.boolean(), explanation: z.string() }))
    .optional(),
  regressions: z.array(z.string()).optional(),
});

const sameIds = (expected: readonly string[], answered: readonly string[]): boolean =>
  [...expected].sort().join('\n') === [...answered].sort().join('\n');

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
  const { checklistResults, regressions, ...assessed } = parsed;
  const expected = caseInput.grading.checks.map((check) => check.id);
  const answered = parsed.checkResults.map((result) => result.checkId);
  if (!sameIds(expected, answered)) {
    throw new Error('The judge did not answer each recorded check exactly once.');
  }

  const checklist = caseInput.coding?.mockupChecklist;
  if (!checklist) {
    return { ...assessed, createdAt };
  }

  const checklistIds = checklist.items.map((item) => item.id);
  if (
    !checklistResults ||
    !sameIds(
      checklistIds,
      checklistResults.map((r) => r.itemId),
    )
  ) {
    throw new Error('The judge did not answer each checklist item exactly once.');
  }

  return {
    ...assessed,
    checklistResults,
    ...(checklist.kind === EvalCaseMockupChecklistKindEnum.Update
      ? { regressions: regressions ?? [] }
      : {}),
    createdAt,
  };
};

const fenced = (text: string): string[] => {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return [fence, text, fence];
};

/** The case's optional good and bad examples, kept apart from the attempt's own changes. */
const buildReferenceExamplesSection = (coding: EvalCaseCoding): string[] => {
  const examples = [
    { label: 'a good way to do this task', diff: coding.knownGoodDiff },
    { label: 'a bad way to do this task', diff: coding.knownBadDiff },
  ].filter((example) => example.diff !== undefined);
  if (examples.length === 0) {
    return [];
  }

  return [
    '',
    '## Reference examples',
    'These show what this case exists to catch. Compare the attempt against them; they are not the attempt under judgment.',
    ...examples.flatMap((example) => ['', `Reference: ${example.label}`, ...fenced(example.diff!)]),
  ];
};

const buildCodingJudgeSections = (caseInput: EvalRunCaseInput): string[] => {
  const checklist = caseInput.coding?.mockupChecklist;
  if (!caseInput.coding) {
    return [];
  }

  return [
    '',
    '## Judging a coding attempt',
    "- The output above is the attempt's saved changes as per-file patches, not its chat reply. Judge only what the patches do.",
    '- Recognition: did the changes address requirements that appear only on the governing Feature or other linked items and not in the request? Rate this apart from code quality.',
    '- Quality: judge the code itself.',
    ...(checklist
      ? [
          '- A checklist item is a hit only if the changes implement it. Judge from the changes, not from appearance or intent.',
          ...(checklist.kind === EvalCaseMockupChecklistKindEnum.Update
            ? [
                '- Regressions: list anything that worked before and the changes now break. Use an empty list if none.',
              ]
            : []),
          '',
          `## Mockup checklist (${checklist.kind === EvalCaseMockupChecklistKindEnum.New ? 'new Mockup' : 'updated Mockup'})`,
          ...checklist.items.map((item) => `- ${item.id}: ${item.description}`),
        ]
      : []),
    ...buildReferenceExamplesSection(caseInput.coding),
  ];
};

const checklistShape = (caseInput: EvalRunCaseInput): string => {
  const checklist = caseInput.coding?.mockupChecklist;
  if (!checklist) {
    return '';
  }

  const regressions =
    checklist.kind === EvalCaseMockupChecklistKindEnum.Update ? ',"regressions":[""]' : '';

  return `,"checklistResults":[{"itemId":"","hit":true,"explanation":""}]${regressions}`;
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
    ...buildCodingJudgeSections(caseInput),
    '',
    'Reply with one JSON object and nothing else:',
    `{"checkResults":[{"checkId":"","passed":true,"explanation":""}],"recognition":{"recognized":true,"explanation":""},"quality":[{"key":"","name":"","score":0,"explanation":""}]${checklistShape(caseInput)}}`,
  ].join('\n');
};

/** Child-only judge for eval attempts: may record uncertainty, returns one JSON assessment. */
export const evalJudgeHandler: PromptTypeHandler<EvalJudgePayload> = {
  id: EVAL_JUDGE_HANDLER_ID,
  sessionRole: SessionRole.Review,
  promptType: LocalPromptType.RunEval,
  service: 'optional',
  launchEntity: 'none',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: false,
  reports: [],
  replaceProviderSystemPrompt: true,
  omitServiceContextNote: true,
  // The judge gets its case and rubric in its payload and must never read live grading reports.
  readRestriction: ReadRestriction.EvalJudge,
  childConfig: {
    adapterId: 'eval-judge-subagent',
    submissionTools: 'run-registered',
    submissionToolNames: ['raise_uncertainty'],
    mcpAllowedTools: [],
    builtinAllowedTools: [],
    codexSandboxMode: 'read-only',
    includePriorReports: false,
    emitNormalizedEvents: false,
  },
  buildPrompt: buildEvalJudgePrompt,
};
