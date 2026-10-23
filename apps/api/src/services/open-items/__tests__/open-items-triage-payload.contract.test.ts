import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { dirname, join, resolve } from 'path';
import {
  EntityType,
  type OpenItemsTriageEvidence,
  type OpenItemsTriageItem,
  type OpenItemsTriagePayload,
  type OpenItemsTriageSuggestion,
} from '../../../generated';

// Validates the conversation-owned triage reply straight from the OpenAPI
// source so the exclusivity rules are proven at the contract, not in a copy.
const openapiRoot = execFileSync(
  process.execPath,
  ['scripts/openapi-root.js'],
  { encoding: 'utf8' },
).trim();
const conversationsPath = join(openapiRoot, 'specs/schemas/conversations.yaml');

type Json = unknown;
const documents = new Map<string, Record<string, Json>>();
function documentAt(file: string): Record<string, Json> {
  if (!documents.has(file)) {
    documents.set(
      file,
      load(readFileSync(file, 'utf8')) as Record<string, Json>,
    );
  }
  return documents.get(file)!;
}

function expand(value: Json, file: string): Json {
  if (Array.isArray(value)) return value.map((entry) => expand(entry, file));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, Json>;
  if (typeof record.$ref === 'string') {
    const [relative, pointer = ''] = record.$ref.split('#');
    const target = relative ? resolve(dirname(file), relative) : file;
    const resolved = pointer
      .slice(1)
      .split('/')
      .reduce<Json>(
        (entry, key) => (entry as Record<string, Json>)[key],
        documentAt(target),
      );
    return expand(resolved, target);
  }
  return Object.fromEntries(
    Object.entries(record)
      // OpenAPI-only keywords; oneOf already enforces the arm choice.
      .filter(([key]) => key !== 'discriminator' && !key.startsWith('x-'))
      .map(([key, entry]) => [key, expand(entry, file)]),
  );
}

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validatePayload = ajv.compile(
  expand(
    documentAt(conversationsPath).OpenItemsTriagePayload,
    conversationsPath,
  ) as object,
);

const evidence: OpenItemsTriageEvidence[] = [
  { kind: 'attention', summary: 'Not viewed in 21 days' },
];
const item: OpenItemsTriageItem = {
  entityType: EntityType.Task,
  entityId: '11111111-1111-4111-8111-111111111111',
  title: 'Stale task',
};
const groupId = '22222222-2222-4222-8222-222222222222';
const goalId = '33333333-3333-4333-8333-333333333333';

const suggestions = {
  removeOpenItems: {
    suggestionId: 's-remove',
    kind: 'removeOpenItems',
    items: [item],
    rationale: 'Finished work',
    evidence,
  },
  reopenItems: {
    suggestionId: 's-reopen',
    kind: 'reopenItems',
    items: [item],
    rationale: 'Viewed again this week',
    evidence: [{ kind: 'coAttention', summary: 'Viewed with an open item' }],
  },
  groupOpenItems: {
    suggestionId: 's-group',
    kind: 'groupOpenItems',
    group: { kind: 'newGroup', newGroupName: 'Billing' },
    items: [item],
    rationale: 'Same topic',
    evidence: [{ kind: 'edge', summary: 'Both depend on the billing feature' }],
  },
  trackOnGoal: {
    suggestionId: 's-goal',
    kind: 'trackOnGoal',
    goal: { kind: 'newGoal', newGoal: { name: 'Ship billing' } },
    items: [item],
    rationale: 'Shared outcome',
    evidence: [
      { kind: 'sourceConversation', summary: 'Opened from one thread' },
    ],
  },
  promoteGroupToGoal: {
    suggestionId: 's-promote',
    kind: 'promoteGroupToGoal',
    groupId,
    groupName: 'Billing',
    goalName: 'Ship billing',
    targetDate: '2026-12-01T00:00:00.000Z',
    affectedMembers: [item],
    rationale: 'Group is an outcome',
    evidence: [{ kind: 'title', summary: 'Group name reads as an outcome' }],
  },
} satisfies Record<
  OpenItemsTriageSuggestion['kind'],
  OpenItemsTriageSuggestion
>;

const reply = (...entries: Json[]) => ({
  summary: 'Five suggestions',
  suggestions: entries,
});

describe('Open Items triage reply contract', () => {
  it('accepts a summary with one suggestion of every kind', () => {
    const payload: OpenItemsTriagePayload = {
      summary: 'Five suggestions',
      suggestions: Object.values(suggestions),
    };
    expect(validatePayload(payload)).toBe(true);
  });

  it('accepts existing-group and existing-goal targets', () => {
    expect(
      validatePayload(
        reply(
          {
            ...suggestions.groupOpenItems,
            group: { kind: 'existingGroup', groupId, name: 'Billing' },
          },
          {
            ...suggestions.trackOnGoal,
            goal: { kind: 'existingGoal', goalId, title: 'Ship billing' },
          },
        ),
      ),
    ).toBe(true);
  });

  it.each([
    [
      'both an existing group and a new group name',
      {
        ...suggestions.groupOpenItems,
        group: { kind: 'newGroup', newGroupName: 'Billing', groupId },
      },
    ],
    [
      'both an existing Goal and a new Goal',
      {
        ...suggestions.trackOnGoal,
        goal: {
          kind: 'existingGoal',
          goalId,
          title: 'Ship billing',
          newGoal: { name: 'Other' },
        },
      },
    ],
    ['empty evidence', { ...suggestions.removeOpenItems, evidence: [] }],
    [
      'an unknown evidence kind',
      {
        ...suggestions.removeOpenItems,
        evidence: [{ kind: 'hunch', summary: 'Feels stale' }],
      },
    ],
    ['a blank rationale', { ...suggestions.reopenItems, rationale: '' }],
    ['no affected items', { ...suggestions.removeOpenItems, items: [] }],
    [
      'a promotion without its affected-member snapshot',
      { ...suggestions.promoteGroupToGoal, affectedMembers: [] },
    ],
    [
      'an expected collection revision guard',
      { ...suggestions.removeOpenItems, expectedRevision: 4 },
    ],
    ['an unknown kind', { ...suggestions.removeOpenItems, kind: 'archive' }],
  ])('rejects a suggestion with %s', (_label, suggestion) => {
    expect(validatePayload(reply(suggestion))).toBe(false);
  });

  it('rejects a reply without a summary', () => {
    expect(
      validatePayload({ suggestions: [suggestions.removeOpenItems] }),
    ).toBe(false);
  });

  it('carries no collection revision on the reply', () => {
    expect(
      validatePayload({
        ...reply(suggestions.removeOpenItems),
        collectionRevision: 3,
      }),
    ).toBe(false);
  });
});
