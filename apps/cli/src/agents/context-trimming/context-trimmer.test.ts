import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JevInput, JevResult } from '../../jev/client';
import type { Focal } from '../../jev/scenarios';
import type { ServerLogger } from '../../server/logger';
import type { JsonValue } from '../platform-mcp-proxy/session';
import { GetContextTrimmer } from './context-trimmer';

const FOCAL_ID = 'focal-task';
const focal: Focal = {
  kind: 'task',
  name: 'Trim context',
  description: 'Trim get_context results',
  acceptanceCriteria: 'Relevant entries stay',
  parent: {
    kind: 'feature',
    name: 'Jev Integration',
    description: 'Jev lets agents judge relevance.',
  },
};

interface Score {
  implements: number;
  informs: number;
}

/** Answers every relevance question from the score keyed by candidate id. */
const answerFrom = (scores: Record<string, Score>) =>
  vi.fn((input: JevInput): Promise<JevResult> => {
    const answers: Extract<JevResult, { ok: true }>['answers'] = {};
    for (const [questionId, question] of Object.entries(input.questions)) {
      const score = scores[questionId];
      if (!score) return Promise.reject(new Error(`No score for ${questionId}`));
      const rest = (1 - score.implements - score.informs) / 2;
      answers[questionId] = {
        type: 'choice',
        choice: 'implements',
        probabilities: {
          implements: score.implements,
          informs: score.informs,
          same_feature_unrelated: rest,
          other: rest,
        },
        confidence: 0.9,
      };
    }
    return Promise.resolve({
      ok: true,
      model: input.model,
      answers,
      usage: { inputTokens: 100, outputTokens: 20 },
      durationMs: 30,
    });
  });

const makeLogger = () => {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return { logger: logger as ServerLogger, ...logger };
};

const related = (name: string, relationship = 'related-to', reasoning?: string) => ({
  entityId: `id-${name}`,
  entityType: 'TASK',
  displayName: name,
  relationship,
  status: 'COMPLETED',
  via: [{ kind: 'edge' }],
  ...(reasoning ? { reasoning } : {}),
});

const contextBody = {
  entityId: 'seed',
  entityType: 'TASK',
  displayName: 'Seed',
  proposals: [{ id: 'p1' }],
  featureHierarchy: [
    {
      id: 'a1',
      name: 'Parent',
      relationshipType: 'structural',
      relationship: 'ancestor',
      description: 'Parent description.',
    },
    {
      id: 's1',
      name: 'Sibling',
      relationshipType: 'structural',
      relationship: 'sibling',
      description: 'Sibling does things. And more.',
    },
  ],
  relatedEntities: [
    related('High', 'depends-on', 'Needed first. Detail follows.'),
    related('Middle', 'mentions', 'Mentioned once. More.'),
    related('Low'),
    related('Hidden-conflict'),
  ],
  agentSessions: [
    { entityId: 'sess', entityType: 'AGENT_SESSION', displayName: 'Session', status: 'COMPLETED' },
  ],
};

const scores: Record<string, Score> = {
  'hierarchy:1': { implements: 0.3, informs: 0.4 },
  'related:0': { implements: 0.9, informs: 0.05 },
  'related:1': { implements: 0.2, informs: 0.45 },
  'related:2': { implements: 0.05, informs: 0.05 },
  'related:3': { implements: 0.0, informs: 0.0 },
  'session:0': { implements: 0.1, informs: 0.1 },
};

const toolResult = (body: unknown, pretty = false): JsonValue => ({
  content: [{ type: 'text', text: JSON.stringify(body, null, pretty ? 2 : undefined) }],
});

const parsedBody = (result: JsonValue): Record<string, unknown> =>
  JSON.parse(textOf(result)) as Record<string, unknown>;

const textOf = (result: JsonValue): string => {
  const content = (result as { content: Array<{ text: string }> }).content;
  return content[0]?.text ?? '';
};

