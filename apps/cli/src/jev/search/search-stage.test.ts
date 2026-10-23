import { describe, expect, it } from 'vitest';
import type { JevAnswer, JevInput, JevResult } from '../client';
import { DEFAULT_WORDING, EDGE_RELATIONSHIPS, type Focal } from '../scenarios';
import { createSnapshotReader, type EntitySource, type GraphSnapshot } from '../traversal';
import {
  createMemorySearchExecutor,
  gather,
  refsFromSearchResponse,
  runSearchStage,
  type SearchExecutor,
} from '.';

const uuid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [F, A, B, C, D] = [1, 2, 3, 4, 5].map(uuid) as [string, string, string, string, string];

const source = (id: string, extra: Partial<EntitySource> = {}): EntitySource => ({
  id,
  kind: 'task',
  title: `Title ${id.slice(-2)}`,
  text: `Body of ${id.slice(-2)}`,
  edges: [],
  requirements: [],
  ...extra,
});

const snapshot: GraphSnapshot = {
  entities: Object.fromEntries(
    [
      source(F),
      source(A, {
        edges: [{ id: D, kind: 'task', title: 'Title 05', relationship: 'depends-on' }],
      }),
      source(B),
      source(C),
      source(D),
    ].map((entity) => [entity.id, entity]),
  ),
};

const focal: Focal = {
  kind: 'task',
  name: 'Focal work',
  description: 'Do the thing',
  acceptanceCriteria: 'It is done',
  parent: {
    kind: 'feature', name: 'Parent', description: 'The parent' },
};

const ref = (id: string) => ({ id, kind: 'task', title: `Title ${id}` });

const executor = createMemorySearchExecutor({
  alpha: [ref(A), ref(B), ref(F)],
  beta: [ref(B), ref(C)],
});

