import type { JevInput } from '../client';
import { cacheKey } from './state';

const json = (value: unknown): string => JSON.stringify(value, null, 2);

/** A request exactly as it is sent, with the cache key it is stored under. */
export const formatRequest = (input: JevInput): string => {
  const lines = ['--- state (JSON sent to Jev) ---', json(input.state)];
  for (const [id, question] of Object.entries(input.questions)) {
    const instructions =
      typeof question.instructions === 'string'
        ? question.instructions
        : json(question.instructions);
    lines.push(`\n--- question "${id}" (${question.type}) ---`, instructions);
    if (question.type !== 'noul') lines.push(`criteria: ${json(question.criteria)}`);
  }
  lines.push(
    `\nmodel: ${input.model}`,
    `cache key: ${cacheKey(input.state, input.questions, input.model)}`,
  );
  return lines.join('\n');
};
