import { describe, expect, it } from 'vitest';
import type { JevAnswer, JevInput, JevResult } from '../client';
import { DEFAULT_WORDING, type Focal } from '../scenarios';
import { createSnapshotReader, readCheck, type EntitySource, type GraphSnapshot } from '.';

const uuid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [F, A, B, C] = [1, 2, 3, 4].map(uuid) as [string, string, string, string];

const source = (id: string, text: string): EntitySource => ({
  id,
  kind: 'task',
  title: `Title ${id.slice(-2)}`,
  text,
  edges: [],
  requirements: [],
});

const withImplementation = (name: string): string =>
  `# ${name}\n\n### description\n\nWhat ${name} does.\n\n## Implementation\n\nSecret how-to of ${name}.\n\n### acceptanceCriteria\n\n- ${name} works`;

const snapshot: GraphSnapshot = {
  entities: Object.fromEntries(
    [
      source(F, 'Focal'),
      source(A, withImplementation('Alpha')),
      source(B, withImplementation('Beta')),
      source(C, `# Gamma\n\n${'g'.repeat(400)}`),
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

const reader = () =>
  createSnapshotReader({ id: F, kind: 'task' }, snapshot, [
    { id: A, kind: 'task' },
    { id: B, kind: 'task' },
    { id: C, kind: 'task' },
  ]);

/** Answers `applies` for ids in `applying`, `does_not_apply` for the rest; fails the requests `failing` says. */
const fakeJev = (applying: string[], failing: (input: JevInput) => boolean = () => false) => {
  const requests: JevInput[] = [];
  const client = {
    evaluate: (input: JevInput): Promise<JevResult> => {
      requests.push(input);
      if (failing(input)) {
        return Promise.resolve({
          ok: false,
          failure: { code: 'PROVIDER_ERROR', message: 'too big' },
        } as JevResult);
      }
      const answers: Record<string, JevAnswer> = {};
      for (const id of Object.keys(input.questions)) {
        const applies = applying.includes(id);
        answers[id] = {
          type: 'choice',
          choice: applies ? 'applies' : 'does_not_apply',
          confidence: 1,
          probabilities: { applies: applies ? 0.9 : 0.2, does_not_apply: applies ? 0.1 : 0.8 },
        };
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

const check = (jev: ReturnType<typeof fakeJev>, ids: string[], maxChars?: number) =>
  readCheck({
    client: jev.client,
    model: 'm',
    wording: DEFAULT_WORDING,
    focal,
    ask: 'Make it work',
    ids,
    reader: reader(),
    ...(maxChars === undefined ? {} : { maxChars }),
  });

describe('readCheck', () => {
  it('keeps the entities that apply, in full, and drops the rest with their probability', async () => {
    const jev = fakeJev([A, C]);
    const result = await check(jev, [A, B, C]);
    expect(result.kept.map(({ id }) => id)).toEqual([A, C]);
    expect(result.kept[0]?.text).toBe(withImplementation('Alpha'));
    expect(result.dropped).toEqual([{ id: B, applies: 0.2 }]);
    expect(result.failures).toEqual([]);
    expect(result.usage).toEqual({ requests: 1, inputTokens: 10, outputTokens: 2 });
  });

  it('sends Jev no Implementation section and the focal and ask once in state', async () => {
    const jev = fakeJev([A]);
    await check(jev, [A, B]);
    const [request] = jev.requests;
    const sent = JSON.stringify(request);
    expect(sent).not.toContain('Implementation');
    expect(sent).not.toContain('Secret how-to');
    expect(sent).toContain('What Alpha does.');
    expect(sent).toContain('Alpha works');
    expect(request?.state).toMatchObject({
      ask: { text: 'Make it work' },
      task: { name: 'Focal work' },
    });
  });

  it('judges every entity in one request when they fit, each id once', async () => {
    const jev = fakeJev([]);
    await check(jev, [A, B, C, A]);
    expect(jev.requests).toHaveLength(1);
    expect(Object.keys(jev.requests[0]?.questions ?? {})).toEqual([A, B, C]);
  });

  it('splits into the fewest requests that fit, keeping every entity once', async () => {
    const full = fakeJev([A, B, C]);
    await check(full, [A, B, C]);
    const single =
      JSON.stringify(full.requests[0]?.state).length +
      JSON.stringify(full.requests[0]?.questions).length;

    const split = fakeJev([A, B, C]);
    const result = await check(split, [A, B, C], single - 1);
    expect(split.requests).toHaveLength(2);
    const ids = split.requests.flatMap(({ questions }) => Object.keys(questions));
    expect([...ids].sort()).toEqual([A, B, C].sort());
    expect(result.kept.map(({ id }) => id)).toEqual([A, B, C]);
    expect(result.usage.requests).toBe(2);
  });

  it('keeps every entity of a failed request and reports the failure', async () => {
    const jev = fakeJev([], () => true);
    const result = await check(jev, [A, B]);
    expect(result.kept.map(({ id }) => id)).toEqual([A, B]);
    expect(result.dropped).toEqual([]);
    expect(result.failures).toEqual([
      { ids: [A, B], failure: { code: 'PROVIDER_ERROR', message: 'too big' } },
    ]);
    expect(result.usage.requests).toBe(0);
  });

  it('keeps only the failed request when another succeeds', async () => {
    const jev = fakeJev([], (input) => Object.keys(input.questions).includes(C));
    const result = await check(jev, [A, B, C], 1);
    expect(jev.requests).toHaveLength(3);
    expect(result.kept.map(({ id }) => id)).toEqual([C]);
    expect(result.dropped.map(({ id }) => id).sort()).toEqual([A, B].sort());
    expect(result.failures).toHaveLength(1);
  });

  it('pairs a failure with its own request when more than five requests run', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => uuid(i + 20));
    const many = createSnapshotReader(
      { id: F, kind: 'task' },
      {
        entities: {
          ...snapshot.entities,
          ...Object.fromEntries(ids.map((id) => [id, source(id, `# ${id}`)])),
        },
      },
      ids.map((id) => ({ id, kind: 'task' })),
    );
    const failing = uuid(26);
    const jev = fakeJev(ids, (input) => Object.keys(input.questions).includes(failing));
    const result = await readCheck({
      client: jev.client,
      model: 'm',
      wording: DEFAULT_WORDING,
      focal,
      ask: 'Make it work',
      ids,
      reader: many,
      maxChars: 1,
    });
    expect(jev.requests).toHaveLength(8);
    expect(result.failures).toEqual([
      { ids: [failing], failure: { code: 'PROVIDER_ERROR', message: 'too big' } },
    ]);
    expect(result.kept.map(({ id }) => id)).toEqual(ids);
    expect(result.usage.requests).toBe(7);
  });

  it('surfaces an entity the reader cannot load', async () => {
    await expect(check(fakeJev([]), [uuid(99)])).rejects.toThrow();
  });
});
