import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migration(name: string) {
  return readFileSync(resolve(process.cwd(), 'db/flyway', name), 'utf8');
}

const mockup = migration(
  'V2026.10.29.002901__teach_mockup_ux_flow_grouping.sql',
);
const diagram = migration('V2026.10.29.002902__teach_diagram_ux_flow_kind.sql');
const role = migration(
  'V2026.10.29.002903__add_mockup_ux_flow_role_advice.sql',
);

it('appends the same grouping guidance to canonical Mockup create and edit only', () => {
  for (const operation of ['create', 'edit']) {
    expect(mockup).toContain(`'{${operation}}'`);
    expect(mockup).toContain(`template."writing_standards"->>'${operation}'`);
  }
  expect(mockup.match(/\|\| ux_flow_guidance.value/g)).toHaveLength(2);
  expect(mockup).toContain(`WHERE template."type_key" = 'mockup'`);
  expect(mockup).toContain('RAISE EXCEPTION');
  for (const rule of [
    'UX_FLOW',
    'OVERVIEW',
    'actionLabel',
    'reservedEntityId',
    'one proposal group',
    'a substantial state gets its own Mockup',
    'A single screen with no conditions needs no flow',
    'keep the accepted screens',
    'new group for full review',
  ]) {
    expect(mockup).toContain(rule);
  }
});

it('chains exactly on the shipped screen-reference passage and teaches screen transitions', () => {
  const predecessor = migration(
    'V2026.10.27.194014__teach_diagram_mockup_screen_references.sql',
  );
  const old = diagram.match(/SELECT \$old\$([\s\S]*?)\$old\$/)![1];
  expect(old).toBe(predecessor.match(/SELECT \$new\$([\s\S]*?)\$new\$/)![1]);
  const text = diagram.match(/SELECT \$new\$([\s\S]*?)\$new\$/)![1]!;
  for (const rule of [
    'UX_FLOW at OVERVIEW level only',
    'reservedEntityId',
    'For other kinds, a same-round Mockup',
    '**UX flow transition.** Good:',
    'actionLabel',
    'Bad: a GENERIC "Request access" element',
    'left out if it leads nowhere new',
  ]) {
    expect(text).toContain(rule);
  }
  expect(diagram).toContain("WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')");
  for (const operation of ['create', 'edit']) {
    expect(diagram).toContain(
      `position(pg_temp.ux_flow_previous_diagram_semantics() IN writing_standards->>'${operation}') > 0`,
    );
  }
});

it('appends journey advice to the three canonical Mockup roles without replacing other advice', () => {
  const advice = JSON.parse(role.match(/\$advice\$([\s\S]*?)\$advice\$/)![1]!);
  expect(Object.keys(advice).sort()).toEqual([
    'implementation',
    'planning',
    'review',
  ]);
  expect(advice.implementation).toContain(
    'raise any departure before making it',
  );
  expect(advice.planning).toContain('scope and verification');
  expect(advice.review).toContain('delivered journey follows its transitions');
  for (const key of Object.keys(advice)) {
    expect(role).toContain(
      `COALESCE(session_role_guidance->>'${key}', '') || ' ' || (advice.value->>'${key}')`,
    );
  }
  expect(role).toContain("WHERE type_key = 'mockup'");
  expect(role).toContain('RAISE EXCEPTION');
});

it('never rewrites project types or existing diagrams', () => {
  for (const sql of [mockup, diagram, role]) {
    expect(sql).not.toMatch(/UPDATE\s+"?work_item_type"?(?:\s|$)/i);
    expect(sql).not.toMatch(/UPDATE\s+"?task"?(?:\s|$)/i);
  }
});

it('does not reuse temporary function names from earlier migrations in the same connection', () => {
  const predecessor = migration(
    'V2026.10.27.194014__teach_diagram_mockup_screen_references.sql',
  );
  const names = (sql: string) =>
    [...sql.matchAll(/CREATE FUNCTION pg_temp\.(\w+)\(/g)].map(
      (match) => match[1],
    );
  expect(names(diagram)).toHaveLength(2);
  for (const name of names(diagram)) {
    expect(names(predecessor)).not.toContain(name);
  }
});

it('keeps JSON dollar quotes from forming Flyway placeholders', () => {
  for (const sql of [mockup, diagram, role]) {
    expect(sql).not.toMatch(/\$\{/);
  }
});
