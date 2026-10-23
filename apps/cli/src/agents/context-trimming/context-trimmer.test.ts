import { describe, expect, it, vi } from 'vitest';
import type { JevInput, JevResult } from '../../jev/client';
import type { Focal } from '../../jev/scenarios';
import type { ServerLogger } from '../../server/logger';
import type { JsonValue } from '../platform-mcp-proxy/session';
import { GetContextTrimmer, type JevResponseCache } from './context-trimmer';

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
  conflict: number;
}

/** Answers every relevance and conflict question from the score keyed by candidate id. */
const answerFrom = (scores: Record<string, Score>) =>
  vi.fn((input: JevInput): Promise<JevResult> => {
    const answers: Extract<JevResult, { ok: true }>['answers'] = {};
    for (const [questionId, question] of Object.entries(input.questions)) {
      if (question.type === 'noul') {
        answers[questionId] = {
          type: 'noul',
          noul: scores[questionId.replace('conflict:', '')]?.conflict ?? 0,
        };
        continue;
      }
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
  'hierarchy:1': { implements: 0.3, informs: 0.4, conflict: 0.1 },
  'related:0': { implements: 0.9, informs: 0.05, conflict: 0.1 },
  'related:1': { implements: 0.2, informs: 0.45, conflict: 0.1 },
  'related:2': { implements: 0.05, informs: 0.05, conflict: 0.1 },
  'related:3': { implements: 0.0, informs: 0.0, conflict: 0.8 },
  'session:0': { implements: 0.1, informs: 0.1, conflict: 0.1 },
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
  overrides: { cache?: JevResponseCache; focalEntityId?: string } = {},
) => {
  const log = makeLogger();
  const trimmer = new GetContextTrimmer({
    client: { evaluate },
    focal,
    focalEntityId: overrides.focalEntityId ?? FOCAL_ID,
    cache: overrides.cache ?? new Map<string, Extract<JevResult, { ok: true }>>(),
    logger: log.logger,
  });
  return { trimmer, ...log };
};

describe('GetContextTrimmer', () => {
  it('abbreviates entries by tier, forces conflicts to full, orders by relevance, and keeps the rest', async () => {
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
      contextBody.relatedEntities[3],
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
    ]);
    expect(parsed['agentSessions']).toEqual([
      { entityId: 'sess', entityType: 'AGENT_SESSION', displayName: 'Session' },
    ]);
    expect(parsed['contextTrimmed']).toMatch(/^4 entries were abbreviated/);
    expect(debug).toHaveBeenCalledWith(
      'local.platform_mcp_proxy.get_context_trim.trimmed',
      expect.objectContaining({
        candidateCount: 6,
        tierCounts: { full: 2, short: 2, index: 2 },
        inputTokens: 100,
        outputTokens: 20,
        cacheHit: false,
      }),
    );
  });

  it('never asks Jev about a requirement the focal task fulfils, and keeps it in full', async () => {
    const evaluate = answerFrom({ 'requirement:1': { implements: 0, informs: 0, conflict: 0 } });
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
    expect(Object.keys(questions).sort()).toEqual(['conflict:requirement:1', 'requirement:1']);
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

  it('reuses earlier answers for an identical call and asks again when an entry changes', async () => {
    const evaluate = answerFrom(scores);
    const cache: JevResponseCache = new Map();
    const first = makeTrimmer(evaluate, { cache });
    await first.trimmer.trimResult(toolResult(contextBody));
    const second = makeTrimmer(evaluate, { cache });

    await second.trimmer.trimResult(toolResult(contextBody));

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(second.debug).toHaveBeenCalledWith(
      'local.platform_mcp_proxy.get_context_trim.trimmed',
      expect.objectContaining({ cacheHit: true, inputTokens: 0, outputTokens: 0 }),
    );

    await second.trimmer.trimResult(
      toolResult({ ...contextBody, relatedEntities: [related('High', 'depends-on', 'Edited.')] }),
    );
    expect(evaluate).toHaveBeenCalledTimes(2);
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
      reason: 'jev_failed',
      failureCode: 'TIMEOUT',
    });
  });

  it('does not cache a failure', async () => {
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
});
