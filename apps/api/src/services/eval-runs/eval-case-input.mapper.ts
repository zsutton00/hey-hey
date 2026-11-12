import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  EvalCaseTarget,
  EvalCheckDefinition,
  EvalRubricDimension,
  EvalRunCaseInput,
} from '@hey-hey/contracts/api/models';
import { RunEntityReference } from '@hey-hey/contracts/api/models';
import { normalizeMentionTypeAlias } from '../mentions/mention-type-aliases';
import {
  resolveEvalCaseCoding,
  resolveEvalCaseHandlers,
  resolveEvalCaseInputs,
} from './eval-case-handlers';

export type EvalCaseRecord = {
  id: string;
  name: string;
  sections: ReadonlyArray<{ key: string; materializedMarkdown: string | null }>;
};

const MENTION_PATTERN =
  /@\[([a-z_-]+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|[^\]]*\]/gi;
const LIST_ITEM_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * Items are listed with inline mentions; the first mentioned item is the
 * case's focal item and the rest support it.
 */
function parseItems(
  markdown: string,
): Pick<EvalCaseTarget, 'focalItemId' | 'focalItemType' | 'supportingItemIds'> {
  const mentions = [...markdown.matchAll(MENTION_PATTERN)];
  const ids = [...new Set(mentions.map((match) => match[2]!.toLowerCase()))];
  const focal = mentions[0];
  if (!focal) {
    return { focalItemId: null, supportingItemIds: [] };
  }

  const canonicalType = normalizeMentionTypeAlias(focal[1]!)
    .toUpperCase()
    .replace(/-/g, '_');
  const focalItemType = Object.values(RunEntityReference.EntityTypeEnum).find(
    (type) => type === canonicalType,
  );
  if (!focalItemType) {
    throw new BadRequestException(
      'The focal item mention must use a supported entity family (task for work items).',
    );
  }

  return {
    focalItemId: ids[0]!,
    focalItemType,
    supportingItemIds: ids.slice(1),
  };
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
 * context includes reviewer-only situation and supporting items; the launch
 * sends only the inputs and focal entity to the tested handler. The stored
 * Inputs text is carried verbatim, so mentions in a message reach the tested
 * agent exactly as they did from the former Markdown request.
 */
export function toEvalRunCaseInput(record: EvalCaseRecord): EvalRunCaseInput {
  const section = (key: string): string =>
    record.sections
      .find((candidate) => candidate.key === key)
      ?.materializedMarkdown?.trim() ?? '';

  const situation = section('situation');
  const inputsContent = section('inputs');
  const handler = section('handler');
  const missing = [
    ['situation', situation],
    ['inputs', inputsContent],
    ['handler', handler],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new BadRequestException(
      `Eval case "${record.name}" cannot run: missing ${missing.join(', ')}`,
    );
  }
  const inputs = resolveEvalCaseInputs(record.name, inputsContent);
  const handlers = resolveEvalCaseHandlers(
    record.name,
    handler,
    section('consumerHandler'),
  );

  const coding = resolveEvalCaseCoding(
    record.name,
    handlers.targetHandler,
    section('coding'),
  );

  const items = parseItems(section('items'));
  const expectations = section('expectations');
  return {
    id: randomUUID(),
    evalCaseId: record.id,
    title: record.name,
    target: {
      situation,
      ...items,
      inputs,
      ...handlers,
    },
    grading: {
      ...(expectations ? { expectations } : {}),
      checks: parseChecks(section('checks')),
      rubric: parseRubric(section('rubric')),
    },
    ...(coding ? { coding } : {}),
  };
}

/** A target recorded before Eval Case inputs existed. */
type LegacyEvalCaseTarget = Omit<EvalCaseTarget, 'inputs'> & {
  initiatingRequest: string;
};

function isLegacyEvalCaseTarget(
  target: EvalCaseTarget | LegacyEvalCaseTarget,
): target is LegacyEvalCaseTarget {
  return !('inputs' in target) && 'initiatingRequest' in target;
}

/**
 * Reads a recorded run's case target. A target recorded before inputs existed
 * carries only `initiatingRequest` and reads as a one-message list.
 */
export function readEvalCaseTarget(
  target: EvalCaseTarget | LegacyEvalCaseTarget,
): EvalCaseTarget {
  if (!isLegacyEvalCaseTarget(target)) {
    return target;
  }

  const { initiatingRequest, ...rest } = target;
  return {
    ...rest,
    inputs: { inputs: [{ kind: 'text_message', text: initiatingRequest }] },
  };
}
