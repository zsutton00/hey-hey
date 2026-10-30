import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TasksApi } from '../../shared/api/generated';
import type { JevAnswer, JevResult } from '../../jev/client';
import type { LoadedEntityPromptContext } from '../entity-context/types';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import { loadNearestParentFeatureSection } from './nearest-parent-feature';

const FOCAL_ID = 'task-1';
const LOG_DIR = mkdtempSync(path.join(os.tmpdir(), 'attempt-log-'));

const readAttempts = (): Array<Record<string, unknown>> =>
  readdirSync(LOG_DIR).map(
    (name) => JSON.parse(readFileSync(path.join(LOG_DIR, name), 'utf8')) as Record<string, unknown>,
  );
const SECRET_STATEMENT = 'Hidden second sentence that must stay out of logs.';

const makeLogger = () =>
  ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as PromptTypeHandlerDeps['logger'] &
    Record<'info' | 'warn', ReturnType<typeof vi.fn>>;

const makeDeps = (
  logger = makeLogger(),
): Pick<PromptTypeHandlerDeps, 'auth' | 'apiBaseUrl' | 'logger'> =>
  ({
    auth: { getAccessToken: vi.fn().mockResolvedValue('token') },
    apiBaseUrl: 'http://platform.test',
    logger,
  }) as unknown as Pick<PromptTypeHandlerDeps, 'auth' | 'apiBaseUrl' | 'logger'>;

const request = {
  organizationId: 'org-1',
  projectId: 'proj-1',
  context: {
    entityId: FOCAL_ID,
    featureHierarchy: [
      {
        id: 'feature-1',
        name: 'Parent',
        relationshipType: 'structural',
        relationship: 'ancestor',
        distance: 1,
      },
    ],
  },
} as unknown as Parameters<typeof loadNearestParentFeatureSection>[0];

const loaded = {
  kind: 'entity',
  focalEntity: { entityType: 'TASK', entityId: FOCAL_ID },
  entity: { id: FOCAL_ID, name: 'Focal', type: 'STANDARD', sections: [] },
  context: request.context,
} as unknown as LoadedEntityPromptContext;

const mockParentRead = () =>
  vi
    .spyOn(TasksApi.prototype, 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet')
    .mockResolvedValue({
      data: {
        data: {
          id: 'feature-1',
          name: 'Parent',
          type: 'FEATURE',
          sections: [
            {
              id: 's2',
              key: 'requirements',
              order: 1,
              materializedMarkdown: '- Alpha.\n- Beta.',
              materializedProposalId: 'p',
            },
            {
              id: 's1',
              key: 'description',
              order: 0,
              materializedMarkdown: 'Parent description.',
              materializedProposalId: 'p',
            },
          ],
        },
      },
    } as never);

const settings = (evaluate: (input: never) => Promise<JevResult>) => ({
  jevClient: { evaluate },
  attemptLogDir: LOG_DIR,
  entityContextLoader: {
    load: vi.fn().mockResolvedValue({
      context: {
        content: {
          requirementsSection: {
            records: [
              { id: 'r1', statement: 'Alpha relevant. More alpha.', fulfilledBy: [] },
              { id: 'r2', statement: `Beta other. ${SECRET_STATEMENT}`, fulfilledBy: [] },
            ],
          },
        },
      },
    }),
  },
});

const answerWith = (relevantId: string) =>
  vi.fn(
    (input: { questions: Record<string, { type: string }> }): Promise<JevResult> =>
      Promise.resolve({
        ok: true,
        model: 'jev-test',
        answers: Object.fromEntries<JevAnswer>(
          Object.entries(input.questions).map(([id, question]) => {
            if (question.type === 'noul') return [id, { type: 'noul', noul: 0 }];
            const relevant = id === relevantId;
            return [
              id,
              {
                type: 'choice',
                choice: relevant ? 'implements' : 'same_feature_unrelated',
                confidence: 1,
                probabilities: {
                  implements: relevant ? 1 : 0,
                  informs: 0,
                  same_feature_unrelated: relevant ? 0 : 1,
                  other: 0,
                },
              },
            ];
          }),
        ),
        usage: { inputTokens: 10, outputTokens: 2 },
        durationMs: 5,
      }),
  );

const FULL =
  '## Nearest parent feature\n\n@[feature:feature-1|Parent], in full.\n\n### description\n\nParent description.\n\n### requirements\n\n- Alpha.\n- Beta.';

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of readdirSync(LOG_DIR)) rmSync(path.join(LOG_DIR, name));
});

