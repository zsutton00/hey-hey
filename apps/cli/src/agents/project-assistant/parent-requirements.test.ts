import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { JevAnswer, JevInput, JevResult } from '../../jev/client';
import type { LoadedEntityPromptContext } from '../entity-context/types';
import type { NearestParentFeatureRequest } from './nearest-parent-feature';
import {
  filterParentRequirements,
  ParentRequirementsUnfiltered,
  type ParentRequirementsFilter,
} from './parent-requirements';

const FOCAL_ID = 'task-1';

const record = (id: string, statement: string, fulfilledBy: string[] = []) => ({
  id,
  statement,
  fulfilledBy: fulfilledBy.map((entityId) => ({
    entityId,
    entityType: 'TASK',
    entityTitle: `Title of ${entityId}`,
  })),
});

const loaded = {
  kind: 'entity',
  focalEntity: { entityType: 'TASK', entityId: FOCAL_ID },
  entity: {
    id: FOCAL_ID,
    name: 'Focal task',
    type: 'STANDARD',
    sections: [{ key: 'description', order: 0, materializedMarkdown: 'Do the thing.' }],
  },
  context: { entityId: FOCAL_ID },
} as unknown as LoadedEntityPromptContext;

const parent = {
  id: 'feature-1',
  name: 'Parent',
  sections: [
    {
      id: 's',
      key: 'requirements',
      order: 1,
      materializedMarkdown: 'x',
      materializedProposalId: 'p',
    },
  ],
};
const request = {
  organizationId: 'org-1',
  projectId: 'proj-1',
  context: { entityId: FOCAL_ID },
} as unknown as NearestParentFeatureRequest;

/** Jev answers `implements` for ids listed in `relevant` and `unrelated` for the rest. */
const evaluatorFor = (relevant: string[]) =>
  vi.fn(
    (input: JevInput): Promise<JevResult> =>
      Promise.resolve({
        ok: true,
        model: 'jev-test',
        answers: Object.fromEntries<JevAnswer>(
          Object.entries(input.questions).map(([id, question]) => {
            if (question.type === 'noul') return [id, { type: 'noul', noul: 0 }];
            const isRelevant = relevant.includes(id);
            return [
              id,
              {
                type: 'choice',
                choice: isRelevant ? 'implements' : 'same_feature_unrelated',
                confidence: 1,
                probabilities: {
                  implements: isRelevant ? 0.95 : 0,
                  informs: 0,
                  same_feature_unrelated: isRelevant ? 0 : 0.95,
                  other: 0.05,
                },
              },
            ];
          }),
        ),
        usage: { inputTokens: 120, outputTokens: 8 },
        durationMs: 42,
      }),
  );

const filterWith = (
  records: unknown,
  evaluate: ReturnType<typeof evaluatorFor>,
): ParentRequirementsFilter => ({
  jevClient: { evaluate },
  isEnabled: () => Promise.resolve(true),
  attemptLogDir: path.join(os.tmpdir(), 'jev-attempt-log-test'),
  entityContextLoader: {
    load: vi.fn().mockResolvedValue({ context: { content: { requirementsSection: { records } } } }),
  },
});

describe('filterParentRequirements', () => {
  it('shows relevant requirements in full and the rest as title lines, with Jev stats', async () => {
    const evaluate = evaluatorFor(['requirement:0']);
    const result = await filterParentRequirements(
      request,
      parent,
      loaded,
      filterWith(
        [
          record('r1', 'Keep the key local. Never send it anywhere.'),
          record('r2', 'Export reports as PDF. Include charts.'),
        ],
        evaluate,
      ),
    );

    expect(result.requirementsMarkdown).toContain('- Keep the key local. Never send it anywhere.');
    expect(result.requirementsMarkdown).toContain('- Export reports as PDF.');
    expect(result.requirementsMarkdown).not.toContain('Include charts.');
    expect(result).toMatchObject({
      fullCount: 1,
      titleCount: 1,
      jevCalled: true,
      jevDurationMs: 42,
      inputTokens: 120,
      outputTokens: 8,
    });
  });

  it('shows a requirement the focal task fulfils in full without sending it to Jev', async () => {
    const evaluate = evaluatorFor([]);
    const result = await filterParentRequirements(
      request,
      parent,
      loaded,
      filterWith(
        [
          record('r1', 'Fulfilled by the focal. Second sentence.', [FOCAL_ID]),
          record('r2', 'Unrelated thing. More detail.'),
        ],
        evaluate,
      ),
    );

    expect(result.requirementsMarkdown).toContain(
      '- Fulfilled by the focal. Second sentence. (fulfilled by @[TASK:task-1|Title of task-1])',
    );
    const sent = evaluate.mock.calls[0]?.[0];
    expect(Object.keys(sent?.questions ?? {})).toEqual(['requirement:1', 'conflict:requirement:1']);
  });

  it('does not call Jev when the focal task fulfils every requirement', async () => {
    const evaluate = evaluatorFor([]);
    const result = await filterParentRequirements(
      request,
      parent,
      loaded,
      filterWith([record('r1', 'Only one.', [FOCAL_ID])], evaluate),
    );

    expect(evaluate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ jevCalled: false, titleCount: 0 });
  });

  it('throws unfiltered on a Jev failure and on an invalid response', async () => {
    const failing = vi.fn(
      (): Promise<JevResult> =>
        Promise.resolve({
          ok: false,
          failure: { code: 'TIMEOUT', message: 'Jev evaluation timed out.' },
        }),
    );
    await expect(
      filterParentRequirements(request, parent, loaded, filterWith([record('r1', 'A.')], failing)),
    ).rejects.toMatchObject({ reason: 'jev_failed', fields: { failureCode: 'TIMEOUT' } });

    const invalid = vi.fn(
      (): Promise<JevResult> =>
        Promise.resolve({
          ok: true,
          model: 'jev-test',
          answers: {},
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: 1,
        }),
    );
    await expect(
      filterParentRequirements(request, parent, loaded, filterWith([record('r1', 'A.')], invalid)),
    ).rejects.toMatchObject({ reason: 'jev_failed', fields: { failureCode: 'INVALID_RESPONSE' } });
  });

  it('throws unfiltered on malformed records and on a focal that is not a task', async () => {
    await expect(
      filterParentRequirements(
        request,
        parent,
        loaded,
        filterWith([{ id: 'r1' }], evaluatorFor([])),
      ),
    ).rejects.toBeInstanceOf(ParentRequirementsUnfiltered);

    const feature = {
      ...loaded,
      entity: { ...(loaded as { entity: object }).entity, type: 'FEATURE' },
    } as unknown as LoadedEntityPromptContext;
    await expect(
      filterParentRequirements(request, parent, feature, filterWith([], evaluatorFor([]))),
    ).rejects.toMatchObject({ reason: 'focal_not_a_task' });
  });
});
