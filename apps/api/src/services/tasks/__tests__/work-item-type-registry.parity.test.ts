import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { EntityType } from '../../../generated/model/entityType';
import { ReportType } from '../../../generated/model/reportType';
import { TaskSectionKey } from '../../../generated/model/taskSectionKey';

import { WorkStatus } from '../../../generated/model/workStatus';
import { AGENT_EDGE_TYPES } from '../../../mcp/tools/agent-edge-vocabulary';
import { deriveRules } from '../work-item-type-registry.service';
import type { WorkItemTypeDefinitionDto } from '../../../generated/model/workItemTypeDefinitionDto';

/**
 * Parity guard: the seeded work_item_type system rows must stay field-equal
 * to the expected per-type configuration.
 *
 * This test reads the COMMITTED seed SQL on disk (not a re-run of the
 * generator) and compares it to the expected values across every axis. That
 * is what makes it bidirectional: a hand-edit to the SQL diverges from the
 * expected values here, and a change to the writing-standards module diverges
 * from the (now-stale) SQL — either direction fails.
 *
 * The historical seed is immutable; current semantics are reconciled through
 * append-only delta migrations and the effective-definition fixtures below.
 */

const SEED_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.06.12.1__seed_work_item_type_system_rows.sql',
);
const COMPLETE_SERVICE_SCOPE_MIGRATION_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.07.28.1__add_complete_task_service_scope_guidance.sql',
);
const REMOVE_CODING_PROMPT_DELTA_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.08.12.2__remove_coding_prompt_from_work_item_type_definitions.sql',
);

// The shape the generator serializes per row — the parity contract. Built
// from config for the "expected" side and parsed out of the SQL for the
// "actual" side; the two must be deep-equal.
interface SeedRow {
  typeKey: string;
  isSystem: boolean;
  lifecycleStatus: string;
  allowedStatuses: unknown;
  initialStatusPolicy: unknown;
  sections: unknown;
  requiredScalars: unknown;
  forbiddenScalars: unknown;
  parentage: unknown;
  allowedChildTaskTypes: unknown;
  tracking: unknown;
  allowedEdgeTargetEntityTypes: unknown;
  agentSettableStatuses: unknown;
  anchorableReportTypes: unknown;
  writingStandards: unknown;
  requiresParent: boolean;
  planEligible: boolean;
}

const ALL_ENTITY_TYPES = Object.values(EntityType);
// V2026.06.12.1 predates the removal of CODING_PROMPT from the OpenAPI enum.
// Keep its serialized list frozen; current/effective assertions continue to
// use ALL_ENTITY_TYPES and are reconciled by the forward-only cleanup delta.
const FROZEN_SEED_ENTITY_TYPES = [
  'ARTIFACT',
  'INITIATIVE',
  'PROJECT',
  'TASK',
  'MESSAGE',
  'CONVERSATION',
  'DESIGN_DOC',
  'AGENT_SESSION',
  'CODING_PROMPT',
  'VALIDATION_SESSION',
  'SERVICE',
  'PLAN',
  'REPORT',
  'PROPOSAL',
  'PLAN_STAGE',
  'PLAN_STEP',
  'IMPLEMENTATION_HINT',
  'USER',
] as const;
const ALL_REPORT_TYPES = Object.values(ReportType);
type BuiltInTaskType = 'STANDARD' | 'FEATURE' | 'GOAL' | 'BUG';
const builtInTaskTypes = [
  'STANDARD',
  'FEATURE',
  'GOAL',
  'BUG',
] as const satisfies readonly BuiltInTaskType[];
const FROZEN_SEED_CHILD_TASK_TYPES = [
  'STANDARD',
  'BUG',
  'FEATURE',
  'GOAL',
] as const satisfies readonly BuiltInTaskType[];
const FROZEN_SEED_REPORT_TYPES = ALL_REPORT_TYPES.filter(
  (type) =>
    type !== ReportType.ProjectReport &&
    type !== ReportType.Review &&
    type !== ReportType.FeatureSyncDecision &&
    type !== ReportType.DecisionNeeded &&
    type !== ReportType.SessionMonitorDeferral &&
    type !== ReportType.ChangeWalkthrough &&
    type !== ReportType.EvalRun &&
    type !== ReportType.EvalAttempt &&
    type !== ReportType.EvalHumanReview,
);

const BASE_STATUSES: WorkStatus[] = [
  WorkStatus.Generated,
  WorkStatus.Backlog,
  WorkStatus.RefiningDescription,
  WorkStatus.RefiningDetails,
  WorkStatus.RefiningAcceptanceCriteria,
  WorkStatus.GeneratingDescription,
  WorkStatus.GeneratingDetails,
  WorkStatus.GeneratingDescriptionAndDetails,
  WorkStatus.GeneratingAcceptanceCriteria,
  WorkStatus.GeneratingAll,
  WorkStatus.Active,
  WorkStatus.OnHold,
  WorkStatus.Verifying,
  WorkStatus.Completed,
  WorkStatus.Cancelled,
  WorkStatus.Archived,
];
const SUPERSEDABLE_STATUSES: WorkStatus[] = [
  ...BASE_STATUSES,
  WorkStatus.Superseded,
];

const FROZEN_NON_TRACKING_SOURCE = {
  isTrackingSource: false,
  allowedTargetEntityTypes: [] as EntityType[],
  allowedTargetTaskTypes: [] as string[],
};

const NO_INBOUND_TRACKING = {
  allowedSourceEntityTypes: [] as EntityType[],
  allowedSourceTaskTypes: [] as string[],
};

/**
 * Reconstruct the expected row, mirroring exactly what
 * generate-work-item-type-seed.ts writes for each column. JSONB axes are
 * normalized to plain JSON so the comparison is against the same value
 * PostgreSQL would have stored. Guidance prose is intentionally excluded: it
 * is DB-backed content delivered through forward-only migrations, not config.
 */
