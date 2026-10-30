import { describe, expect, it } from 'vitest';
import type { JevAnswer, JevInput, JevResult } from '../client';
import {
  buildQuestions,
  buildState,
  DEFAULT_WORDING,
  EDGE_RELATIONSHIPS,
  READ_CHECK,
  type Candidate,
  type Focal,
} from '../scenarios';
import {
  candidatesOf,
  createSnapshotReader,
  sourceFromContext,
  sourceFromHint,
  sourceFromMessage,
  walk,
  type EntitySource,
  type GraphSnapshot,
  type LevelLimit,
} from '.';
import {
  JEV_MAX_CONCURRENT_REQUESTS,
  JEV_REQUEST_MAX_CANDIDATES,
  JEV_REQUEST_MAX_CHARS,
  mapConcurrently,
  packRequests,
} from './pack-requests';

const uuid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [F, A, B, C, D, E, G, H] = [1, 2, 3, 4, 5, 6, 7, 8].map(uuid) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

const source = (id: string, extra: Partial<EntitySource> = {}): EntitySource => ({
  id,
  kind: 'task',
  title: `Title ${id.slice(-2)}`,
  text: `Body of ${id.slice(-2)}`,
  edges: [],
  requirements: [],
  ...extra,
});
const edge = (id: string, relationship = 'depends-on') => ({
  id,
  kind: 'task',
  title: `Title ${id.slice(-2)}`,
  relationship,
});

const snapshotOf = (...sources: EntitySource[]): GraphSnapshot => ({
  entities: Object.fromEntries(sources.map((s) => [s.id, s])),
});

const focal: Focal = {
  kind: 'task',
  name: 'Focal work',
  description: 'Do the thing',
  acceptanceCriteria: 'It is done',
  parent: {
    kind: 'feature',
    name: 'Parent',
    description: 'The parent',
  },
};

/** Scores by entity id; every other entity gets 0 / does not apply. */
const fakeJev = (scores: { readMore?: Record<string, number>; keep?: string[] }) => {
  const requests: JevInput[] = [];
  const client = {
    evaluate: (input: JevInput): Promise<JevResult> => {
      requests.push(input);
      const answers: Record<string, JevAnswer> = {};
      for (const [id, question] of Object.entries(input.questions)) {
        if (question.type === 'choice' && question.criteria['applies'] !== undefined) {
          const applies = scores.keep?.includes(id) ?? false;
          answers[id] = {
            type: 'choice',
            choice: applies ? 'applies' : 'does_not_apply',
            confidence: 1,
            probabilities: { applies: applies ? 0.9 : 0.2, does_not_apply: applies ? 0.1 : 0.8 },
          };
        } else {
          const readMore = scores.readMore?.[id] ?? 0;
          answers[id] = {
            type: 'choice',
            choice: 'governs',
            confidence: 1,
            probabilities: Object.fromEntries(
              EDGE_RELATIONSHIPS.map((name) => [
                name,
                name === 'governs' ? readMore : name === 'unrelated' ? 1 - readMore : 0,
              ]),
            ),
          };
        }
      }
      return Promise.resolve({
        ok: true,
        model: input.model,
        answers,
        usage: { inputTokens: 10, outputTokens: 2 },
        durationMs: 1,
      });
    },
  };
  return { client, requests };
};

const run = (
  snapshot: GraphSnapshot,
  jev: ReturnType<typeof fakeJev>,
  limits: LevelLimit[],
  ask = 'Make it work',
) =>
  walk({
    focalId: F,
    focal,
    ask,
    reader: createSnapshotReader({ id: F, kind: 'task' }, snapshot),
    jev: { client: jev.client, model: 'm', wording: DEFAULT_WORDING },
    limits,
  });

describe('candidatesOf', () => {
  it('collects edges, requirement citations and content mentions once each', () => {
    const found = candidatesOf(
      source(F, {
        text: `See @[task:${C}|Mentioned task] and @[task:${A}|Also linked] and @[task:${F}|Itself]`,
        edges: [edge(A, 'depends-on'), edge(B, 'related-to')],
        requirements: [
          {
            statement: 'Users can do X. More words.',
            fulfilledBy: [{ id: D, kind: 'task', title: 'Fulfiller' }],
            designedBy: [{ id: E, kind: 'design_doc', title: 'Designer' }],
            contracts: [{ id: G, kind: 'contract', title: 'Promise' }],
          },
        ],
      }),
    );
    expect(found.map(({ candidate }) => [candidate.id, candidate.kind])).toEqual([
      [A, 'linked'],
      [B, 'linked'],
      [D, 'mentioned'],
      [E, 'mentioned'],
      [G, 'mentioned'],
      [C, 'mentioned'],
    ]);
    expect(found[0]?.candidate.text).toBe(`depends-on · Title 02 (task)`);
    expect(found[2]?.candidate.text).toBe(
      'fulfills requirement · Fulfiller (task) · "Users can do X." of Title 01',
    );
    expect(found[3]?.ref).toEqual({ id: E, kind: 'design_doc', title: 'Designer' });
  });
});