const makeTrimmer = (
  evaluate: ReturnType<typeof answerFrom>,
  overrides: { focalEntityId?: string; ancestorEntityIds?: ReadonlySet<string> } = {},
) => {
  const log = makeLogger();
  const trimmer = new GetContextTrimmer({
    decisionModel: { evaluate },
    focal,
    focalEntityId: overrides.focalEntityId ?? FOCAL_ID,
    ...(overrides.ancestorEntityIds ? { ancestorEntityIds: overrides.ancestorEntityIds } : {}),
    logger: log.logger,
  });
  return { trimmer, ...log };
};

describe('GetContextTrimmer', () => {
  it('narrows get_edges with the shared relevance judgment and keeps focal/ancestor seeds whole', async () => {
    const edge = {
      createdAt: '2026-01-01T00:00:00.000Z',
      direction: 'out',
      edgeType: 'RELATED_TO',
      otherEndpoint: {
        displayName: 'Long title retained for discovery',
        entityId: 'other-entity',
        entityType: 'TASK',
        taskType: 'STANDARD',
      },
      reasoning: 'The complete link rationale.',
    };
    const evaluate = answerFrom({
      'edge:other-seed:0': { implements: 0.02, informs: 0.03 },
    });
    const { trimmer, debug } = makeTrimmer(evaluate, {
      ancestorEntityIds: new Set(['ancestor-seed']),
    });
    const upstream: JsonValue = {
      structuredContent: {
        edgesByEntity: {
          [FOCAL_ID]: [edge],
          'ancestor-seed': [edge],
          'other-seed': [edge],
        },
        omittedEntities: [],
      },
      content: [],
    };

    const narrowed = await trimmer.trimEdgesResult(upstream);
    const structured = (
      narrowed as { structuredContent: { edgesByEntity: Record<string, unknown[]> } }
    ).structuredContent;

    expect(structured.edgesByEntity[FOCAL_ID]).toEqual([edge]);
    expect(structured.edgesByEntity['ancestor-seed']).toEqual([edge]);
    expect(structured.edgesByEntity['other-seed']).toEqual([
      expect.objectContaining({
        otherEndpoint: expect.objectContaining({
          entityId: 'other-entity',
          displayName: 'Long title retained for discovery',
        }),
      }),
    ]);
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate.mock.calls[0]?.[0]).toMatchObject({
      state: {
        edges: {
          'edge:other-seed:0': expect.stringContaining(
            'Long title retained for discovery (TASK STANDARD; RELATED_TO; out): The complete link rationale.',
          ),
        },
      },
    });
    expect(debug).toHaveBeenCalledWith(
      'local.platform_mcp_proxy.get_edges_trim.trimmed',
      expect.objectContaining({
        candidateCount: 1,
        decisionModelDurationMs: 30,
        inputTokens: 100,
        outputTokens: 20,
      }),
    );
  });

  it('returns an unrecognized get_edges result unchanged without judging it', async () => {
    const evaluate = answerFrom({});
    const { trimmer, warn } = makeTrimmer(evaluate);
    const upstream: JsonValue = {
      structuredContent: { edgesByEntity: { seed: [{ wrong: true }] } },
    };

    expect(await trimmer.trimEdgesResult(upstream)).toBe(upstream);
    expect(evaluate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'local.platform_mcp_proxy.get_edges_trim.untrimmed',
      expect.objectContaining({ reason: 'unrecognized_edges_shape' }),
    );
  });

  it('returns the original get_edges result when the Decision Model fails', async () => {
    const evaluate = vi.fn(
      (): Promise<JevResult> =>
        Promise.resolve({ ok: false, failure: { code: 'TIMEOUT', message: 'Timed out.' } }),
    );
    const { trimmer, warn } = makeTrimmer(evaluate);
    const upstream = {
      structuredContent: {
        edgesByEntity: {
          seed: [
            {
              createdAt: '2026-01-01T00:00:00.000Z',
              direction: 'out',
              edgeType: 'RELATED_TO',
              otherEndpoint: {
                displayName: 'Related item',
                entityId: 'related-item',
                entityType: 'TASK',
              },
            },
          ],
        },
      },
    } satisfies JsonValue;

    expect(await trimmer.trimEdgesResult(upstream)).toBe(upstream);
    expect(warn).toHaveBeenCalledWith(
      'local.platform_mcp_proxy.get_edges_trim.untrimmed',
      expect.objectContaining({ reason: 'decision_model_failed', failureCode: 'TIMEOUT' }),
    );
  });

  it('abbreviates entries by tier, orders by relevance, and keeps the rest', async () => {
    const { trimmer, debug } = makeTrimmer(answerFrom(scores));

    const parsed = parsedBody(await trimmer.trimResult(toolResult(contextBody)));

    expect(parsed['proposals']).toEqual([{ id: 'p1' }]);
    expect(parsed['featureHierarchy']).toEqual([
      contextBody.featureHierarchy[0],
      expect.objectContaining({ id: 's1' }),
    ]);
    expect((parsed['featureHierarchy'] as unknown[])[1]).toEqual({
      id: 's1',
      name: 'Sibling',
      relationshipType: 'structural',
      relationship: 'sibling',
      relationToFocal: 'informs',
      summary: 'Sibling does things.',
    });
    expect(parsed['relatedEntities']).toEqual([
      contextBody.relatedEntities[0],
      {
        entityId: 'id-Middle',
        entityType: 'TASK',
        displayName: 'Middle',
        status: 'COMPLETED',
        relationship: 'mentions',
        relationToFocal: 'informs',
        summary: 'Mentioned once.',
      },
      { entityId: 'id-Low', entityType: 'TASK', displayName: 'Low' },
      { entityId: 'id-Hidden-conflict', entityType: 'TASK', displayName: 'Hidden-conflict' },
    ]);
    expect(parsed['agentSessions']).toEqual([
      { entityId: 'sess', entityType: 'AGENT_SESSION', displayName: 'Session' },
    ]);
    expect(parsed['contextTrimmed']).toMatch(/^5 entries were abbreviated/);
    expect(debug).toHaveBeenCalledWith(
      'local.platform_mcp_proxy.get_context_trim.trimmed',
      expect.objectContaining({
        candidateCount: 6,
        tierCounts: { full: 1, short: 2, index: 3 },
        decisionModelDurationMs: 30,
        inputTokens: 100,
        outputTokens: 20,
      }),
    );
  });

  it('never asks Jev about a requirement the focal task fulfils, and keeps it in full', async () => {
    const evaluate = answerFrom({ 'requirement:1': { implements: 0, informs: 0 } });
    const { trimmer } = makeTrimmer(evaluate);
    const body = {
      entityId: 'seed',
      content: {
        requirementsSection: {
          records: [
            {
              id: 'r0',
              statement: 'Fulfilled by the focal task. With detail.',
              fulfilledBy: [{ entityType: 'TASK', entityId: FOCAL_ID, entityTitle: 'Focal' }],
              designedBy: [],
              contracts: [],
            },
            {
              id: 'r1',
              statement: 'Unrelated. Detail.',
              fulfilledBy: [],
              designedBy: [],
              contracts: [],
            },
          ],
        },
      },
    };

    const parsed = parsedBody(await trimmer.trimResult(toolResult(body)));

    const [{ questions }] = evaluate.mock.calls[0] as [JevInput];
    expect(Object.keys(questions).sort()).toEqual(['requirement:1']);
    const { content } = parsed as { content: { requirementsSection: { records: unknown[] } } };
    expect(content.requirementsSection.records).toEqual([
      body.content.requirementsSection.records[0],
      { id: 'r1', statement: 'Unrelated.' },
    ]);
  });

  it('leaves the focal entity’s own requirements and its other fields alone', async () => {
    const evaluate = answerFrom({});
    const { trimmer } = makeTrimmer(evaluate);
    const upstream = toolResult({
      entityId: FOCAL_ID,
      content: {
        requirementsSection: {
          records: [{ id: 'r0', statement: 'Own.', fulfilledBy: [] }],
        },
      },
    });

    expect(await trimmer.trimResult(upstream)).toBe(upstream);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('evaluates each call directly, including repeated and changed results', async () => {
    const evaluate = answerFrom(scores);
    const { trimmer, debug } = makeTrimmer(evaluate);
    await trimmer.trimResult(toolResult(contextBody));
    await trimmer.trimResult(toolResult(contextBody));
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(debug).toHaveBeenLastCalledWith(
      'local.platform_mcp_proxy.get_context_trim.trimmed',
      expect.objectContaining({ inputTokens: 100, outputTokens: 20 }),
    );

    await trimmer.trimResult(
      toolResult({ ...contextBody, relatedEntities: [related('High', 'depends-on', 'Edited.')] }),
    );
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it('returns the upstream result and logs the cause when Jev fails', async () => {
    const evaluate = vi.fn(
      (): Promise<JevResult> =>
        Promise.resolve({
          ok: false,
          failure: { code: 'TIMEOUT', message: 'Jev evaluation timed out.' },
        }),
    );
    const { trimmer, warn } = makeTrimmer(evaluate);
    const upstream = toolResult(contextBody);

    expect(await trimmer.trimResult(upstream)).toBe(upstream);
    expect(warn).toHaveBeenCalledWith('local.platform_mcp_proxy.get_context_trim.untrimmed', {
      reason: 'decision_model_failed',
      failureCode: 'TIMEOUT',
    });
  });

  it('evaluates again after a failure', async () => {
    const evaluate = vi
      .fn<(input: JevInput) => Promise<JevResult>>()
      .mockResolvedValueOnce({ ok: false, failure: { code: 'PROVIDER_ERROR', message: 'x' } })
      .mockImplementation(answerFrom(scores));
    const { trimmer } = makeTrimmer(evaluate);

    await trimmer.trimResult(toolResult(contextBody));
    await trimmer.trimResult(toolResult(contextBody));

    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'an error result',
      { ...(toolResult(contextBody) as object), isError: true },
      'upstream_error_result',
    ],
    [
      'a structured twin',
      { ...(toolResult(contextBody) as object), structuredContent: {} },
      'structured_content_present',
    ],
    [
      'two content blocks',
      {
        content: [
          { type: 'text', text: '{}' },
          { type: 'text', text: '{}' },
        ],
      },
      'not_a_single_text_block',
    ],
    ['non-JSON text', { content: [{ type: 'text', text: 'oops' }] }, 'result_text_not_json'],
    ['a batch of seeds', toolResult({ results: [contextBody] }), 'unrecognized_context_shape'],
    [
      'an unknown hierarchy relationship',
      toolResult({
        ...contextBody,
        featureHierarchy: [
          { id: 'x', name: 'X', relationshipType: 'structural', relationship: 'cousin' },
        ],
      }),
      'unrecognized_context_shape',
    ],
    ['no candidates', toolResult({ entityId: 'seed' }), 'no_candidates'],
  ])('returns %s unchanged', async (_name, upstream, reason) => {
    const evaluate = answerFrom(scores);
    const { trimmer, warn } = makeTrimmer(evaluate);

    expect(await trimmer.trimResult(upstream)).toBe(upstream);
    expect(evaluate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'local.platform_mcp_proxy.get_context_trim.untrimmed',
      expect.objectContaining({ reason }),
    );
  });

  it('keeps pretty-printed results pretty-printed and does not log entity text', async () => {
    const { trimmer, debug, warn, error } = makeTrimmer(answerFrom(scores));

    const result = await trimmer.trimResult(toolResult(contextBody, true));

    expect(textOf(result)).toContain('\n  "entityId"');
    const logged = JSON.stringify([...debug.mock.calls, ...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain('Sibling does things');
    expect(logged).not.toContain('Needed first');
  });

  describe('development trace', () => {
    const dirs: string[] = [];
    afterEach(async () => {
      await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    });

    const tracedTrimmer = async (attemptLogDir: string | null, evaluate = answerFrom(scores)) => {
      const log = makeLogger();
      const trimmer = new GetContextTrimmer({
        decisionModel: { evaluate },
        focal,
        focalEntityId: FOCAL_ID,
        logger: log.logger,
        attemptLogDir,
      });
      return { trimmer, evaluate, ...log };
    };
    const newDir = async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'get-context-log-'));
      dirs.push(dir);
      return dir;
    };

    it('writes one file per narrowed call with sizes, tiers and entry decisions', async () => {
      const dir = await newDir();
      const { trimmer } = await tracedTrimmer(dir);

      const result = await trimmer.trimResult(toolResult(contextBody));
      const files = await readdir(dir);

      expect(files).toHaveLength(1);
      const record = JSON.parse(await readFile(path.join(dir, files[0] ?? ''), 'utf8')) as {
        outcome: string;
        focalEntityId: string;
        rawResultChars: number;
        narrowedResultChars: number;
        tierCounts: unknown;
        inputTokens: number;
        costUsd: number;
        jevCalls: Array<{ input: { questions: Record<string, unknown> } }>;
        entries: Array<{ tier: string; judgedByDecisionModel: boolean; text: string }>;
      };
      expect(record.outcome).toBe('narrowed');
      expect(record.focalEntityId).toBe(FOCAL_ID);
      expect(record.rawResultChars).toBe(JSON.stringify(contextBody).length);
      expect(record.narrowedResultChars).toBe(textOf(result).length);
      expect(record.tierCounts).toEqual({ full: 1, short: 2, index: 3 });
      expect(record.inputTokens).toBe(100);
      expect(record.costUsd).toBeCloseTo(0.0000042, 10);
      expect(Object.keys(record)[2]).toBe('costUsd');
      expect(record.jevCalls).toHaveLength(1);
      expect(Object.keys(record.jevCalls[0]?.input.questions ?? {})).not.toContainEqual(
        expect.stringContaining('conflict'),
      );
      expect(record.entries.every((entry) => entry.judgedByDecisionModel)).toBe(true);
      expect(record.entries.some((entry) => entry.text.includes('Needed first'))).toBe(true);
    });

    it('judges and writes separately for repeated identical calls', async () => {
      const dir = await newDir();
      const { trimmer, evaluate } = await tracedTrimmer(dir);

      await trimmer.trimResult(toolResult(contextBody));
      await trimmer.trimResult(toolResult(contextBody));

      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(await readdir(dir)).toHaveLength(2);
    });

    it('writes why a call passed through unchanged, and nothing when no directory is set', async () => {
      const dir = await newDir();
      const failing = vi.fn(
        (): Promise<JevResult> =>
          Promise.resolve({ ok: false, failure: { code: 'TIMEOUT', message: 'slow' } }),
      );
      const { trimmer } = await tracedTrimmer(dir, failing as ReturnType<typeof answerFrom>);
      const upstream = toolResult(contextBody);
      expect(await trimmer.trimResult(upstream)).toBe(upstream);
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      const record: unknown = JSON.parse(await readFile(path.join(dir, files[0] ?? ''), 'utf8'));
      expect(record).toMatchObject({
        outcome: 'passed_through',
        focalEntityId: FOCAL_ID,
        reason: 'decision_model_failed',
        fields: { failureCode: 'TIMEOUT' },
        jevCalls: [expect.anything()],
      });

      const { trimmer: untraced } = await tracedTrimmer(null);
      await expect(untraced.trimResult(toolResult(contextBody))).resolves.toBeDefined();
    });

    it('returns the narrowed result with a safe warning when the trace cannot be written', async () => {
      const dir = await newDir();
      const blocker = path.join(dir, 'file');
      await writeFile(blocker, 'x');
      const { trimmer, warn, debug } = await tracedTrimmer(path.join(blocker, 'sub'));

      const parsed = parsedBody(await trimmer.trimResult(toolResult(contextBody)));

      expect(parsed['contextTrimmed']).toMatch(/entries were abbreviated/);
      expect(warn).toHaveBeenCalledWith(
        'local.platform_mcp_proxy.get_context_trim.attempt_log_failed',
        { errorName: expect.any(String) },
      );
      const logged = JSON.stringify([...debug.mock.calls, ...warn.mock.calls]);
      expect(logged).not.toContain('Needed first');
    });
  });
});