function expectedRowFor(
  taskType: BuiltInTaskType,
  entityTypes: readonly string[] = ALL_ENTITY_TYPES,
): SeedRow {
  const writingStandards = { create: '', edit: '' };

  switch (taskType) {
    case WORK_ITEM_TYPE_KEYS.Standard:
      return {
        typeKey: taskType,
        isSystem: true,
        lifecycleStatus: 'active',
        allowedStatuses: SUPERSEDABLE_STATUSES,
        initialStatusPolicy: {
          initialStatus: WorkStatus.Backlog,
          hasSetInitialStatus: false,
        },
        sections: [
          TaskSectionKey.Description,
          TaskSectionKey.AcceptanceCriteria,
        ],
        requiredScalars: [],
        forbiddenScalars: ['tag'],
        parentage: { allowedParentEntityTypes: entityTypes },
        allowedChildTaskTypes: [
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.Bug,
        ],
        tracking: FROZEN_NON_TRACKING_SOURCE,
        allowedEdgeTargetEntityTypes: entityTypes,
        agentSettableStatuses: SUPERSEDABLE_STATUSES,
        anchorableReportTypes: FROZEN_SEED_REPORT_TYPES,
        writingStandards,
        requiresParent: true,
        planEligible: true,
      };
    case WORK_ITEM_TYPE_KEYS.Feature:
      return {
        typeKey: taskType,
        isSystem: true,
        lifecycleStatus: 'active',
        allowedStatuses: SUPERSEDABLE_STATUSES,
        initialStatusPolicy: {
          initialStatus: WorkStatus.Active,
          hasSetInitialStatus: false,
        },
        sections: [TaskSectionKey.Description, TaskSectionKey.Requirements],
        requiredScalars: ['tag'],
        forbiddenScalars: [],
        parentage: { allowedParentEntityTypes: entityTypes },
        allowedChildTaskTypes: FROZEN_SEED_CHILD_TASK_TYPES,
        tracking: FROZEN_NON_TRACKING_SOURCE,
        allowedEdgeTargetEntityTypes: entityTypes,
        agentSettableStatuses: SUPERSEDABLE_STATUSES,
        anchorableReportTypes: FROZEN_SEED_REPORT_TYPES,
        writingStandards,
        requiresParent: false,
        planEligible: true,
      };
    case WORK_ITEM_TYPE_KEYS.Bug:
      return {
        typeKey: taskType,
        isSystem: true,
        lifecycleStatus: 'active',
        allowedStatuses: BASE_STATUSES,
        initialStatusPolicy: {
          initialStatus: WorkStatus.Backlog,
          hasSetInitialStatus: false,
        },
        sections: [TaskSectionKey.Description],
        requiredScalars: [],
        forbiddenScalars: ['tag'],
        parentage: { allowedParentEntityTypes: entityTypes },
        allowedChildTaskTypes: FROZEN_SEED_CHILD_TASK_TYPES,
        tracking: FROZEN_NON_TRACKING_SOURCE,
        allowedEdgeTargetEntityTypes: entityTypes,
        agentSettableStatuses: BASE_STATUSES,
        anchorableReportTypes: FROZEN_SEED_REPORT_TYPES,
        writingStandards,
        // V2026.06.12.1 wrote requires_parent: false. The intent was later
        // tightened to true (orphan BUGs landed on DEFAULT_CONFIG in
        // permission-evaluation.ts); V2026.06.13.4 supersedes this value
        // via the capabilities map — see EXPECTED_CAPABILITIES.BUG below.
        // V2026.06.12.1 is frozen (Flyway validateOnMigrate=true checksums).
        requiresParent: false,
        planEligible: true,
      };
    case WORK_ITEM_TYPE_KEYS.Goal:
      return {
        typeKey: taskType,
        isSystem: true,
        lifecycleStatus: 'active',
        allowedStatuses: BASE_STATUSES,
        initialStatusPolicy: {
          initialStatus: WorkStatus.Active,
          hasSetInitialStatus: true,
        },
        sections: [TaskSectionKey.Description],
        requiredScalars: ['dueDate'],
        forbiddenScalars: ['tag'],
        parentage: { allowedParentEntityTypes: entityTypes },
        allowedChildTaskTypes: FROZEN_SEED_CHILD_TASK_TYPES,
        tracking: {
          isTrackingSource: true,
          // Historical seed predates the Plan work-item cutover.
          allowedTargetEntityTypes: ['TASK', 'PLAN'],
          allowedTargetTaskTypes: [
            WORK_ITEM_TYPE_KEYS.Feature,
            WORK_ITEM_TYPE_KEYS.Standard,
            WORK_ITEM_TYPE_KEYS.Bug,
          ],
        },
        allowedEdgeTargetEntityTypes: entityTypes,
        agentSettableStatuses: BASE_STATUSES,
        anchorableReportTypes: FROZEN_SEED_REPORT_TYPES,
        writingStandards,
        requiresParent: false,
        planEligible: true,
      };
    default:
      throw new Error(`Unhandled task type: ${String(taskType)}`);
  }
}

/** Narrow a parsed value to non-undefined, failing loudly when absent. */
function req<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

/**
 * Parse one INSERT statement into a SeedRow. The generator emits values
 * positionally — four leading scalars, twelve dollar-quoted JSONB blocks,
 * then five boolean literals — so we rely on that fixed ordering and assert
 * the block/bool counts up front. A future change to the generator's column
 * layout breaks here loudly rather than silently parsing undefined.
 */
function parseStatement(statement: string): SeedRow {
  const valuesStart = statement.indexOf(') VALUES (');
  if (valuesStart === -1) {
    throw new Error('INSERT statement is missing a VALUES clause');
  }
  const values = statement.slice(valuesStart + ') VALUES ('.length);

  // Leading scalars: id (uuid), type_key, is_system, lifecycle_status.
  const scalarMatch = values.match(
    /^\s*'[^']+',\s*'([^']+)',\s*(true|false),\s*'([^']+)',/,
  );
  if (!scalarMatch) {
    throw new Error('Could not parse leading scalars from INSERT statement');
  }
  const typeKey = req(scalarMatch[1], 'missing type_key');
  const isSystemLiteral = req(scalarMatch[2], 'missing is_system');
  const lifecycleStatus = req(scalarMatch[3], 'missing lifecycle_status');

  // Twelve dollar-quoted JSONB blocks, in column order.
  const jsonbBlocks = [
    ...values.matchAll(/\$wit\$\n([\s\S]*?)\n\$wit\$::jsonb/g),
  ].map((m) => JSON.parse(req(m[1], 'empty JSONB block')) as unknown);
  if (jsonbBlocks.length !== 12) {
    throw new Error(
      `Expected 12 JSONB columns for ${typeKey}, found ${jsonbBlocks.length}`,
    );
  }
  const [
    allowedStatuses,
    initialStatusPolicy,
    sections,
    requiredScalars,
    forbiddenScalars,
    parentage,
    allowedChildTaskTypes,
    tracking,
    allowedEdgeTargetEntityTypes,
    agentSettableStatuses,
    anchorableReportTypes,
    writingStandards,
  ] = jsonbBlocks;

  // Five boolean columns, after the last JSONB block and before the
  // CURRENT_TIMESTAMP timestamps.
  const tail = values.slice(values.lastIndexOf('$wit$::jsonb'));
  const bools = [...tail.matchAll(/\b(true|false)\b/g)].map(
    (m) => m[1] === 'true',
  );
  if (bools.length !== 5) {
    throw new Error(
      `Expected 5 boolean columns for ${typeKey}, found ${bools.length}`,
    );
  }
  // The historical seed still has is_hierarchy_node at index 3; hierarchy is
  // now derived from the platform-owned FEATURE key, so that value is ignored.
  const requiresParent = req(bools[1], 'missing requires_parent');
  const planEligible = req(bools[4], 'missing plan_eligible');

  return {
    typeKey,
    isSystem: isSystemLiteral === 'true',
    lifecycleStatus,
    allowedStatuses,
    initialStatusPolicy,
    sections,
    requiredScalars,
    forbiddenScalars,
    parentage,
    allowedChildTaskTypes,
    tracking,
    allowedEdgeTargetEntityTypes,
    agentSettableStatuses,
    anchorableReportTypes,
    writingStandards,
    requiresParent,
    planEligible,
  };
}

