import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InMemoryMessageBus } from '../../../core/events/in-memory-message-bus.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import { SessionRole } from '../../../generated/model/sessionRole';
import { WorkItemTypeGuidancePurpose } from '../../../generated/model/workItemTypeGuidancePurpose';
import { WorkItemTypeRegistryService } from '../../../services/tasks/work-item-type-registry.service';

type Advice = Partial<Record<SessionRole, string>>;
// Independent, complete approved matrix: never derive expected advice from SQL.
const expected: Record<string, Advice> = JSON.parse(
  readFileSync(
    resolve(__dirname, 'fixtures/canonical-session-role-guidance.json'),
    'utf8',
  ),
);
const sql = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.10.26.064318__seed_canonical_session_role_guidance.sql',
  ),
  'utf8',
);
const seeded: Record<string, Advice> = JSON.parse(
  sql.match(/\$advice\$([\s\S]*?)\$advice\$/)![1]!,
);
const excluded = [
  'competitor',
  'MARKETING',
  'public_discussion',
  'research_finding',
  'standards',
];
const unrelated = ['MODE', 'workflow', 'workflow_step'];
const roles = Object.values(SessionRole);

// Complete stored definitions enter the real registry loader; no accessor mocks.
function row(typeKey: string, projectId: string | null, advice: Advice | null) {
  return {
    id: typeKey + (projectId ?? '-canonical'),
    typeKey,
    projectId,
    isSystem: projectId === null,
    lifecycleStatus: 'active',
    name: typeKey + ' name',
    role: 'project-info',
    description: 'Existing description',
    sectionDefinitions: [
      { key: 'description', kind: 'markdown', label: 'Description' },
    ],
    requiredScalars: [],
    forbiddenScalars: [],
    allowedStatuses: ['ACTIVE'],
    allowedParentTypes: [],
    edgeTargets: [],
    parentage: { allowedParentEntityTypes: [] },
    tracking: { allowedSourceTaskTypes: [], allowedSourceEntityTypes: [] },
    agentSettableStatuses: ['ACTIVE'],
    anchorableReportTypes: [],
    writingStandards: { create: 'Existing create', edit: 'Existing edit' },
    maintenanceGuidance: 'Existing maintenance',
    sessionRoleGuidance: advice,
    acceptedConfigKinds: [],
    capabilities: {},
    graphConfiguration: null,
  };
}

describe('canonical session-role guidance migration', () => {
  it.each(
    Object.entries(expected).flatMap(([key, advice]) =>
      Object.entries(advice).map(([role, text]) => [key, role, text]),
    ),
  )('preserves the full approved %s / %s advice', (key, role, text) => {
    expect(seeded[key!]![role as SessionRole]).toBe(text);
  });

  it('seeds exactly the shared matrix and intentional omissions', () => {
    expect(Object.keys(seeded).sort()).toEqual(Object.keys(expected).sort());
    expect(Object.values(seeded).flatMap(Object.keys)).toHaveLength(55);
    expect(seeded.STANDARD).not.toHaveProperty('implementation');
    for (const key of [...excluded, ...unrelated, 'DESIGN_DOC']) {
      expect(seeded).not.toHaveProperty(key);
    }
  });

  it('changes only canonical role content and timestamp, failing on missing targets', () => {
    const executable = sql
      .replace(/\$advice\$[\s\S]*?\$advice\$/, "''")
      .replace(/^--.*$/gm, '');
    expect(executable.match(/\bUPDATE\s+\w+/g)).toEqual([
      'UPDATE work_item_type_template',
    ]);
    expect(executable).not.toMatch(/\b(INSERT|DELETE|ALTER|CREATE)\b/i);
    expect(
      executable.match(/\bSET\b([\s\S]*?)\bFROM\b/)![1]!.match(/\w+\s*=/g),
    ).toEqual(['session_role_guidance =', 'updated_at =']);
    expect(executable).toContain('FROM jsonb_each(advice)');
    expect(executable).toContain('WHERE template.type_key = entry.key');
    expect(executable).toContain('FROM jsonb_object_keys(advice)');
    expect(executable).toContain('WHERE template.type_key = expected.type_key');
    expect(executable).toContain('IF missing_keys IS NOT NULL THEN');
    expect(executable).toContain('RAISE EXCEPTION');
    expect(executable.indexOf('RAISE EXCEPTION')).toBeLessThan(
      executable.indexOf('UPDATE work_item_type_template'),
    );
  });
});

