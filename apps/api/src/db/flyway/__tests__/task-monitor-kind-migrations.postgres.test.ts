import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateTaskMonitorExecutionDefinitionContent } from '../../../services/tasks/task-monitor-execution-definition.validator';
import { workItemTypeCapabilitiesSchema } from '../../../services/tasks/work-item-type-capabilities.schema';

/**
 * Runs the shipped monitor-kind migrations, in order, against populated rows in
 * a throwaway schema of a disposable PostgreSQL database. Set
 * TASK_MONITOR_KIND_MIGRATION_DATABASE_URL to a database you can create schemas in.
 */
const databaseUrl = process.env.TASK_MONITOR_KIND_MIGRATION_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const FLYWAY_DIR = resolve(__dirname, '../../../../db/flyway');
const MIGRATIONS = [
  'V2026.11.13.064226__publish_task_monitor_task_kind.sql',
  'V2026.11.15.224545__publish_task_monitor_kind_policies.sql',
  'V2026.11.16.063238__record_task_kind_on_existing_monitors.sql',
  'V2026.11.16.102036__publish_monitor_acceptance_effects.sql',
];

const openapiRoot = execFileSync(
  process.execPath,
  ['scripts/openapi-root.js'],
  { encoding: 'utf8' },
).trim();
const { kind: _fixtureKind, ...definitionWithoutKind } = JSON.parse(
  readFileSync(
    join(openapiRoot, 'specs/fixtures/task-monitor-contract.json'),
    'utf8',
  ),
).running as Record<string, unknown>;

const legacyOverrideKind = {
  key: 'task',
  allowedNodeTypes: ['STANDARD'],
  allowedLaunchMethods: ['quick'],
  allowedRuntimeProviders: ['codex'],
  allowedReasoningEfforts: ['high'],
};

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