function parseSeedRows(): Record<string, SeedRow> {
  const sql = readFileSync(SEED_PATH, 'utf8');
  const statements = sql
    .split('ON CONFLICT DO NOTHING;')
    .filter((s) => s.includes('INSERT INTO "work_item_type"'));

  const byType: Record<string, SeedRow> = {};
  for (const statement of statements) {
    const row = parseStatement(statement);
    byType[row.typeKey] = row;
  }
  return byType;
}

const seedRows = parseSeedRows();
const workflowTypeKeys = ['workflow', 'workflow_step'] as const;

// The agent-authorable edge vocabulary as it stood when V2026.06.12.1 seeded
// and V2026.06.13.2 reseeded the rows — BEFORE EVOLVES was added to
// AGENT_EDGE_TYPES. The frozen migrations cannot follow later vocabulary growth
// (Flyway validateOnMigrate=true), so EVOLVES landed via the V2026.06.22.1
// delta instead. This snapshot is the parity contract for the frozen seed and
// reseed; the delta block below reconciles it back to the live AGENT_EDGE_TYPES
// so config drift is still caught.
const FROZEN_RESEED_EDGE_TYPES = [
  'RELATED_TO',
  'DEPENDS_ON',
  'DERIVES_FROM',
  'SUPERSEDES',
  'CONTRADICTS',
] as const;

// What the frozen V2026.06.13.2 reseed wrote into edge_targets per type.
const FROZEN_RESEED_EDGE_TARGETS = FROZEN_RESEED_EDGE_TYPES.map((edgeType) => ({
  edgeType,
  targetTypeKeys: [] as string[],
}));

// The effective edge-target set after the V2026.06.22.1 delta appended EVOLVES
// — equal to the live AGENT_EDGE_TYPES vocabulary. This is the post-migration
// state deriveRules reads, so it feeds the stored-definition reconstruction.
const EFFECTIVE_EDGE_TARGETS = AGENT_EDGE_TYPES.map((edgeType) => ({
  edgeType,
  targetTypeKeys: [] as string[],
}));

describe('work_item_type seed parity with WORK_ITEM_TYPE_CONFIG', () => {
  it('keeps complete service scope guidance append-only for both STANDARD modes', () => {
    const migration = readFileSync(
      COMPLETE_SERVICE_SCOPE_MIGRATION_PATH,
      'utf8',
    );
    expect(migration).toContain('## Complete known service scope');
    expect(migration).toContain("'create'");
    expect(migration).toContain("'edit'");
    expect(migration).toContain('serviceIds');
  });
  it('seeds exactly one row per task type — no missing or stray rows', () => {
    expect(Object.keys(seedRows).sort()).toEqual([...builtInTaskTypes].sort());
  });

  describe.each(builtInTaskTypes)('seed row for %s', (taskType) => {
    const expected = expectedRowFor(taskType, FROZEN_SEED_ENTITY_TYPES);
    const actual = seedRows[taskType];

    it('is present in the seed', () => {
      expect(actual).toBeDefined();
    });

    // One assertion per configuration axis; guidance prose is intentionally
    // not an executable config contract.
    it.each(
      (Object.keys(expected) as (keyof SeedRow)[]).filter(
        (axis) => axis !== 'writingStandards',
      ),
    )('matches config on %s', (axis) => {
      expect(actual?.[axis]).toEqual(expected[axis]);
    });
  });
});

describe('V2026.08.12.2 remove-coding-prompt definition delta', () => {
  const sql = readFileSync(REMOVE_CODING_PROMPT_DELTA_PATH, 'utf8');

  it.each(['work_item_type_template', 'work_item_type'])(
    'removes CODING_PROMPT from %s parentage and tracking entity lists',
    (table) => {
      expect(sql).toContain(`UPDATE "${table}"`);
      expect(sql).toContain(
        `("parentage"->'allowedParentEntityTypes') - 'CODING_PROMPT'`,
      );
      expect(sql).toContain(
        `("tracking"->'allowedSourceEntityTypes') - 'CODING_PROMPT'`,
      );
    },
  );
});

/**
 * Parity guard for the rich WorkItemTypeDefinitionDto columns reseeded by
 * V2026.06.13.2 onto the system rows. The lean assertions above stay against
 * V2026.06.12.1; this block reads the COMMITTED reseed SQL (a set of UPDATEs)
 * and compares the new name/description/section/scalar/parent/child/edge axes
 * to values reconstructed independently here — so a hand-edit to the SQL or a
 * change to the generator's TYPE_SPECS diverges and fails.
 *
 * Regenerate after an intentional change:
 * Current capability changes use append-only migrations.
 */

const RESEED_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.06.13.2__reseed_work_item_type_definition.sql',
);

interface ReseedRow {
  name: string;
  description: string;
  sectionDefinitions: unknown;
  requiredScalars: unknown;
  forbiddenScalars: unknown;
  allowedParentTypes: unknown;
  allowedChildTypes: unknown;
  edgeTargets: unknown;
}

// id → type key, mirroring the deterministic SYSTEM_IDS the generator writes.
const ID_TO_TYPE: Record<string, BuiltInTaskType> = {
  'c1a70000-0000-0000-0000-000000000001': 'STANDARD',
  'c1a70000-0000-0000-0000-000000000002': 'FEATURE',
  'c1a70000-0000-0000-0000-000000000003': 'GOAL',
  'c1a70000-0000-0000-0000-000000000004': 'BUG',
};

// The rich axes the reseed writes, reconstructed independently per type.
const EXPECTED_RESEED: Record<BuiltInTaskType, ReseedRow> = {
  STANDARD: {
    name: 'Task',
    description:
      'A unit of implementation work under a feature — it describes how a ' +
      'feature is realized, not what is delivered. Reach for it for concrete ' +
      'engineering work that ladders up to a deliverable.',
    sectionDefinitions: [
      { key: 'description', label: 'Description' },
      { key: 'acceptanceCriteria', label: 'Acceptance Criteria' },
    ],
    requiredScalars: [],
    forbiddenScalars: ['tag'],
    allowedParentTypes: ['STANDARD', 'FEATURE', 'BUG'],
    allowedChildTypes: ['STANDARD', 'BUG'],
    edgeTargets: FROZEN_RESEED_EDGE_TARGETS,
  },
  FEATURE: {
    name: 'Feature',
    description:
      'A user-facing product capability — it describes what is delivered as a ' +
      'product concept. Features form the project backbone and nest to build ' +
      'the hierarchy the project is navigated by.',
    sectionDefinitions: [
      { key: 'description', label: 'Description' },
      { key: 'requirements', label: 'Requirements' },
    ],
    requiredScalars: ['tag'],
    forbiddenScalars: [],
    allowedParentTypes: ['FEATURE', 'BUG'],
    allowedChildTypes: ['STANDARD', 'BUG', 'FEATURE'],
    edgeTargets: FROZEN_RESEED_EDGE_TARGETS,
  },
  GOAL: {
    name: 'Goal',
    description:
      'A tracked, time-bound outcome that references the features, tasks, and ' +
      'plans expected to deliver it. Top-level only — a goal cannot be ' +
      'parented under another item and holds no children.',
    sectionDefinitions: [{ key: 'description', label: 'Description' }],
    requiredScalars: ['dueDate'],
    forbiddenScalars: ['tag'],
    allowedParentTypes: [],
    allowedChildTypes: [],
    edgeTargets: FROZEN_RESEED_EDGE_TARGETS,
  },
  BUG: {
    name: 'Bug',
    description:
      'A defect in delivered behavior. It captures what is broken and the fix ' +
      'required; lighter-weight than a task and not tied to a single feature.',
    sectionDefinitions: [{ key: 'description', label: 'Description' }],
    requiredScalars: [],
    forbiddenScalars: ['tag'],
    allowedParentTypes: ['STANDARD', 'FEATURE', 'BUG'],
    allowedChildTypes: ['STANDARD', 'BUG', 'FEATURE'],
    edgeTargets: FROZEN_RESEED_EDGE_TARGETS,
  },
};