describe('walk', () => {
  const graph = snapshotOf(
    source(F, { edges: [edge(A), edge(B), edge(C), edge(D)] }),
    source(A, { text: `Mentions @[task:${E}|E]` }),
    source(B, {
      requirements: [
        {
          statement: 'S.',
          fulfilledBy: [{ id: G, kind: 'task', title: 'G' }],
          designedBy: [],
          contracts: [],
        },
      ],
    }),
    source(C),
    source(D),
    source(E, { edges: [edge(H)] }),
    source(G),
    source(H),
  );

  it('takes the best candidates per level and goes deeper only through what Jev kept', async () => {
    const jev = fakeJev({
      readMore: { [A]: 0.9, [B]: 0.8, [C]: 0.1, [D]: 0.05, [E]: 0.7, [G]: 0.6 },
      keep: [A, E],
    });
    const result = await run(graph, jev, [
      { max: 2, minScore: 0 },
      { max: 3, minScore: 0.65 },
    ]);
    // B was read but dropped, so G is never a candidate; only E (from A) is, and it clears 0.65.
    expect(result.entities.map(({ id, level }) => ({ id, level }))).toEqual([
      { id: A, level: 1 },
      { id: E, level: 2 },
    ]);
    expect(
      result.levels.map(({ level, surfaced, opened, kept }) => ({ level, surfaced, opened, kept })),
    ).toEqual([
      { level: 1, surfaced: [A, B, C, D], opened: [A, B], kept: [A] },
      { level: 2, surfaced: [E], opened: [E], kept: [E] },
    ]);
    expect(result.failures).toEqual([]);
    // Each level scores once and runs one keep-or-drop check.
    expect(result.usage).toEqual({ requests: 4, inputTokens: 40, outputTokens: 8 });
    expect(result.levels.map(({ usage }) => usage.requests)).toEqual([2, 2]);

    const [hop1, hop2] = result.hops;
    const label = (id: string) => ({ id, type: 'task', title: `Title ${id.slice(-2)}` });
    expect(hop1?.candidates).toEqual([
      { entity: label(A), from: F, score: 0.9, picked: true },
      { entity: label(B), from: F, score: 0.8, picked: true },
      { entity: label(C), from: F, score: 0.1, picked: false },
      { entity: label(D), from: F, score: 0.05, picked: false },
    ]);
    expect(hop1?.read.map(({ entity, error }) => [entity.id, error])).toEqual([
      [A, null],
      [B, null],
    ]);
    expect(hop1?.judged.map(({ entity, kept }) => [entity.id, kept])).toEqual([
      [A, true],
      [B, false],
    ]);
    expect(hop1).toMatchObject({ level: 1, failures: [], usage: result.levels[0]?.usage });
    // E is reached by a mention, so it carries the title the mention gave it.
    expect(hop2?.candidates).toEqual([
      { entity: { id: E, type: 'task', title: 'E' }, from: A, score: 0.7, picked: true },
    ]);
    expect(result.expansionFailures).toEqual([]);
  });

  it('scores a wide frontier in requests within the size and candidate limits', async () => {
    const ids = Array.from({ length: 120 }, (_, n) => uuid(100 + n));
    const wide = snapshotOf(
      source(F, { edges: ids.map((id) => edge(id)) }),
      ...ids.map((id) => source(id)),
    );
    const jev = fakeJev({ readMore: Object.fromEntries(ids.map((id) => [id, 0.5])) });
    const result = await run(wide, jev, [{ max: 3, minScore: 0 }]);
    const scoring = jev.requests.filter(({ questions }) =>
      Object.values(questions).every(
        (question) => question.type !== 'choice' || question.criteria['applies'] === undefined,
      ),
    );
    for (const { state, questions } of scoring) {
      expect(Object.keys(questions).length).toBeLessThanOrEqual(JEV_REQUEST_MAX_CANDIDATES);
      expect(JSON.stringify(state).length + JSON.stringify(questions).length).toBeLessThanOrEqual(
        JEV_REQUEST_MAX_CHARS,
      );
    }
    expect(scoring.flatMap(({ questions }) => Object.keys(questions)).sort()).toEqual(
      [...ids].sort(),
    );
    expect(result.hops[0]?.candidates).toHaveLength(120);
    expect(result.failures).toEqual([]);
  });

  it('stops when no candidate clears a later level, and takes its best at the first', async () => {
    const jev = fakeJev({ readMore: { [A]: 0.01 }, keep: [A] });
    const result = await run(graph, jev, [
      { max: 1, minScore: 0 },
      { max: 5, minScore: 0.5 },
      { max: 5, minScore: 0.5 },
    ]);
    expect(result.entities.map(({ id, level }) => [id, level])).toEqual([[A, 1]]);
    // level 1 scores + checks; level 2 scores E (below cutoff) and reads nothing: no third level.
    expect(jev.requests).toHaveLength(3);
  });

  it('judges every request against the original focal and the ask', async () => {
    const jev = fakeJev({ readMore: { [A]: 1 }, keep: [A] });
    await run(graph, jev, [
      { max: 1, minScore: 0 },
      { max: 1, minScore: 0 },
    ]);
    for (const { state } of jev.requests) {
      expect(state).toMatchObject({
        task: { name: 'Focal work', description: 'Do the thing' },
        ask: { text: 'Make it work' },
      });
    }
  });

  it('checks what it read without its Implementation section but still follows mentions inside it', async () => {
    const full = `### description\n\nPlain.\n\n## Implementation\n\nUses @[task:${E}|E] internally.`;
    const implementationGraph = snapshotOf(
      source(F, { edges: [edge(A)] }),
      source(A, { text: full }),
      source(E),
    );
    const jev = fakeJev({ readMore: { [A]: 1, [E]: 1 }, keep: [A, E] });
    const result = await run(implementationGraph, jev, [
      { max: 1, minScore: 0 },
      { max: 1, minScore: 0 },
    ]);
    expect(result.entities.map(({ id, text }) => [id, text])).toEqual([
      [A, '### description\n\nPlain.'],
      [E, 'Body of 06'],
    ]);
    const checkOfA = jev.requests.find(({ state }) => JSON.stringify(state).includes('Plain.'));
    expect(JSON.stringify(checkOfA?.state)).not.toContain('Implementation');
    expect(JSON.stringify(checkOfA?.state)).not.toContain('internally');
  });

  it('never rereads the focal or an entity already loaded', async () => {
    const cycle = snapshotOf(
      source(F, { edges: [edge(A)] }),
      source(A, { edges: [edge(F), edge(A)], text: `@[task:${F}|F]` }),
    );
    const jev = fakeJev({ readMore: { [A]: 1 }, keep: [A] });
    const result = await run(cycle, jev, [
      { max: 1, minScore: 0 },
      { max: 1, minScore: 0 },
    ]);
    expect(result.entities.map(({ id }) => id)).toEqual([A]);
  });

  it('seeds are not judged again and their edges join the first frontier', async () => {
    const jev = fakeJev({ readMore: { [E]: 1 }, keep: [E] });
    const result = await walk({
      focalId: F,
      focal,
      ask: 'x',
      reader: createSnapshotReader({ id: F, kind: 'task' }, graph, [{ id: A, kind: 'task' }]),
      seedIds: [A],
      jev: { client: jev.client, model: 'm', wording: DEFAULT_WORDING },
      limits: [{ max: 5, minScore: 0.5 }],
    });
    expect(result.entities.map(({ id }) => id)).toEqual([E]);
  });

  it('keeps gathered entities and records the failure when scoring fails at a later level', async () => {
    const real = fakeJev({ readMore: { [A]: 1 }, keep: [A] });
    let scoring = 0;
    const client = {
      evaluate: (input: JevInput): Promise<JevResult> => {
        const isCheck = Object.values(input.questions).some(
          (question) => question.type === 'choice' && question.criteria['applies'] !== undefined,
        );
        if (!isCheck && (scoring += 1) === 2) {
          return Promise.resolve({ ok: false, failure: { code: 'TIMEOUT', message: 'slow' } });
        }
        return real.client.evaluate(input);
      },
    };
    const result = await walk({
      focalId: F,
      focal,
      ask: 'x',
      reader: createSnapshotReader({ id: F, kind: 'task' }, graph),
      jev: { client, model: 'm', wording: DEFAULT_WORDING },
      limits: [
        { max: 1, minScore: 0 },
        { max: 1, minScore: 0 },
      ],
    });
    expect(result.entities.map(({ id }) => id)).toEqual([A]);
    expect(result.failures).toEqual([
      {
        kind: 'jev',
        level: 2,
        step: 'score',
        ids: [E],
        failure: { code: 'TIMEOUT', message: 'slow' },
      },
    ]);
    expect(result.hops[1]).toMatchObject({
      level: 2,
      candidates: [{ entity: { id: E }, from: A, score: null, picked: false }],
      failures: [{ step: 'score', code: 'TIMEOUT', next: 'walk-ended', entities: [{ id: E }] }],
    });
  });

  it('keeps every entity of a failed keep-or-drop request and records the failure', async () => {
    const real = fakeJev({ readMore: { [A]: 1, [B]: 0.9 } });
    const client = {
      evaluate: (input: JevInput): Promise<JevResult> =>
        Object.values(input.questions).some(
          (question) => question.type === 'choice' && question.criteria['applies'] !== undefined,
        )
          ? Promise.resolve({ ok: false, failure: { code: 'TIMEOUT', message: 'slow' } })
          : real.client.evaluate(input),
    };
    const result = await walk({
      focalId: F,
      focal,
      ask: 'x',
      reader: createSnapshotReader({ id: F, kind: 'task' }, graph),
      jev: { client, model: 'm', wording: DEFAULT_WORDING },
      limits: [{ max: 2, minScore: 0 }],
    });
    expect(result.entities.map(({ id }) => id)).toEqual([A, B]);
    expect(result.failures).toEqual([
      {
        kind: 'jev',
        level: 1,
        step: 'keep',
        ids: [A, B],
        failure: { code: 'TIMEOUT', message: 'slow' },
      },
    ]);
    expect(result.hops[0]?.judged).toMatchObject([
      { entity: { id: A }, applies: null, kept: true },
      { entity: { id: B }, applies: null, kept: true },
    ]);
    expect(result.hops[0]?.failures).toMatchObject([
      { step: 'keep', code: 'TIMEOUT', next: 'kept-all', entities: [{ id: A }, { id: B }] },
    ]);
  });

  it('records an unreadable entity, skips it and carries on with the rest', async () => {
    const jev = fakeJev({ readMore: { [A]: 1, [B]: 0.9 }, keep: [A] });
    const result = await run(snapshotOf(source(F, { edges: [edge(A), edge(B)] }), source(A)), jev, [
      { max: 2, minScore: 0 },
    ]);
    expect(result.entities.map(({ id }) => id)).toEqual([A]);
    expect(result.failures).toEqual([
      { kind: 'read', level: 1, id: B, error: `Snapshot has no entity ${B}.` },
    ]);
    expect(result.levels[0]).toMatchObject({ surfaced: [A, B], opened: [A], kept: [A] });
    expect(result.hops[0]?.read).toEqual([
      {
        entity: { id: B, type: 'task', title: `Title ${B.slice(-2)}` },
        error: `Snapshot has no entity ${B}.`,
      },
      { entity: { id: A, type: 'task', title: `Title ${A.slice(-2)}` }, error: null },
    ]);
  });
});

