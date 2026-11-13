import type { RepositoryFeatureEnrichmentQuestionGroup } from '@hey-hey/contracts/agent-bridge';
import {
  createAgentBridgeRuntimeValidator,
  formatRuntimeSchemaErrors,
} from '../../shared/agent-bridge-contract/runtime-schema-validator';

export const ENRICHMENT_QUESTIONS_TAG = 'enrichment_questions';

const BLOCK = new RegExp(`<${ENRICHMENT_QUESTIONS_TAG}>([\\s\\S]*?)</${ENRICHMENT_QUESTIONS_TAG}>`);

const validateQuestionGroup =
  createAgentBridgeRuntimeValidator<RepositoryFeatureEnrichmentQuestionGroup>(
    'RepositoryFeatureEnrichmentQuestionGroup',
  );

export type EnrichmentQuestionsParseResult =
  /** The agent asked no structured questions. */
  | { kind: 'absent' }
  /** Valid questions; `visibleText` is the message with the block removed. */
  | { kind: 'questions'; questions: string[]; visibleText: string }
  /** A block was present but unreadable; the message text is left untouched. */
  | { kind: 'invalid'; cause: string };

/** Reads the agent's structured question block once, at the agent-output trust boundary. */
export function parseEnrichmentQuestions(text: string): EnrichmentQuestionsParseResult {
  const match = BLOCK.exec(text);
  if (!match) {
    return { kind: 'absent' };
  }

  let value: unknown;
  try {
    value = JSON.parse(match[1] ?? '');
  } catch (error) {
    return {
      kind: 'invalid',
      cause: `The question block is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!validateQuestionGroup(value)) {
    return { kind: 'invalid', cause: formatRuntimeSchemaErrors(validateQuestionGroup.errors) };
  }

  const questions = value.questions.map((question) => question.trim());
  if (questions.some((question) => question.length === 0)) {
    return { kind: 'invalid', cause: 'A question is empty.' };
  }
  if (new Set(questions).size !== questions.length) {
    return { kind: 'invalid', cause: 'A question is repeated within the round.' };
  }

  return { kind: 'questions', questions, visibleText: text.replace(BLOCK, '').trim() };
}
