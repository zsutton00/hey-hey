import { describe, expect, it, vi } from 'vitest';
import type { JevInput, JevResult } from '../../jev/client';
import type { FullEntityContextDto, TaskResponseDto } from '../../shared/api/generated';
import { renderEntityPromptTemplate } from '../../commands/entity-prompt-template-renderer';
import { contextCandidates } from './context-candidates';
import { narrowContext } from './narrow-context';
import captured from './fixtures/narrow-context';

const context: FullEntityContextDto = captured;
const focal = {
  kind: 'feature',
  name: context.displayName,
  description: 'Convert loaded context candidates.',
} as const;
const template =
  '{{entity.name}}\n{{context.relatedEntities}}\n{{context.featureHierarchy}}\n{{context.proposals}}\n{{context.agentSessions}}';
const entity: TaskResponseDto = {
  id: context.entityId,
  name: focal.name,
  type: 'STANDARD',
  organizationId: 'org',
  projectId: 'project',
  status: 'ACTIVE',
  source: 'user',
  sections: [],
};

function evaluator() {
  let index = 0;
  return vi.fn((input: JevInput): Promise<JevResult> => {
    const answers: Extract<JevResult, { ok: true }>['answers'] = {};
    for (const [id, question] of Object.entries(input.questions)) {
      if (question.type === 'noul') {
        answers[id] = { type: 'noul', noul: 0 };
      } else {
        const relevance = [0.95, 0.6, 0.05][index++ % 3] ?? 0;
        answers[id] = {
          type: 'choice',
          choice: 'implements',
          confidence: 1,
          probabilities: {
            implements: relevance,
            informs: 0,
            same_feature_unrelated: 1 - relevance,
            other: 0,
          },
        };
      }
    }
    return Promise.resolve({
      ok: true,
      answers,
      model: input.model,
      usage: { inputTokens: 10, outputTokens: 10 },
      durationMs: 1,
    });
  });
}