/** Unescape a SQL single-quoted literal ('' → '). */
function unquote(literal: string): string {
  return literal.replace(/''/g, "'");
}

/**
 * Parse one UPDATE statement into a ReseedRow. The generator emits two leading
 * single-quoted scalars (name, description) followed by six dollar-quoted
 * JSONB blocks in column order, then the WHERE id clause that keys the row to
 * its type. A layout change breaks here loudly rather than parsing undefined.
 */
function parseReseedStatement(statement: string): {
  typeKey: BuiltInTaskType;
  row: ReseedRow;
} {
  const idMatch = statement.match(/WHERE "id" = '([^']+)'/);
  const id = req(idMatch?.[1], 'UPDATE is missing a WHERE "id" clause');
  const typeKey = req(ID_TO_TYPE[id], `Unknown system id ${id}`);

  const nameMatch = statement.match(/"name" = '((?:[^']|'')*)'/);
  const descMatch = statement.match(/"description" = '((?:[^']|'')*)'/);
  const name = unquote(req(nameMatch?.[1], 'missing name'));
  const description = unquote(req(descMatch?.[1], 'missing description'));

  const jsonbBlocks = [
    ...statement.matchAll(/\$wit\$\n([\s\S]*?)\n\$wit\$::jsonb/g),
  ].map((m) => JSON.parse(req(m[1], 'empty JSONB block')) as unknown);
  if (jsonbBlocks.length !== 6) {
    throw new Error(
      `Expected 6 JSONB columns for ${typeKey}, found ${jsonbBlocks.length}`,
    );
  }
  const [
    sectionDefinitions,
    requiredScalars,
    forbiddenScalars,
    allowedParentTypes,
    allowedChildTypes,
    edgeTargets,
  ] = jsonbBlocks;

  return {
    typeKey,
    row: {
      name,
      description,
      sectionDefinitions,
      requiredScalars,
      forbiddenScalars,
      allowedParentTypes,
      allowedChildTypes,
      edgeTargets,
    },
  };
}

function parseReseedRows(): Record<string, ReseedRow> {
  const sql = readFileSync(RESEED_PATH, 'utf8');
  const statements = sql
    .split('UPDATE "work_item_type"')
    .filter((s) => s.includes('WHERE "id"'));

  const byType: Record<string, ReseedRow> = {};
  for (const statement of statements) {
    const { typeKey, row } = parseReseedStatement(statement);
    byType[typeKey] = row;
  }
  return byType;
}

const reseedRows = parseReseedRows();

describe('work_item_type reseed parity with the rich type definition', () => {
  it('reseeds exactly one row per task type — no missing or stray rows', () => {
    expect(Object.keys(reseedRows).sort()).toEqual(
      [...builtInTaskTypes].sort(),
    );
  });

  describe.each(builtInTaskTypes)('reseed row for %s', (taskType) => {
    const expected = EXPECTED_RESEED[taskType];
    const actual = reseedRows[taskType];

    it('is present in the reseed', () => {
      expect(actual).toBeDefined();
    });

    it.each(Object.keys(expected) as (keyof ReseedRow)[])(
      'matches the type definition on %s',
      (axis) => {
        expect(actual?.[axis]).toEqual(expected[axis]);
      },
    );
  });
});

/**
 * Parity for the V2026.06.22.1 delta that brought the frozen edge_targets and
 * STANDARD writing_standards up to the EVOLVES-extended agent vocabulary.
 * EVOLVES was added to AGENT_EDGE_TYPES after V2026.06.12.1 / V2026.06.13.2 were
 * deployed; those stay frozen (Flyway validateOnMigrate=true), so this delta is
 * how the effective state diverges. The check reads the COMMITTED migration and
 * asserts it appends exactly the EVOLVES entry to all four built-in rows and
 * patches STANDARD's prose — and, crucially, that the frozen reseed set plus the
 * EVOLVES the delta adds equals the live AGENT_EDGE_TYPES, so a future addition
 * to the vocabulary with no follow-up delta fails here.
 */
const EVOLVES_DELTA_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.06.22.1__add_evolves_edge_type_to_work_item_types.sql',
);

describe('V2026.06.22.1 add-evolves-edge-type delta', () => {
  const sql = readFileSync(EVOLVES_DELTA_PATH, 'utf8');

  it('appends the EVOLVES edge_targets entry to all four built-in rows', () => {
    expect(sql).toContain(
      `"edge_targets" = "edge_targets" || '[{"edgeType":"EVOLVES","targetTypeKeys":[]}]'::jsonb`,
    );
    const ids = [
      ...sql.matchAll(/'(c1a70000-0000-0000-0000-[0-9a-f]{12})'/g),
    ].map((m) => m[1]);
    expect(new Set(ids)).toEqual(new Set(Object.keys(ID_TO_TYPE)));
  });

  it('patches STANDARD writing_standards vocab in both prose blocks', () => {
    expect(sql).toContain(
      '`RELATED_TO`, `DEPENDS_ON`, `DERIVES_FROM`, `SUPERSEDES`, `CONTRADICTS`, `EVOLVES`',
    );
    expect(sql).toContain(
      `WHERE "id" = 'c1a70000-0000-0000-0000-000000000001'`,
    );
  });

  it('reconciles the frozen reseed edge set plus EVOLVES with the live vocabulary', () => {
    // The frozen reseed wrote FROZEN_RESEED_EDGE_TYPES; this delta adds EVOLVES.
    // Their union must equal the live AGENT_EDGE_TYPES — so adding a new edge
    // type to the vocabulary without a follow-up delta migration fails here.
    expect([...FROZEN_RESEED_EDGE_TYPES, 'EVOLVES'].sort()).toEqual(
      [...AGENT_EDGE_TYPES].sort(),
    );
  });
});

