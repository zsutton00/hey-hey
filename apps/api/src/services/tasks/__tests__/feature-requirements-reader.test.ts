import {
  EMPTY_FEATURE_REQUIREMENTS_CONTENT,
  FeatureRequirementsReadError,
  formatFeatureRequirementsForDiscovery,
  inspectFeatureRequirementsSection,
  readCanonicalFeatureRequirementsContent,
  readFeatureRequirementsSection,
} from '../feature-requirements-reader';

const DESIGN_DOC_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const CONTRACT_ID = '44444444-4444-4444-8444-444444444444';

const section = {
  records: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      statement: 'The first requirement',
      group: 'Access control',
      designedBy: [
        {
          entityType: 'DESIGN_DOC',
          entityId: DESIGN_DOC_ID,
          entityTitle: 'Access design',
        },
      ],
      fulfilledBy: [
        { entityType: 'TASK', entityId: TASK_ID, entityTitle: 'Build gate' },
        { entityType: 'PLAN', entityId: PLAN_ID, entityTitle: 'Rollout plan' },
      ],
      contracts: [
        {
          entityType: 'CONTRACT',
          entityId: CONTRACT_ID,
          entityTitle: 'Access contract',
        },
      ],
    },
    {
      id: '66666666-6666-4666-8666-666666666666',
      statement: 'The second requirement',
      designedBy: [],
      fulfilledBy: [],
      contracts: [],
    },
  ],
};

describe('feature-requirements-reader', () => {
  it('distinguishes absent, empty, present, and malformed content', () => {
    expect(inspectFeatureRequirementsSection(undefined)).toEqual({
      state: 'absent',
    });
    expect(inspectFeatureRequirementsSection(null)).toEqual({
      state: 'absent',
    });
    expect(
      inspectFeatureRequirementsSection(EMPTY_FEATURE_REQUIREMENTS_CONTENT),
    ).toMatchObject({ state: 'empty', section: { records: [] } });
    expect(inspectFeatureRequirementsSection(section)).toMatchObject({
      state: 'present',
      section,
    });
    expect(inspectFeatureRequirementsSection('   ')).toMatchObject({
      state: 'malformed',
      error: expect.objectContaining({ code: 'empty_content' }),
    });
    expect(inspectFeatureRequirementsSection('{"records":')).toMatchObject({
      state: 'malformed',
      error: expect.objectContaining({ code: 'invalid_content' }),
    });
  });

  it('returns canonical JSON without changing record or citation order', () => {
    const source = JSON.stringify(section, null, 2);

    expect(readFeatureRequirementsSection(source)).toEqual(section);
    expect(readCanonicalFeatureRequirementsContent(source)).toBe(
      JSON.stringify(section),
    );
  });

  it('formats ordered records and citation roles without serialized JSON', () => {
    const text = formatFeatureRequirementsForDiscovery(section);

    expect(text).toBe(
      [
        'Statement: The first requirement',
        'Group: Access control',
        `Designed by: Access design (DESIGN_DOC:${DESIGN_DOC_ID})`,
        `Fulfilled by: Build gate (TASK:${TASK_ID}), Rollout plan (PLAN:${PLAN_ID})`,
        `Contracts: Access contract (CONTRACT:${CONTRACT_ID})`,
        '',
        'Statement: The second requirement',
      ].join('\n'),
    );
    expect(text).not.toContain('{');
    expect(text).not.toContain('"records"');
  });

  it('fails at the reader boundary instead of falling back to markdown', () => {
    expect(() =>
      readFeatureRequirementsSection('- legacy requirement'),
    ).toThrow(FeatureRequirementsReadError);
    expect(() => formatFeatureRequirementsForDiscovery('')).toThrow(
      FeatureRequirementsReadError,
    );
  });

  it('omits absent and empty collections from discovery text', () => {
    expect(formatFeatureRequirementsForDiscovery(undefined)).toBeUndefined();
    expect(
      formatFeatureRequirementsForDiscovery(EMPTY_FEATURE_REQUIREMENTS_CONTENT),
    ).toBeUndefined();
  });
});
