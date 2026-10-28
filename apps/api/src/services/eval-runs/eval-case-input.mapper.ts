import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  EvalCheckDefinition,
  EvalRubricDimension,
  EvalRunCaseInput,
} from 'src/generated';
import { resolveEvalCaseHandlers } from './eval-case-handlers';

export type EvalCaseRecord = {
  id: string;
  name: string;
  sections: ReadonlyArray<{ key: string; materializedMarkdown: string | null }>;
};

const MENTION_PATTERN =
  /@\[[a-z_]+:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|[^\]]*\]/gi;
const LIST_ITEM_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * Items are listed with inline mentions; the first mentioned item is the
 * case's focal item and the rest support it.
 */
function parseItems(markdown: string): {
  focalItemId: string | null;
  supportingItemIds: string[];
} {
  const ids = [
    ...new Set(
      [...markdown.matchAll(MENTION_PATTERN)].map((match) =>
        match[1]!.toLowerCase(),
      ),
    ),
  ];
  return { focalItemId: ids[0] ?? null, supportingItemIds: ids.slice(1) };
}

function parseListItems(markdown: string): string[] {
  const items: string[] = [];
  for (const line of markdown.split('\n')) {
    const item = LIST_ITEM_PATTERN.exec(line);
    if (item) {
      items.push(item[1]!.trim());
    } else if (items.length > 0 && line.trim()) {
      items[items.length - 1] += ` ${line.trim()}`;
    }
  }
  return items.filter(Boolean);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function parseChecks(markdown: string): EvalCheckDefinition[] {
  return parseListItems(markdown).map((description, index) => ({
    id: `check-${index + 1}`,
    description,
  }));
}

function parseRubric(markdown: string): EvalRubricDimension[] {
  const used = new Set<string>();
  return parseListItems(markdown).map((entry, index) => {
    const separator = entry.search(/[:—]|\s-\s/);
    const name = (separator > 0 ? entry.slice(0, separator) : entry)
      .replace(/[*_`]/g, '')
      .trim();
    const description =
      separator > 0
        ? entry.slice(separator + 1).replace(/^\s*-?\s*/, '')
        : entry;
    const base = slugify(name) || `dimension-${index + 1}`;
    let key = base;
    for (let suffix = 2; used.has(key); suffix += 1) {
      key = `${base}-${suffix}`;
    }
    used.add(key);
    return { key, name, description: description.trim() || name };
  });
}

/**
 * Records an approved Eval Case exactly as it stands at launch. The target
 * half carries only what the handler may see; checks, rubric and expectations
 * stay in the grading half.
 */
export function toEvalRunCaseInput(record: EvalCaseRecord): EvalRunCaseInput {
  const section = (key: string): string =>
    record.sections
      .find((candidate) => candidate.key === key)
      ?.materializedMarkdown?.trim() ?? '';

  const situation = section('situation');
  const initiatingRequest = section('request');
  const handler = section('handler');
  const missing = [
    ['situation', situation],
    ['request', initiatingRequest],
    ['handler', handler],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new BadRequestException(
      `Eval case "${record.name}" cannot run: missing ${missing.join(', ')}`,
    );
  }
  const handlers = resolveEvalCaseHandlers(
    record.name,
    handler,
    section('consumerHandler'),
  );

  const items = parseItems(section('items'));
  const expectations = section('expectations');
  return {
    id: randomUUID(),
    evalCaseId: record.id,
    title: record.name,
    target: {
      situation,
      focalItemId: items.focalItemId,
      supportingItemIds: items.supportingItemIds,
      initiatingRequest,
      ...handlers,
    },
    grading: {
      ...(expectations ? { expectations } : {}),
      checks: parseChecks(section('checks')),
      rubric: parseRubric(section('rubric')),
    },
  };
}