/**
 * Parity guard for the capabilities map + reordered allowed_statuses reseeded by
 * V2026.06.13.4 onto the system rows. The collapse made every engine rule derive
 * from the stored definition, so two derived facts must round-trip: the
 * capability switches deriveRules unpacks, and allowed_statuses ordered
 * initial-status-first (deriveRules reads allowedStatuses[0]). This reads the
 * COMMITTED reseed SQL and compares both axes to values reconstructed here.
 *
 * Regenerate after an intentional change:
 *   ts-node -r tsconfig-paths/register scripts/generate-work-item-type-seed.ts
 */

const CAPS_RESEED_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.06.13.4__reseed_work_item_type_capabilities.sql',
);

const WORKFLOW_TYPES_DELTA_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.06.30.1__add_workflow_work_item_types.sql',
);
const WORKFLOW_GRAPH_DELTA_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.07.22.2__configure_workflow_graph_capability.sql',
);

const CONTRACT_TYPE_DELTA_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.07.09.2__add_contract_work_item_type.sql',
);
const EXPLORER_CAPABILITY_DELTA_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.07.30.1__add_explorer_sidebar_capability.sql',
);

// The capability flags V2026.06.13.4 wrote per built-in — frozen historical
// (the migration is committed and Flyway validateOnMigrate=true means its
// content cannot change). For the effective post-migration state, see
// EFFECTIVE_CAPABILITIES below.
const V13_4_CAPABILITIES: Record<BuiltInTaskType, Record<string, boolean>> = {
  STANDARD: {
    requiresParent: true,
    planEligible: true,
    hasSetInitialStatus: false,
  },
  FEATURE: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
  },
  GOAL: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: true,
  },
  BUG: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
  },
};

// The capability flags in effect after the full migration chain runs —
// V13_4 overrides applied, then V2026.06.20.1 flips BUG.requiresParent to
// true. This is the source of truth deriveRules unpacks against the live
// registry and the value the engine reads at runtime.
const EFFECTIVE_CAPABILITIES: Record<
  BuiltInTaskType,
  Record<string, boolean>
> = {
  STANDARD: {
    ...V13_4_CAPABILITIES.STANDARD,
    rendersInline: false,
    showsInExplorerSidebar: false,
  },
  FEATURE: {
    ...V13_4_CAPABILITIES.FEATURE,
    rendersInline: false,
    showsInExplorerSidebar: true,
  },
  GOAL: {
    ...V13_4_CAPABILITIES.GOAL,
    rendersInline: false,
    showsInExplorerSidebar: true,
  },
  BUG: {
    ...V13_4_CAPABILITIES.BUG,
    requiresParent: true,
    rendersInline: false,
    showsInExplorerSidebar: false,
  },
};

const EFFECTIVE_ALLOWED_CHILD_TYPES: Record<BuiltInTaskType, string[]> = {
  STANDARD: ['STANDARD', 'BUG', 'workflow'],
  FEATURE: ['STANDARD', 'BUG', 'FEATURE', 'workflow'],
  GOAL: [],
  BUG: ['STANDARD', 'BUG', 'FEATURE', 'workflow'],
};

// The intended initial status per type — first in the reseeded allowed_statuses.
const INITIAL_STATUS: Record<BuiltInTaskType, WorkStatus> = {
  STANDARD: WorkStatus.Backlog,
  FEATURE: WorkStatus.Active,
  GOAL: WorkStatus.Active,
  BUG: WorkStatus.Backlog,
};

/** allowed_statuses with the intended initial status hoisted to the front. */
function orderedStatusesFor(taskType: BuiltInTaskType): WorkStatus[] {
  const base = expectedRowFor(taskType).allowedStatuses as WorkStatus[];
  const initial = INITIAL_STATUS[taskType];
  return [initial, ...base.filter((status) => status !== initial)];
}

interface CapsReseedRow {
  capabilities: unknown;
  allowedStatuses: unknown;
}

/** Parse one capabilities-reseed UPDATE: two dollar-quoted JSONB blocks. */
function parseCapsReseedStatement(statement: string): {
  typeKey: BuiltInTaskType;
  row: CapsReseedRow;
} {
  const idMatch = statement.match(/WHERE "id" = '([^']+)'/);
  const id = req(idMatch?.[1], 'UPDATE is missing a WHERE "id" clause');
  const typeKey = req(ID_TO_TYPE[id], `Unknown system id ${id}`);

  const jsonbBlocks = [
    ...statement.matchAll(/\$wit\$\n([\s\S]*?)\n\$wit\$::jsonb/g),
  ].map((m) => JSON.parse(req(m[1], 'empty JSONB block')) as unknown);
  if (jsonbBlocks.length !== 2) {
    throw new Error(
      `Expected 2 JSONB columns for ${typeKey}, found ${jsonbBlocks.length}`,
    );
  }
  const [capabilities, allowedStatuses] = jsonbBlocks;
  return { typeKey, row: { capabilities, allowedStatuses } };
}

function parseCapsReseedRows(): Record<string, CapsReseedRow> {
  const sql = readFileSync(CAPS_RESEED_PATH, 'utf8');
  const statements = sql
    .split('UPDATE "work_item_type"')
    .filter((s) => s.includes('WHERE "id"'));

  const byType: Record<string, CapsReseedRow> = {};
  for (const statement of statements) {
    const { typeKey, row } = parseCapsReseedStatement(statement);
    byType[typeKey] = row;
  }
  return byType;
}

const capsReseedRows = parseCapsReseedRows();

describe('work_item_type capabilities reseed parity', () => {
  it('reseeds exactly one row per task type — no missing or stray rows', () => {
    expect(Object.keys(capsReseedRows).sort()).toEqual(
      [...builtInTaskTypes].sort(),
    );
  });

  describe.each(builtInTaskTypes)(
    'capabilities reseed row for %s',
    (taskType) => {
      const actual = capsReseedRows[taskType];

      it('is present in the reseed', () => {
        expect(actual).toBeDefined();
      });

      it('contains the retained capability flags', () => {
        expect(actual?.capabilities).toMatchObject(
          V13_4_CAPABILITIES[taskType],
        );
      });

      it('orders allowed_statuses with the initial status first', () => {
        expect(actual?.allowedStatuses).toEqual(orderedStatusesFor(taskType));
      });
    },
  );
});

/**
 * Parity for the surgical V2026.06.20.1 follow-up that flips the BUG row's
 * `requiresParent` capability to true via a jsonb_set. V2026.06.13.4 is frozen
 * (Flyway validateOnMigrate=true), so this delta migration is the way the
 * effective state diverges from V13_4 for the BUG row. The check reads the
 * COMMITTED migration and asserts both the targeted row id and the resulting
 * boolean value, so a hand-edit to the SQL or accidental scope creep fails here.
 */
const BUG_FLIP_PATH = resolve(
  __dirname,
  '../../../../db/flyway/V2026.06.20.1__bug_requires_parent.sql',
);

