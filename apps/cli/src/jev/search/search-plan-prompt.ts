import { z } from 'zod';
import { EntityType } from '../../shared/api/generated';
import type { Focal } from '../scenarios';
import { plannedSearchSchema } from './search-executor';

/** Searches one plan may carry. */
export const MAX_CONTEXT_SEARCHES = 8;

/** The searches the model plans; `gather` validates the same shape. */
export const submitContextSearchesSchema = z.object({
  searches: z.array(plannedSearchSchema).min(1).max(MAX_CONTEXT_SEARCHES),
});

export type SubmitContextSearches = z.infer<typeof submitContextSearchesSchema>;

/** Asks the model, before any session starts, for the searches that would find the context a request needs. */
export const SEARCH_PLAN_PROMPT = `The prompt above describes the research you will do later. Right now do none of it: list the searches that would find the project context this request needs. Base them on the focal entity and the user's request below. Answer with only a JSON object of the form {"searches": [{"query": "...", "types": ["TASK"]}]}: one entry per search, at most ${String(MAX_CONTEXT_SEARCHES)}, each a query and, optionally, \`types\`: entity types to search, only from ${Object.values(EntityType).join(', ')}. Features, tasks, bugs and other work items are all TASK. Omit \`types\` to search every type. Write no other text.`;

/** `context` is the Project Assistant's own prompt without the gathered entities, so the planner knows how the work is done. */
export const buildSearchPlanPrompt = (context: string, focal: Focal, ask: string): string =>
  [
    context,
    SEARCH_PLAN_PROMPT,
    `## Focal entity\n\n${JSON.stringify(focal, null, 2)}`,
    `## The user's request\n\n${ask === '' ? '(none)' : ask}`,
  ].join('\n\n');