describe('loadNearestParentFeatureSection', () => {
  it('loads the parent unchanged without a filter', async () => {
    mockParentRead();
    expect(await loadNearestParentFeatureSection(request, makeDeps())).toBe(FULL);
  });

  it('with a filter keeps the description and loads only judged-relevant requirements in full', async () => {
    mockParentRead();
    const logger = makeLogger();
    const section = await loadNearestParentFeatureSection(request, makeDeps(logger), {
      settings: settings(answerWith('requirement:0')),
      loaded,
    });

    expect(section).toContain('### description\n\nParent description.');
    expect(section).toContain('- Alpha relevant. More alpha.');
    expect(section).toContain('- Beta other.');
    expect(section).not.toContain(SECRET_STATEMENT);
    const stats = logger.info.mock.calls.find(
      ([name]) => name === 'project_assistant.prepare.parent_feature.filter_stats',
    );
    expect(stats?.[1]).toMatchObject({
      filtered: true,
      requirementsInFull: 1,
      requirementsAsTitles: 1,
      jevDurationMs: 5,
      inputTokens: 10,
      outputTokens: 2,
    });
    expect(stats?.[1]).toHaveProperty('trimmedChars', expect.any(Number));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(SECRET_STATEMENT);
  });

  it('writes the full Jev input and output and both loads to the attempt log', async () => {
    mockParentRead();
    const section = await loadNearestParentFeatureSection(request, makeDeps(), {
      settings: settings(answerWith('requirement:0')),
      loaded,
    });

    const [attempt] = readAttempts();
    expect(attempt).toMatchObject({
      outcome: 'filtered',
      focalEntityId: FOCAL_ID,
      parentFeatureId: 'feature-1',
      fullLoad: FULL,
      filteredLoad: section,
    });
    expect(attempt?.['jevCalls']).toHaveLength(1);
    expect(JSON.stringify(attempt?.['jevCalls'])).toContain(SECRET_STATEMENT);
    expect(attempt?.['jevCalls']).toMatchObject([
      {
        input: { questions: expect.any(Object) },
        result: { ok: true, usage: { inputTokens: 10 } },
      },
    ]);
  });

  it('logs the failed Jev result and the reason the load stayed unfiltered', async () => {
    mockParentRead();
    await loadNearestParentFeatureSection(request, makeDeps(), {
      settings: settings(() =>
        Promise.resolve({
          ok: false,
          failure: { code: 'PROVIDER_ERROR', message: 'Jev evaluation failed.' },
        }),
      ),
      loaded,
    });

    expect(readAttempts()).toMatchObject([
      {
        outcome: 'unfiltered',
        unfilteredReason: 'jev_failed',
        fullLoad: FULL,
        jevCalls: [{ result: { ok: false } }],
      },
    ]);
  });

  it('returns the unchanged load and logs an unfiltered run when Jev fails', async () => {
    mockParentRead();
    const logger = makeLogger();
    const section = await loadNearestParentFeatureSection(request, makeDeps(logger), {
      settings: settings(() =>
        Promise.resolve({
          ok: false,
          failure: { code: 'PROVIDER_ERROR', message: 'Jev evaluation failed.' },
        }),
      ),
      loaded,
    });

    expect(section).toBe(FULL);
    expect(logger.warn.mock.calls[0]).toEqual([
      'project_assistant.prepare.parent_feature.filter_failed',
      expect.objectContaining({ reason: 'jev_failed', failureCode: 'PROVIDER_ERROR' }),
    ]);
    const stats = logger.info.mock.calls.find(
      ([name]) => name === 'project_assistant.prepare.parent_feature.filter_stats',
    );
    expect(stats?.[1]).toMatchObject({
      filtered: false,
      rawChars: FULL.length,
      trimmedChars: FULL.length,
    });
  });

  it('still fails when the parent feature itself cannot be read', async () => {
    vi.spyOn(
      TasksApi.prototype,
      'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet',
    ).mockResolvedValue({ data: { data: { id: 'other', type: 'FEATURE' } } } as never);
    await expect(
      loadNearestParentFeatureSection(request, makeDeps(), {
        settings: settings(answerWith('requirement:0')),
        loaded,
      }),
    ).rejects.toThrow('malformed parent feature');
  });
});