describe('seeded advice through project-effective registry reads', () => {
  let registry: WorkItemTypeRegistryService;
  const bus = new InMemoryMessageBus();
  beforeEach(async () => {
    const templates = [
      ...Object.entries(seeded).map(([key, advice]) => row(key, null, advice)),
      ...unrelated.map((key) => row(key, null, null)),
    ];
    const rows = [
      row('FEATURE', 'override', null),
      row('CONTRACT', 'override', { research: 'Project research only' }),
      ...excluded.map((key) =>
        row(key, 'override', { review: 'Project custom review' }),
      ),
    ];
    const prisma = {
      project: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'follower' }, { id: 'override' }]),
      },
      workItemTypeTemplate: {
        findMany: jest.fn().mockResolvedValue(templates),
      },
      workItemType: { findMany: jest.fn().mockResolvedValue(rows) },
    } as unknown as PrismaService;
    registry = new WorkItemTypeRegistryService(prisma, bus);
    await registry.refresh();
  });
  afterEach(async () => {
    await registry.onModuleDestroy();
  });

  it.each(roles)(
    'delivers every canonical %s entry with ordered batches',
    (sessionRole) => {
      const keys = [...Object.keys(expected), 'MODE'].reverse();
      // Exercise the public batch size limit rather than passing all keys at once.
      for (let offset = 0; offset < keys.length; offset += 10) {
        const typeKeys = keys.slice(offset, offset + 10);
        expect(
          registry.getGuidanceBatch('follower', {
            typeKeys,
            purpose: WorkItemTypeGuidancePurpose.Role,
            sessionRole,
          }),
        ).toEqual({
          results: typeKeys.map((typeKey) => ({
            typeKey,
            name: typeKey + ' name',
            sessionRole,
            ...(expected[typeKey]?.[sessionRole] === undefined
              ? {}
              : { guidance: expected[typeKey]![sessionRole] }),
          })),
        });
      }
    },
  );

  it.each(roles)(
    'preserves full override authority and custom %s advice',
    (sessionRole) => {
      expect(
        registry.getGuidanceBatch('override', {
          typeKeys: ['CONTRACT', 'FEATURE', ...excluded],
          purpose: WorkItemTypeGuidancePurpose.Role,
          sessionRole,
        }),
      ).toEqual({
        results: [
          {
            typeKey: 'CONTRACT',
            name: 'CONTRACT name',
            sessionRole,
            ...(sessionRole === SessionRole.Research
              ? { guidance: 'Project research only' }
              : {}),
          },
          { typeKey: 'FEATURE', name: 'FEATURE name', sessionRole },
          ...excluded.map((typeKey) => ({
            typeKey,
            name: typeKey + ' name',
            sessionRole,
            ...(sessionRole === SessionRole.Review
              ? { guidance: 'Project custom review' }
              : {}),
          })),
        ],
      });
      expect(
        registry.getDefinition('override', 'FEATURE')?.definition,
      ).not.toHaveProperty('sessionRoleGuidance');
      expect(
        registry.getDefinition('override', 'CONTRACT')?.definition
          .sessionRoleGuidance,
      ).toEqual({ research: 'Project research only' });
    },
  );

  it('preserves maintenance and authoring guidance', () => {
    for (const typeKey of Object.keys(expected)) {
      expect(
        registry.getGuidance(
          'follower',
          typeKey,
          WorkItemTypeGuidancePurpose.Maintenance,
        ),
      ).toEqual({
        typeKey,
        name: typeKey + ' name',
        maintenanceGuidance: 'Existing maintenance',
      });
      expect(registry.getWritingStandards(typeKey, 'follower')).toEqual({
        create: 'Existing create',
        edit: 'Existing edit',
      });
    }
  });
});
