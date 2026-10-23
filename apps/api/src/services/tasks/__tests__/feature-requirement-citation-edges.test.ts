import {
  collectRequirementCitationTargets,
  diffRequirementCitationEdges,
  requirementCitationEdgeId,
} from '../feature-requirement-citation-edges';
import { FeatureRequirementsReadError } from '../feature-requirements-reader';

const FEATURE_ID = '00000000-0000-4000-8000-000000000001';
const DESIGN_DOC_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const CONTRACT_ID = '44444444-4444-4444-8444-444444444444';

type Cite = { entityType: string; entityId: string };

function cite(
  entityType: string,
  entityId: string,
): Cite & {
  entityTitle: string;
} {
  return { entityType, entityId, entityTitle: `${entityType} title` };
}

function record(
  id: string,
  slots: { designedBy?: Cite[]; fulfilledBy?: Cite[]; contracts?: Cite[] },
) {
  const withTitles = (cites: Cite[] = []) =>
    cites.map((c) => cite(c.entityType, c.entityId));
  return {
    id,
    statement: `Statement ${id}`,
    designedBy: withTitles(slots.designedBy),
    fulfilledBy: withTitles(slots.fulfilledBy),
    contracts: withTitles(slots.contracts),
  };
}

const RECORD_A = '55555555-5555-4555-8555-555555555555';
const RECORD_B = '66666666-6666-4666-8666-666666666666';

describe('feature requirement citation edges', () => {
  it('derives a stable id per feature and cited entity', () => {
    expect(requirementCitationEdgeId(FEATURE_ID, TASK_ID)).toBe(
      requirementCitationEdgeId(FEATURE_ID, TASK_ID),
    );
    expect(requirementCitationEdgeId(FEATURE_ID, TASK_ID)).not.toBe(
      requirementCitationEdgeId(FEATURE_ID, PLAN_ID),
    );
    expect(requirementCitationEdgeId(FEATURE_ID, TASK_ID)).not.toBe(
      requirementCitationEdgeId(PLAN_ID, TASK_ID),
    );
  });

  it('collects every slot once, mapping design docs and task rows', () => {
    const content = JSON.stringify({
      records: [
        record(RECORD_A, {
          designedBy: [cite('DESIGN_DOC', DESIGN_DOC_ID)],
          fulfilledBy: [cite('TASK', TASK_ID), cite('PLAN', PLAN_ID)],
          contracts: [cite('CONTRACT', CONTRACT_ID)],
        }),
        record(RECORD_B, { fulfilledBy: [cite('TASK', TASK_ID)] }),
      ],
    });

    const targets = [...collectRequirementCitationTargets(content).values()];

    expect(targets).toEqual([
      { entityId: DESIGN_DOC_ID, entityType: 'DESIGN_DOC' },
      { entityId: TASK_ID, entityType: 'TASK' },
      { entityId: PLAN_ID, entityType: 'TASK' },
      { entityId: CONTRACT_ID, entityType: 'TASK' },
    ]);
  });

  it('creates only new citations and deletes only uncited entities', () => {
    const prior = {
      records: [
        record(RECORD_A, {
          fulfilledBy: [cite('TASK', TASK_ID)],
          contracts: [cite('CONTRACT', CONTRACT_ID)],
        }),
      ],
    };
    const next = {
      records: [
        record(RECORD_A, { fulfilledBy: [cite('TASK', TASK_ID)] }),
        record(RECORD_B, { designedBy: [cite('DESIGN_DOC', DESIGN_DOC_ID)] }),
      ],
    };

    const diff = diffRequirementCitationEdges(FEATURE_ID, prior, next);

    expect(diff.creates.map((edge) => edge.entityId)).toEqual([DESIGN_DOC_ID]);
    expect(diff.deletes).toEqual([
      {
        id: requirementCitationEdgeId(FEATURE_ID, CONTRACT_ID),
        featureId: FEATURE_ID,
        entityId: CONTRACT_ID,
        entityType: 'TASK',
      },
    ]);
  });

  it('treats a citation moved between slots or records as unchanged', () => {
    const prior = {
      records: [record(RECORD_A, { fulfilledBy: [cite('TASK', TASK_ID)] })],
    };
    const next = {
      records: [
        record(RECORD_A, {}),
        record(RECORD_B, { fulfilledBy: [cite('TASK', TASK_ID)] }),
      ],
    };

    const diff = diffRequirementCitationEdges(FEATURE_ID, prior, next);

    expect(diff.deletes).toEqual([]);
    expect(diff.creates).toEqual([]);
  });

  it('deletes every citation when the section is cleared', () => {
    const prior = {
      records: [record(RECORD_A, { fulfilledBy: [cite('TASK', TASK_ID)] })],
    };

    expect(diffRequirementCitationEdges(FEATURE_ID, prior, undefined)).toEqual({
      creates: [],
      deletes: [expect.objectContaining({ entityId: TASK_ID })],
    });
  });

  it('rejects malformed requirements content', () => {
    expect(() =>
      diffRequirementCitationEdges(FEATURE_ID, '- legacy markdown', undefined),
    ).toThrow(FeatureRequirementsReadError);
  });
});