describe('V2026.06.20.1 bug-requires-parent delta', () => {
  const sql = readFileSync(BUG_FLIP_PATH, 'utf8');

  it('targets only the BUG row by its deterministic id', () => {
    const whereIds = [...sql.matchAll(/WHERE "id" = '([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(whereIds).toEqual(['c1a70000-0000-0000-0000-000000000004']);
  });

  it('sets requiresParent to true via jsonb_set on the capabilities map', () => {
    expect(sql).toMatch(
      /jsonb_set\("capabilities",\s*'\{requiresParent\}',\s*'true'::jsonb\)/,
    );
  });

  it('flips BUG.requiresParent from its V13_4 value (false) to the effective value (true)', () => {
    expect(V13_4_CAPABILITIES.BUG.requiresParent).toBe(false);
    expect(EFFECTIVE_CAPABILITIES.BUG.requiresParent).toBe(true);
  });
});

describe('V2026.06.30.1 workflow work-item type delta', () => {
  const sql = readFileSync(WORKFLOW_TYPES_DELTA_PATH, 'utf8');

  it('adds rendersInline=false to the existing system capability maps', () => {
    expect(sql).toContain(
      `"capabilities" = "capabilities" || '{"rendersInline": false}'::jsonb`,
    );
    for (const id of Object.keys(ID_TO_TYPE)) {
      expect(sql).toContain(`'${id}'`);
    }
  });

  it('updates existing system rows to the current generated report-type set', () => {
    expect(sql).toContain(
      `"anchorable_report_types" = '["CODING_RESEARCH","EVIDENCE_PIPELINE","SNAPSHOT","ROLLUP_PROPOSAL","DAILY_SESSION","GOAL_PROGRESS","RISK_ALERT","SESSION_SUMMARY","COMMIT","PLAN","IMPLEMENT","FEATURE_SYNC","FEATURE_SYNC_HANDOFF","FEATURE_SYNC_DECISION","DECISION_NEEDED","PHASE_GROUNDING","VALIDATION_WALKTHROUGH","FEATURE_TREE_ANALYSIS","COMPETITIVE_ANALYSIS"]'::jsonb`,
    );
  });

  it('allows task-like built-ins to own workflow children', () => {
    expect(sql).toContain(
      `"allowed_child_types" = '["STANDARD","BUG","workflow"]'::jsonb`,
    );
    expect(sql).toContain(
      `"allowed_child_types" = '["STANDARD","BUG","FEATURE","workflow"]'::jsonb`,
    );
  });

  it('inserts workflow and workflow_step as system rows with deterministic ids', () => {
    expect(sql).toContain(`'c1a70000-0000-0000-0000-000000000005'`);
    expect(sql).toContain(`'workflow'`);
    expect(sql).toContain(`'c1a70000-0000-0000-0000-000000000006'`);
    expect(sql).toContain(`'workflow_step'`);
  });

  it('sets only workflow to render inline', () => {
    expect(sql).toContain(
      '"planEligible":false,"hasSetInitialStatus":false,"rendersInline":true',
    );
    expect(sql).toContain(
      '"planEligible":false,"hasSetInitialStatus":false,"rendersInline":false',
    );
  });
});

describe('V2026.07.22.2 Workflow graph-capability delta', () => {
  const sql = readFileSync(WORKFLOW_GRAPH_DELTA_PATH, 'utf8');
  const graphBlock = sql.match(/\$graph\$\n([\s\S]*?)\n\$graph\$::jsonb/);
  const graph = JSON.parse(
    req(graphBlock?.[1], 'missing Workflow graph configuration JSON'),
  ) as {
    nodeChildType: string;
    layout: { sectionKey: string; schemaRef: string };
    readableRelationships: Array<{
      edgeType: string;
      category: string;
      sourceEndpoint: unknown;
      targetEndpoint: unknown;
      direction: unknown;
      metadataSchemaRef: string;
    }>;
    editableRelationships: Array<{
      edgeType: string;
      category: string;
      sourceEndpoint: unknown;
      targetEndpoint: unknown;
      direction: unknown;
      metadataSchemaRef: string;
    }>;
    searchableMetaLinkTargets: Array<{
      edgeType: string;
      targetEntityTypes: string[];
      targetWorkItemTypeKeys?: string[];
    }>;
    rendererKey: string;
    editorKey: string;
    supportedActions: string[];
  };

  it('updates only the active built-in Workflow row', () => {
    expect(sql).toContain(`"id" = 'c1a70000-0000-0000-0000-000000000005'`);
    expect(sql).toContain(`"type_key" = 'workflow'`);
    expect(sql).toContain(`"is_system" = true`);
    expect(sql).toContain(`"project_id" IS NULL`);
    expect(sql).toContain(`"lifecycle_status" = 'active'`);
    expect(sql).not.toContain(`"type_key" = 'workflow_step'`);
  });

  it('appends the reusable schema-backed graphLayout section', () => {
    expect(sql).toContain(
      `[{"key":"graphLayout","label":"Graph Layout","kind":"json","schemaRef":"#/components/schemas/WorkItemGraphLayoutValue"}]`,
    );
    expect(graph.layout).toEqual({
      sectionKey: 'graphLayout',
      schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
    });
  });

  it('declares the complete Workflow relationship semantics', () => {
    expect(graph.nodeChildType).toBe('workflow_step');
    expect(graph.readableRelationships).toEqual(graph.editableRelationships);
    expect(
      graph.readableRelationships.map((relationship) => relationship.edgeType),
    ).toEqual([
      'STANDARD',
      'CONDITIONAL',
      'LOOP',
      'FULFILLED_BY',
      'DEPENDS_ON',
    ]);

    const byType = Object.fromEntries(
      graph.readableRelationships.map((relationship) => [
        relationship.edgeType,
        relationship,
      ]),
    );
    expect(byType.STANDARD!.direction).toEqual({
      required: true,
      allowedDirections: ['forward'],
      predicateRequired: false,
    });
    expect(byType.CONDITIONAL!.direction).toEqual({
      required: true,
      allowedDirections: ['forward'],
      predicateRequired: true,
    });
    expect(byType.LOOP!.direction).toEqual({
      required: false,
      allowedDirections: [],
      predicateRequired: false,
    });
    expect(byType.FULFILLED_BY!.category).toBe('meta');
    expect(byType.DEPENDS_ON!.targetEndpoint).toEqual({
      role: 'externalEntity',
      entityTypes: ['TASK'],
      workItemTypeKeys: ['CONTRACT'],
    });
    for (const relationship of graph.readableRelationships) {
      expect(relationship.sourceEndpoint).toEqual({
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      });
      expect(relationship.metadataSchemaRef).toBe(
        '#/components/schemas/RelationshipMetadata',
      );
    }
  });

  it('declares meta-link search, component keys, and the complete action set', () => {
    expect(graph.searchableMetaLinkTargets).toEqual([
      { edgeType: 'FULFILLED_BY', targetEntityTypes: ['TASK'] },
      {
        edgeType: 'DEPENDS_ON',
        targetEntityTypes: ['TASK'],
        targetWorkItemTypeKeys: ['CONTRACT'],
      },
    ]);
    expect(graph.rendererKey).toBe('work-item-graph');
    expect(graph.editorKey).toBe('work-item-graph-editor');
    expect(graph.supportedActions).toEqual([
      'viewGraph',
      'createNode',
      'updateNode',
      'deleteNode',
      'createRelationship',
      'updateRelationship',
      'reconnectRelationship',
      'deleteRelationship',
      'replaceLayout',
      'clearLayout',
    ]);
  });
});

describe('V2026.07.09.2 contract work-item type delta', () => {
  const sql = readFileSync(CONTRACT_TYPE_DELTA_PATH, 'utf8');

  it('archives project-scoped custom CONTRACT rows before inserting the system row', () => {
    expect(sql).toContain(`WHERE "type_key" = 'CONTRACT'`);
    expect(sql).toContain(`AND "is_system" = false`);
    expect(sql).toContain(`SET "lifecycle_status" = 'archived'`);
  });

  it('inserts CONTRACT as a deterministic system row', () => {
    expect(sql).toContain(`'c1a70000-0000-0000-0000-000000000008'`);
    expect(sql).toContain(`'CONTRACT'`);
    expect(sql).toContain(`'["ACTIVE","SUPERSEDED"]'::jsonb`);
    expect(sql).toContain(`'["FEATURE"]'::jsonb`);
    expect(sql).toContain(`'["tag","dueDate"]'::jsonb`);
  });

  it('keeps Contract non-hierarchical and metadata-only', () => {
    expect(sql).toContain(`"planEligible": false`);
    expect(sql).toContain(`"rendersInline": false`);
    expect(sql).toContain(
      `{"edgeType":"DEPENDS_ON","targetTypeKeys":["FEATURE"]}`,
    );
    expect(sql).toContain(
      `{"edgeType":"SUPERSEDES","targetTypeKeys":["CONTRACT"]}`,
    );
  });

  it('allows workflow_step DEPENDS_ON to target only CONTRACT', () => {
    expect(sql).toContain(`WHERE "type_key" = 'workflow_step'`);
    expect(sql).toContain(
      `{"edgeType":"DEPENDS_ON","targetTypeKeys":["CONTRACT"]}`,
    );
  });
});

describe('V2026.07.30.1 Explorer Sidebar capability delta', () => {
  const sql = readFileSync(EXPLORER_CAPABILITY_DELTA_PATH, 'utf8');

  it('initializes the optional capability to false for system rows', () => {
    expect(sql).toContain(`"is_system" = true`);
    expect(sql).toContain(`"project_id" IS NULL`);
    expect(sql).toMatch(
      /jsonb_set\(\s*COALESCE\("capabilities", '\{\}'::jsonb\),\s*'\{showsInExplorerSidebar\}',\s*'false'::jsonb/s,
    );
  });

  it('explicitly enables active FEATURE and GOAL system rows', () => {
    expect(sql).toContain(`"type_key" IN ('FEATURE', 'GOAL')`);
    expect(sql).toContain(`"lifecycle_status" = 'active'`);
    expect(sql).toMatch(
      /jsonb_set\(\s*COALESCE\("capabilities", '\{\}'::jsonb\),\s*'\{showsInExplorerSidebar\}',\s*'true'::jsonb/s,
    );
  });
});

describe('V2026.10.02.234535 hide MODE from Explorer Sidebar', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../../../../db/flyway/V2026.10.02.234535__hide_mode_from_explorer_sidebar.sql',
    ),
    'utf8',
  );

  it('targets only the canonical MODE template row', () => {
    expect(sql).toContain(`WHERE type_key = 'MODE'`);
    expect(sql).toContain('UPDATE work_item_type_template');
    expect(sql).not.toMatch(/work_item_type_definition/);
  });

  it('merges showsInExplorerSidebar=false without replacing other capabilities', () => {
    expect(sql).toMatch(
      /jsonb_set\(\s*COALESCE\(capabilities, '\{\}'::jsonb\),\s*'\{showsInExplorerSidebar\}',\s*'false'::jsonb/s,
    );
  });
});

/**
 * deriveRules parity: feed each built-in's stored definition — assembled exactly
 * as the collapsed columns hold it — through deriveRules and assert it
 * reproduces the historical engine rules (expectedRowFor). allowedStatuses is
 * compared by membership because the reseed reorders it; initialStatus is
 * asserted exactly so GOAL stays ACTIVE.
 */
function storedDefinitionFor(
  taskType: BuiltInTaskType,
): WorkItemTypeDefinitionDto {
  const lean = expectedRowFor(taskType);
  const rich = EXPECTED_RESEED[taskType];
  const parentage = lean.parentage as {
    allowedParentEntityTypes: EntityType[];
  };
  return {
    key: taskType,
    name: rich.name,
    role:
      taskType === WORK_ITEM_TYPE_KEYS.Standard ||
      taskType === WORK_ITEM_TYPE_KEYS.Bug
        ? 'work-item'
        : 'project-info',
    description: rich.description,
    sections: rich.sectionDefinitions as WorkItemTypeDefinitionDto['sections'],
    requiredScalars:
      rich.requiredScalars as WorkItemTypeDefinitionDto['requiredScalars'],
    forbiddenScalars:
      rich.forbiddenScalars as WorkItemTypeDefinitionDto['forbiddenScalars'],
    allowedStatuses: orderedStatusesFor(taskType),
    allowedParentTypes: rich.allowedParentTypes as string[],
    // The stored definition reflects the post-migration state: the
    // V2026.06.22.1 delta appended EVOLVES onto the frozen reseed's
    // edge_targets, so the effective set (not rich's frozen snapshot) is what
    // the row holds at runtime.
    edgeTargets:
      EFFECTIVE_EDGE_TARGETS as WorkItemTypeDefinitionDto['edgeTargets'],
    allowedParentEntityTypes: parentage.allowedParentEntityTypes,
    tracking: lean.tracking as WorkItemTypeDefinitionDto['tracking'],
    agentSettableStatuses: lean.agentSettableStatuses as WorkStatus[],
    anchorableReportTypes: ALL_REPORT_TYPES as ReportType[],
    writingStandards:
      lean.writingStandards as WorkItemTypeDefinitionDto['writingStandards'],
    capabilities: EFFECTIVE_CAPABILITIES[taskType],
  };
}

describe('deriveRules reproduces the historical rules from the stored definition', () => {
  describe.each(builtInTaskTypes)('derived rules for %s', (taskType) => {
    const rules = deriveRules(storedDefinitionFor(taskType));
    const expected = expectedRowFor(taskType);

    it('derives the exact initial-status policy', () => {
      expect(rules.initialStatusPolicy).toEqual(expected.initialStatusPolicy);
    });

    it('derives the allowed statuses by membership', () => {
      expect([...rules.allowedStatuses].sort()).toEqual(
        [...(expected.allowedStatuses as WorkStatus[])].sort(),
      );
    });

    it('derives the classification role independently from behavior axes', () => {
      expect(rules.role).toBe(
        taskType === WORK_ITEM_TYPE_KEYS.Standard ||
          taskType === WORK_ITEM_TYPE_KEYS.Bug
          ? 'work-item'
          : 'project-info',
      );
    });

    it('derives sections from the section definitions', () => {
      expect(rules.sections).toEqual(expected.sections);
    });

    it('derives the scalar axes', () => {
      expect(rules.requiredScalars).toEqual(expected.requiredScalars);
      expect(rules.forbiddenScalars).toEqual(expected.forbiddenScalars);
    });

    it('derives the capability booleans', () => {
      // Capabilities source-of-truth is the full migration chain: V13_4
      // wrote the maps then V2026.06.20.1 flipped BUG.requiresParent to
      // true. Compare against EFFECTIVE_CAPABILITIES (the post-chain
      // state), not the frozen-historical expectedRowFor bools or the
      // V13_4-only snapshot.
      const caps = EFFECTIVE_CAPABILITIES[taskType];
      expect(rules.requiresParent).toBe(caps.requiresParent);
      expect(rules.planEligible).toBe(caps.planEligible);
      expect(rules.rendersInline).toBe(caps.rendersInline);
      expect(rules.showsInExplorerSidebar).toBe(caps.showsInExplorerSidebar);
    });

    it('derives parentage, tracking, reports, and standards from the definition', () => {
      expect(rules.parentage).toEqual(expected.parentage);
      expect(rules.tracking).toEqual(expected.tracking);
      expect(rules.agentSettableStatuses).toEqual(
        expected.agentSettableStatuses,
      );
      expect(rules.anchorableReportTypes).toEqual(ALL_REPORT_TYPES);
    });

    it('derives the uniform edge-target entity set', () => {
      expect(rules.allowedEdgeTargetEntityTypes).toEqual(
        expected.allowedEdgeTargetEntityTypes,
      );
    });
  });
});

describe('deriveRules supports workflow built-in definitions', () => {
  const baseWorkflowDefinition = {
    name: 'Workflow',
    role: 'project-info',
    description:
      'A graph-shaped design artifact that owns workflow_step children and ' +
      'renders inline as a flow chart when mentioned.',
    sections: [{ key: 'description', label: 'Description' }],
    requiredScalars: [],
    forbiddenScalars: ['tag', 'dueDate'],
    edgeTargets:
      EFFECTIVE_EDGE_TARGETS as WorkItemTypeDefinitionDto['edgeTargets'],
    allowedStatuses: orderedStatusesFor('STANDARD'),
    allowedParentEntityTypes: [EntityType.Task],
    tracking: NO_INBOUND_TRACKING,
    agentSettableStatuses: orderedStatusesFor('STANDARD'),
    anchorableReportTypes: ALL_REPORT_TYPES as ReportType[],
    writingStandards: { create: '', edit: '' },
  } satisfies Omit<
    WorkItemTypeDefinitionDto,
    'key' | 'allowedParentTypes' | 'capabilities'
  >;

  it('derives workflow as an inline-rendering container for workflow_step', () => {
    const rules = deriveRules({
      ...baseWorkflowDefinition,
      key: 'workflow',
      allowedParentTypes: ['FEATURE', 'STANDARD'],
      capabilities: {
        requiresParent: false,
        planEligible: false,
        hasSetInitialStatus: false,
        rendersInline: true,
      },
    });

    expect(rules.requiresParent).toBe(false);
    expect(rules.allowedParentTaskTypes).toEqual(['FEATURE', 'STANDARD']);
    expect(rules.planEligible).toBe(false);
    expect(rules.rendersInline).toBe(true);
  });

  it('derives workflow_step as a required-child leaf under workflow', () => {
    const rules = deriveRules({
      ...baseWorkflowDefinition,
      key: 'workflow_step',
      name: 'Workflow Step',
      allowedParentTypes: ['workflow'],
      writingStandards: { create: '', edit: '' },
      capabilities: {
        requiresParent: true,
        planEligible: false,
        hasSetInitialStatus: false,
        rendersInline: false,
      },
    });

    expect(rules.requiresParent).toBe(true);
    expect(rules.allowedParentTaskTypes).toEqual(['workflow']);
    expect(rules.planEligible).toBe(false);
    expect(rules.rendersInline).toBe(false);
  });

  it('keeps the workflow type-key list explicit', () => {
    expect([...workflowTypeKeys]).toEqual(['workflow', 'workflow_step']);
  });
});

describe('deriveRules supports CONTRACT built-in definition', () => {
  it('derives Contract as a feature-parented agreement marker', () => {
    const rules = deriveRules({
      key: WORK_ITEM_TYPE_KEYS.Contract,
      name: 'Contract',
      role: 'project-info',
      description:
        'A user-authored, first-class marker that an agreement exists across a boundary between features.',
      sections: [
        { key: 'description', label: 'Description', kind: 'markdown' },
      ],
      requiredScalars: [],
      forbiddenScalars: ['tag', 'dueDate'],
      edgeTargets: [
        {
          edgeType: 'DEPENDS_ON',
          targetTypeKeys: [WORK_ITEM_TYPE_KEYS.Feature],
        },
        { edgeType: 'RELATED_TO', targetTypeKeys: [] },
        {
          edgeType: 'SUPERSEDES',
          targetTypeKeys: [WORK_ITEM_TYPE_KEYS.Contract],
        },
      ],
      allowedStatuses: [WorkStatus.Active, WorkStatus.Superseded],
      allowedParentTypes: [WORK_ITEM_TYPE_KEYS.Feature],
      allowedParentEntityTypes: [EntityType.Task],
      tracking: NO_INBOUND_TRACKING,
      agentSettableStatuses: [],
      anchorableReportTypes: [],
      writingStandards: { create: '', edit: '' },
      capabilities: {
        requiresParent: true,
        planEligible: false,
        hasSetInitialStatus: false,
        rendersInline: false,
      },
    });

    expect(rules.initialStatusPolicy).toEqual({
      initialStatus: WorkStatus.Active,
      hasSetInitialStatus: false,
    });
    expect(rules.allowedStatuses).toEqual([
      WorkStatus.Active,
      WorkStatus.Superseded,
    ]);
    expect(rules.sections).toEqual([TaskSectionKey.Description]);
    expect(rules.requiredScalars).toEqual([]);
    expect(rules.forbiddenScalars).toEqual(['tag', 'dueDate']);
    expect(rules.allowedParentTaskTypes).toEqual([WORK_ITEM_TYPE_KEYS.Feature]);
    expect(rules.requiresParent).toBe(true);
    expect(rules.planEligible).toBe(false);
    expect(rules.rendersInline).toBe(false);
    expect(rules.parentage).toEqual({
      allowedParentEntityTypes: [EntityType.Task],
    });
    expect(rules.agentSettableStatuses).toEqual([]);
    expect(rules.anchorableReportTypes).toEqual([]);
  });
});