describe('sourceFromContext', () => {
  it('turns a platform context into the same source a snapshot stores', () => {
    const result = sourceFromContext({
      entityId: F,
      entityType: 'TASK',
      taskType: 'FEATURE',
      displayName: 'A feature',
      relatedEntities: [
        {
          entityId: A,
          entityType: 'TASK',
          taskType: 'STANDARD',
          displayName: 'Linked',
          relationship: 'influences',
          reasoning: 'Because.',
        },
      ],
      content: {
        sections: { description: 'Desc @[task:' + C + '|C]' },
        requirementsSection: {
          records: [
            {
              id: 'r1',
              statement: 'Req.',
              fulfilledBy: [{ entityType: 'TASK', entityId: D, entityTitle: 'Fulfiller' }],
              designedBy: [{ entityType: 'DESIGN_DOC', entityId: E, entityTitle: 'Designer' }],
              contracts: [],
            },
          ],
        },
      },
    });
    expect(result).toEqual({
      id: F,
      kind: 'feature',
      title: 'A feature',
      text: `# A feature\n\n### description\n\nDesc @[task:${C}|C]\n\n### requirements\n\n- Req.`,
      edges: [
        {
          id: A,
          kind: 'standard',
          title: 'Linked',
          relationship: 'influences',
          reasoning: 'Because.',
        },
      ],
      requirements: [
        {
          statement: 'Req.',
          fulfilledBy: [{ id: D, kind: 'task', title: 'Fulfiller' }],
          designedBy: [{ id: E, kind: 'design_doc', title: 'Designer' }],
          contracts: [],
        },
      ],
    });
  });

  it('rejects a context of another shape', () => {
    expect(() => sourceFromContext({ entityId: F })).toThrow();
  });
});