describe('narrowContext', () => {
  it('judges every captured candidate, preserves protected content and renders a smaller same-shaped context', async () => {
    const report = {
      entityId: 'report',
      entityType: 'REPORT',
      displayName: 'Prior findings',
      relationship: 'related-to',
      reasoning: 'Preserve the entire report row.',
    } as const;
    const loaded = { ...context, relatedEntities: [...(context.relatedEntities ?? []), report] };
    const original = structuredClone(loaded);
    const evaluate = evaluator();
    const result = await narrowContext({
      context: loaded,
      focal,
      ask: 'Implement candidate conversion',
      client: { evaluate },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect([...result.tiers.keys()].sort()).toEqual(
      contextCandidates(loaded)
        .map(({ id }) => id)
        .sort(),
    );
    expect(result.usage.requests).toBe(evaluate.mock.calls.length);
    expect(evaluate.mock.calls.length).toBeGreaterThan(0);
    for (const [request] of evaluate.mock.calls) {
      expect(JSON.stringify(request.state)).toContain('Implement candidate conversion');
    }
    expect(result.context.content).toBe(context.content);
    expect(result.context.agentSessions).toBe(context.agentSessions);
    expect(loaded).toEqual(original);
    expect(result.context.relatedEntities?.find((x) => x.entityId === report.entityId)).toBe(
      report,
    );
    const ids = [
      ...(result.context.featureHierarchy ?? []).map((x) => x.id),
      ...(result.context.relatedEntities ?? []).map((x) => x.entityId),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of result.context.featureHierarchy ?? []) {
      if (result.tiers.get(entry.id) === 'index') {
        expect(entry.description).toBeUndefined();
      }
      if (result.tiers.get(entry.id) === 'short') {
        const originalDescription = context.featureHierarchy?.find(
          (x) => x.id === entry.id,
        )?.description;
        expect(originalDescription?.startsWith(entry.description ?? '') ?? true).toBe(true);
      }
      if (result.tiers.get(entry.id) === 'full') {
        expect(entry).toMatchObject(context.featureHierarchy?.find((x) => x.id === entry.id) ?? {});
      }
    }
    for (const proposal of result.context.proposals ?? []) {
      expect(proposal.influences).toBeUndefined();
      expect(proposal.edges).toBeUndefined();
      expect(proposal).toMatchObject({
        action: context.proposals?.find((x) => x.id === proposal.id)?.action,
        targetEntityId: context.proposals?.find((x) => x.id === proposal.id)?.targetEntityId,
      });
    }
    const before = Buffer.byteLength(
      renderEntityPromptTemplate(template, 'V1', { entity, context }),
    );
    const after = Buffer.byteLength(
      renderEntityPromptTemplate(template, 'V1', { entity, context: result.context }),
    );
    console.info(
      `Captured context rendered bytes: ${String(before)} -> ${String(after)}; design reference: 132 KB`,
    );
    expect(after).toBeLessThan(before);
  });

  it('merges kept evidence across duplicate rows and collections before emitting one entity', async () => {
    const loaded: FullEntityContextDto = {
      ...context,
      proposals: [],
      featureHierarchy: [
        {
          id: 'shared',
          name: 'Shared',
          relationshipType: 'structural',
          description: 'Hierarchy evidence.',
        },
      ],
      relatedEntities: [
        {
          entityId: 'related',
          entityType: 'TASK',
          displayName: 'Related',
          relationship: 'mentions',
          source: 'system',
        },
        {
          entityId: 'related',
          entityType: 'TASK',
          displayName: 'Related',
          relationship: 'depends-on',
          source: 'agent',
          reasoning: 'Required dependency evidence.',
        },
        {
          entityId: 'shared',
          entityType: 'TASK',
          displayName: 'Shared',
          relationship: 'depends-on',
          source: 'agent',
          reasoning: 'Cross-collection evidence.',
        },
      ],
    };
    const result = await narrowContext({
      context: loaded,
      focal,
      ask: 'Keep all',
      client: { evaluate: evaluator() },
      cutoffs: { full: 0, short: 0, conflict: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.context.relatedEntities).toHaveLength(1);
    expect(result.context.relatedEntities?.[0]?.reasoning).toContain(
      'Required dependency evidence.',
    );
    expect(result.context.relatedEntities?.[0]?.reasoning).toContain('depends-on');
    expect(result.context.featureHierarchy).toHaveLength(1);
    expect(result.context.featureHierarchy?.[0]).toMatchObject({
      description: 'Hierarchy evidence.',
    });
    expect(result.context.featureHierarchy?.[0]?.reasoning).toContain('Cross-collection evidence.');
  });

  it('removes archived identities from every collection even when another row has no status', async () => {
    const loaded: FullEntityContextDto = {
      ...context,
      proposals: [],
      featureHierarchy: [
        {
          id: 'archived',
          name: 'Archived',
          relationshipType: 'structural',
          description: 'Archived hierarchy content.',
        },
      ],
      relatedEntities: [
        {
          entityId: 'archived',
          entityType: 'TASK',
          displayName: 'Archived',
          relationship: 'mentions',
        },
        {
          entityId: 'archived',
          entityType: 'TASK',
          displayName: 'Archived',
          relationship: 'depends-on',
          status: 'ARCHIVED',
          reasoning: 'Archived evidence.',
        },
      ],
    };
    const evaluate = evaluator();
    const result = await narrowContext({
      context: loaded,
      focal,
      ask: 'Keep all',
      client: { evaluate },
    });
    expect(result).toMatchObject({
      ok: true,
      context: { relatedEntities: [], featureHierarchy: [] },
    });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('rejects incomplete judge answers and handles a context with no candidates without a request', async () => {
    const evaluate = vi.fn(
      (input: JevInput): Promise<JevResult> =>
        Promise.resolve({
          ok: true,
          answers: {},
          model: input.model,
          usage: { inputTokens: 1, outputTokens: 0 },
          durationMs: 1,
        }),
    );
    const invalid = await narrowContext({ context, focal, ask: 'Implement', client: { evaluate } });
    expect(invalid).toMatchObject({ ok: false, cause: { code: 'INVALID_RESPONSE' } });
    evaluate.mockClear();
    const empty = { ...context, relatedEntities: [], featureHierarchy: [], proposals: [] };
    const result = await narrowContext({
      context: empty,
      focal,
      ask: 'Implement',
      client: { evaluate },
    });
    expect(result).toMatchObject({ ok: true, context: empty, usage: { requests: 0 } });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('returns no partial context when any packed batch fails or throws', async () => {
    const good = evaluator();
    let calls = 0;
    const evaluate = vi.fn(async (input: JevInput): Promise<JevResult> => {
      if (++calls === 2) {
        return { ok: false, failure: { code: 'INVALID_RESPONSE', message: 'missing answer' } };
      }
      return good(input);
    });
    const result = await narrowContext({
      context,
      focal,
      ask: 'Implement',
      client: { evaluate },
      maxChars: 1,
    });
    expect(result).toEqual({
      ok: false,
      cause: { code: 'INVALID_RESPONSE', message: 'missing answer' },
    });
    const cause = new Error('transport');
    expect(
      await narrowContext({
        context,
        focal,
        ask: 'Implement',
        client: {
          evaluate: () => Promise.reject(cause),
        },
      }),
    ).toEqual({ ok: false, cause });
  });
});