/** Read check keeps `applying`; the walk reads and rates every edge as fully relevant. */
const fakeJev = (applying: string[], fail = false) => {
  const requests: JevInput[] = [];
  const client = {
    evaluate: (input: JevInput): Promise<JevResult> => {
      requests.push(input);
      if (fail) {
        return Promise.resolve({
          ok: false,
          failure: { code: 'PROVIDER_ERROR', message: 'down' },
        } as JevResult);
      }
      const answers: Record<string, JevAnswer> = {};
      for (const [id, question] of Object.entries(input.questions)) {
        if (id.startsWith('conflict:')) {
          answers[id] = { type: 'noul', noul: 0 };
        } else if (question.type === 'choice' && question.criteria['applies'] !== undefined) {
          const applies = applying.includes(id);
          answers[id] = {
            type: 'choice',
            choice: applies ? 'applies' : 'does_not_apply',
            confidence: 1,
            probabilities: { applies: applies ? 0.9 : 0.2, does_not_apply: applies ? 0.1 : 0.8 },
          };
        } else if (question.type === 'choice' && question.criteria['governs'] !== undefined) {
          answers[id] = {
            type: 'choice',
            choice: 'governs',
            confidence: 1,
            probabilities: Object.fromEntries(
              EDGE_RELATIONSHIPS.map((name) => [name, name === 'governs' ? 1 : 0]),
            ),
          };
        } else {
          answers[id] = {
            type: 'choice',
            choice: 'implements',
            confidence: 1,
            probabilities: { implements: 1, informs: 0, same_feature_unrelated: 0, other: 0 },
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

const readerFor = (known: readonly { id: string; kind: string }[]) =>
  createSnapshotReader(ref(F), snapshot, known);

const stage = (jev: ReturnType<typeof fakeJev>, search: SearchExecutor = executor) =>
  runSearchStage({
    focalId: F,
    focal,
    ask: 'Make it work',
    searches: [{ query: 'alpha' }, { query: 'beta' }],
    maxResultsPerSearch: 25,
    executor: search,
    readerFor,
    jev: { client: jev.client, model: 'm', wording: DEFAULT_WORDING },
  });

describe('runSearchStage', () => {
  it('runs every search, counts each entity once without the focal, and keeps what Jev keeps', async () => {
    const result = await stage(fakeJev([A, C]));
    expect(result.seeds.map(({ id }) => id)).toEqual([A, C]);
    expect(result.record).toMatchObject({
      searches: [
        { query: 'alpha', hits: 3 },
        { query: 'beta', hits: 2 },
      ],
      surfaced: 3,
      opened: 3,
      kept: 2,
      dropped: [{ id: B, applies: 0.2 }],
      failures: [],
    });
  });

  it('keeps at most the configured number of hits from each search, in the order returned', async () => {
    const result = await runSearchStage({
      focalId: F,
      focal,
      ask: 'Make it work',
      searches: [{ query: 'alpha' }],
      maxResultsPerSearch: 2,
      executor,
      readerFor,
      jev: { client: fakeJev([A, B]).client, model: 'm', wording: DEFAULT_WORDING },
    });
    expect(result.record.searches).toEqual([{ query: 'alpha', hits: 2 }]);
    expect(result.surfacedIds).toEqual([A, B]);
  });

  it('judges results against the original focal and ask, not the search query', async () => {
    const jev = fakeJev([]);
    await stage(jev);
    const [request] = jev.requests;
    expect(request?.state).toMatchObject({
      ask: { text: 'Make it work' },
      task: { name: 'Focal work' },
    });
    expect(JSON.stringify(request)).not.toContain('alpha');
  });

  it('keeps every result when Jev fails and records the failure', async () => {
    const result = await stage(fakeJev([], true));
    expect(result.seeds.map(({ id }) => id)).toEqual([A, B, C]);
    expect(result.record.failures).toHaveLength(1);
    const keep = result.trace.at(-1);
    expect(keep).toMatchObject({
      kind: 'search-keep',
      failures: [{ step: 'keep', next: 'kept-all' }],
    });
    expect(
      keep?.kind === 'search-keep' && keep.judged.every(({ applies }) => applies === null),
    ).toBe(true);
  });

  it('traces each search with its hits, then the read and keep or drop of every result', async () => {
    const result = await stage(fakeJev([A, B]));
    const label = (id: string) => ({ id, type: 'task', title: `Title ${id}` });
    expect(result.trace[0]).toMatchObject({
      kind: 'search',
      outcome: 'hits',
      query: 'alpha',
      hits: [label(A), label(B), label(F)],
    });
    const keep = result.trace.at(-1);
    expect(
      keep?.kind === 'search-keep' && keep.judged.map(({ entity, kept }) => [entity.id, kept]),
    ).toEqual([
      [A, true],
      [B, true],
      [C, false],
    ]);
  });

  it('records a failed search and keeps the results of the others', async () => {
    const failing: SearchExecutor = {
      search: (planned) =>
        planned.query === 'alpha'
          ? Promise.reject(new Error('search down'))
          : executor.search(planned),
    };
    const result = await stage(fakeJev([B, C]), failing);
    expect(result.record.searches).toEqual([
      { query: 'alpha', error: 'search down' },
      { query: 'beta', hits: 2 },
    ]);
    expect(result.record.surfaced).toBe(2);
    expect(result.seeds.map(({ id }) => id)).toEqual([B, C]);
    expect(result.trace[0]).toMatchObject({
      kind: 'search',
      outcome: 'error',
      query: 'alpha',
      error: 'search down',
    });
  });
});

describe('gather', () => {
  it('walks from the kept results and returns seeds then what the walk reached', async () => {
    const jev = fakeJev([A, D]);
    const result = await gather({
      focalId: F,
      focal,
      ask: 'Make it work',
      submission: { searches: [{ query: 'alpha' }] },
      executor,
      readerFor,
      jev: { client: jev.client, model: 'm', wording: DEFAULT_WORDING },
      maxResultsPerSearch: 25,
      limits: [{ max: 5, minScore: 0 }],
    });
    expect(result.search.kept).toBe(1);
    expect(result.entities.map(({ id }) => id)).toEqual([A, D]);
    expect(result.counts.search).toMatchObject({ surfaced: 2, opened: 2, kept: 1 });
    expect(result.counts.hops).toMatchObject([{ surfaced: 1, opened: 1, kept: 1 }]);
    expect(result.counts.usage.requests).toBe(3);
    expect(result.trace.steps.map((step) => step.kind)).toEqual(['search', 'search-keep', 'hop']);
    expect(result.trace.returned.map(({ id, via }) => [id, via])).toEqual([
      [A, 'search'],
      [D, 'hop1'],
    ]);
  });

  it('rejects a submission without searches', async () => {
    const jev = fakeJev([]);
    await expect(
      gather({
        focalId: F,
        focal,
        ask: '',
        submission: { searches: [] },
        executor,
        readerFor,
        jev: { client: jev.client, model: 'm', wording: DEFAULT_WORDING },
        maxResultsPerSearch: 25,
        limits: [],
      }),
    ).rejects.toThrow();
  });
});

describe('refsFromSearchResponse', () => {
  it('names hits by id and lower-cased entity type', () => {
    expect(
      refsFromSearchResponse({
        data: { results: [{ entityId: A, entityType: 'DESIGN_DOC', score: 1 }] },
      }),
    ).toEqual([{ id: A, kind: 'design_doc', title: '' }]);
  });

  it('rejects a hit without an entity id', () => {
    expect(() => refsFromSearchResponse({ data: { results: [{ entityType: 'TASK' }] } })).toThrow();
  });
});