describe('sourceFromMessage and sourceFromHint', () => {
  it('reads a user message as what the user wrote, with no links', () => {
    const source = sourceFromMessage({
      id: A,
      type: 'USER',
      data: { comment: 'Keep hops capped.\nSecond line.' },
    } as Parameters<typeof sourceFromMessage>[0]);
    expect(source).toMatchObject({
      id: A,
      kind: 'message',
      title: 'Keep hops capped.',
      edges: [],
      requirements: [],
    });
    expect(source.text).toBe('# Keep hops capped.\n\nKeep hops capped.\nSecond line.');
  });

  it('reads a hint as its feature, description and hint text', () => {
    const source = sourceFromHint({
      id: B,
      featureName: 'Search stage',
      description: 'Dedupe before reading.',
      hint: 'Use packRequests.',
    } as Parameters<typeof sourceFromHint>[0]);
    expect(source).toMatchObject({ id: B, kind: 'implementation_hint', title: 'Search stage' });
    expect(source.text).toBe('# Search stage\n\nDedupe before reading.\n\nUse packRequests.');
  });
});

describe('packRequests', () => {
  const sizeOf = (candidates: Candidate[]): number =>
    JSON.stringify(buildState(READ_CHECK, focal, candidates, DEFAULT_WORDING)).length +
    JSON.stringify(buildQuestions(READ_CHECK, focal, candidates, DEFAULT_WORDING)).length;
  const candidate = (n: number, chars: number): Candidate => ({
    id: uuid(n),
    kind: 'entity',
    text: 'x'.repeat(chars),
  });

  it('keeps every request under the 80,000-character cap', () => {
    expect(JEV_REQUEST_MAX_CHARS).toBe(80_000);
    const candidates = Array.from({ length: 25 }, (_, i) => candidate(i + 10, 9_000));
    const requests = packRequests(
      READ_CHECK,
      focal,
      candidates,
      DEFAULT_WORDING,
      JEV_REQUEST_MAX_CHARS,
    );
    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests)
      expect(sizeOf(request)).toBeLessThanOrEqual(JEV_REQUEST_MAX_CHARS);
    expect(
      requests
        .flat()
        .map(({ id }) => id)
        .sort(),
    ).toEqual(candidates.map(({ id }) => id).sort());
  });

  it('keeps every request within the 50-candidate limit', () => {
    const candidates = Array.from({ length: 120 }, (_, i) => candidate(i + 10, 10));
    const requests = packRequests(READ_CHECK, focal, candidates, DEFAULT_WORDING, 1_000_000);
    expect(JEV_REQUEST_MAX_CANDIDATES).toBe(50);
    expect(requests.map((request) => request.length)).toEqual([50, 50, 20]);
  });
});

describe('mapConcurrently', () => {
  it('runs at most five at once, starts the next as one finishes, and keeps input order', async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const releases: (() => void)[] = [];
    let inFlight = 0;
    let peak = 0;
    const done = mapConcurrently(items, JEV_MAX_CONCURRENT_REQUESTS, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight -= 1;
      return item * 10;
    });
    await Promise.resolve();
    expect(releases).toHaveLength(5);
    // Finish out of order: the last started first.
    releases[4]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releases).toHaveLength(6);
    while (releases.length < items.length || inFlight > 0) {
      releases
        .slice()
        .reverse()
        .forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(await done).toEqual(items.map((item) => item * 10));
    expect(peak).toBe(JEV_MAX_CONCURRENT_REQUESTS);
  });

  it('propagates a rejection', async () => {
    await expect(
      mapConcurrently([1, 2, 3, 4, 5, 6, 7], 5, (item) =>
        item === 6 ? Promise.reject(new Error('boom')) : Promise.resolve(item),
      ),
    ).rejects.toThrow('boom');
  });
});