describeDatabase('task monitor kind migrations on populated data', () => {
  const schema = `kind_migrations_${randomUUID().replace(/-/g, '')}`;

  const psql = (sql: string, file?: string): string =>
    execFileSync(
      'psql',
      [
        databaseUrl!,
        '-X',
        '-q',
        '-t',
        '-A',
        '-v',
        'ON_ERROR_STOP=1',
        ...(file ? ['-f', file] : ['-c', sql]),
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

  const runMigrations = () => {
    for (const migration of MIGRATIONS) {
      psql('', join(FLYWAY_DIR, migration));
    }
  };

  const json = (sql: string): unknown => JSON.parse(psql(sql).trim());

  beforeAll(() => {
    execFileSync('psql', [
      databaseUrl!,
      '-X',
      '-q',
      '-c',
      `CREATE SCHEMA ${schema}`,
    ]);
    psql(`
      CREATE TABLE work_item_type_template (type_key text PRIMARY KEY, capabilities jsonb NOT NULL, updated_at timestamp);
      CREATE TABLE work_item_type (type_key text, project_id text, capabilities jsonb NOT NULL, updated_at timestamp);
      CREATE TABLE tasks (id text PRIMARY KEY, type text NOT NULL);
      CREATE TABLE task_sections (id text PRIMARY KEY, task_id text NOT NULL, key text NOT NULL, materialized_markdown text, updated_at timestamp);

      INSERT INTO work_item_type_template VALUES
        ('TASK_MONITOR', '{"requiresParent": true, "planEligible": false}', NULL),
        ('STANDARD', '{"planEligible": true}', NULL);
      INSERT INTO work_item_type VALUES
        ('TASK_MONITOR', 'project-legacy', ${quote(JSON.stringify({ requiresParent: true, monitorKind: legacyOverrideKind }))}, NULL),
        ('TASK_MONITOR', 'project-no-kind', '{"requiresParent": true}', NULL);
      INSERT INTO tasks VALUES
        ('monitor-without-kind', 'TASK_MONITOR'),
        ('monitor-with-kind', 'TASK_MONITOR'),
        ('monitor-corrupt', 'TASK_MONITOR'),
        ('monitor-empty', 'TASK_MONITOR'),
        ('feature', 'FEATURE');
      INSERT INTO task_sections VALUES
        ('s1', 'monitor-without-kind', 'executionDefinition', ${quote(JSON.stringify(definitionWithoutKind, null, 2))}, NULL),
        ('s2', 'monitor-with-kind', 'executionDefinition', ${quote(JSON.stringify({ ...definitionWithoutKind, kind: 'requirement-check' }))}, NULL),
        ('s3', 'monitor-corrupt', 'executionDefinition', 'not json {', NULL),
        ('s4', 'monitor-empty', 'executionDefinition', '[]', NULL),
        ('s5', 'monitor-without-kind', 'summary', 'Running the stage.', NULL),
        ('s6', 'feature', 'executionDefinition', '{"cursor": 0}', NULL);
    `);
    runMigrations();
  });

  afterAll(() => {
    execFileSync('psql', [
      databaseUrl!,
      '-X',
      '-q',
      '-c',
      `DROP SCHEMA IF EXISTS ${schema} CASCADE`,
    ]);
  });

  it('publishes the canonical Task kind with its policies as the one declared kind', () => {
    const capabilities = workItemTypeCapabilitiesSchema.parse(
      json(
        "SELECT capabilities FROM work_item_type_template WHERE type_key = 'TASK_MONITOR'",
      ),
    );

    expect(capabilities.requiresParent).toBe(true);
    expect(capabilities.monitorKinds).toEqual([
      expect.objectContaining({
        key: 'task',
        allowedNodeTypes: ['STANDARD'],
        start: { type: 'STATUS_TRANSITION', status: 'ACTIVE' },
        done: { type: 'ITEM_STATUS', status: 'COMPLETED' },
        supervision: { type: 'COORDINATOR_REVIEW' },
      }),
    ]);
  });

  it('records the Task kind on a stored monitor without one so it matches the contract', () => {
    const definition = json(
      "SELECT materialized_markdown FROM task_sections WHERE id = 's1'",
    );
    const parsed = validateTaskMonitorExecutionDefinitionContent(definition);

    expect(parsed.success).toBe(true);
    expect(definition).toEqual({ ...definitionWithoutKind, kind: 'task' });
  });

  it('leaves recorded kinds, non-object sections and other items unchanged', () => {
    const rows = psql(
      "SELECT id || '=' || materialized_markdown FROM task_sections WHERE id IN ('s2','s3','s4','s5','s6') ORDER BY id",
    )
      .trim()
      .split('\n');

    expect(rows).toEqual([
      `s2=${JSON.stringify({ ...definitionWithoutKind, kind: 'requirement-check' })}`,
      's3=not json {',
      's4=[]',
      's5=Running the stage.',
      's6={"cursor": 0}',
    ]);
  });

  it('moves a project definition that stored a single kind into the kinds list', () => {
    const legacy = workItemTypeCapabilitiesSchema.parse(
      json(
        "SELECT capabilities FROM work_item_type WHERE project_id = 'project-legacy'",
      ),
    );
    const noKind = json(
      "SELECT capabilities FROM work_item_type WHERE project_id = 'project-no-kind'",
    );

    expect(legacy).toEqual({
      requiresParent: true,
      monitorKinds: [legacyOverrideKind],
    });
    expect(noKind).toEqual({ requiresParent: true });
  });

  it('changes nothing when run again', () => {
    const snapshot = () =>
      psql(
        "SELECT string_agg(id || materialized_markdown, '|' ORDER BY id) FROM task_sections",
      ) +
      psql(
        "SELECT string_agg(capabilities::text, '|' ORDER BY type_key) FROM work_item_type_template",
      );
    const before = snapshot();

    runMigrations();

    expect(snapshot()).toBe(before);
  });
});
