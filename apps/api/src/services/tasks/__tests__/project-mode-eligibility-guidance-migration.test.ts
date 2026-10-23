import { readFileSync } from 'fs';
import { resolve } from 'path';

const flywayDir = resolve(__dirname, '../../../../db/flyway');
const read = (name: string) => readFileSync(resolve(flywayDir, name), 'utf8');

const sql = read(
  'V2026.10.16.090000__correct_mode_eligibility_guidance_and_feature_edge.sql',
);

const constant = (name: string): string => {
  const match = sql.match(
    new RegExp(`${name} constant text := '((?:[^']|'')*)';`),
  );
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(`Missing migration constant ${name}`);
  }
  return value.replace(/''/g, "'");
};

describe('MODE eligibility guidance migration', () => {
  const overviewPattern = constant('overview_pattern');
  const overviewReplacement = constant('overview_replacement');
  const contextGuidance = constant('context_guidance');
  const settingsStandard = constant('settings_standard');
  const createStalePattern = constant('create_stale_pattern');
  const editStalePattern = constant('edit_stale_pattern');
  const createStandard = constant('create_standard');
  const editStandard = constant('edit_standard');

  it('fails clearly when the canonical MODE template is absent', () => {
    expect(sql).toContain('canonical MODE template is missing');
    expect(sql).toContain('RAISE EXCEPTION');
  });

  it('updates only the canonical template, not project-owned MODE definitions', () => {
    expect(sql).toContain('UPDATE work_item_type_template AS mode');
    expect(sql).not.toContain('UPDATE work_item_type ');
    expect(sql).not.toContain('project_id');
    expect(sql).toContain("WHERE mode.type_key = 'MODE'");
    expect(sql).not.toContain('UPDATE task');
  });

  it('adds a Feature DEPENDS_ON edge target only where none exists and widens a restricted one', () => {
    expect(sql).toContain("edge->>'edgeType' = 'DEPENDS_ON'");
    expect(sql).toContain(
      `'[{"edgeType":"DEPENDS_ON","targetTypeKeys":["FEATURE"]}]'::jsonb`,
    );
    expect(sql).toContain(`NOT (edge->'targetTypeKeys' ? 'FEATURE')`);
  });

  it('leaves the fallback focal keys alone so no MODE gains eligibility', () => {
    expect(sql).not.toContain("'{focalTypeKeys}'");
    expect(sql).toContain("jsonb_set(ctx, '{guidance}'");
  });

  it('matches the overview sentence published by the earlier migrations', () => {
    for (const file of [
      'V2026.09.22.120000__publish_mode_freshness_guidance.sql',
      'V2026.09.22.203142__canonicalize_mode_purpose_and_semantic_guidance.sql',
    ]) {
      expect(new RegExp(overviewPattern).test(read(file))).toBe(true);
    }
  });

  it('replaces the shared-type intersection sentence with per-mode, fallback and Feature guidance', () => {
    const published = read(
      'V2026.09.22.203142__canonicalize_mode_purpose_and_semantic_guidance.sql',
    );
    const rewritten = published.replace(
      new RegExp(overviewPattern),
      overviewReplacement,
    );

    expect(rewritten).not.toMatch(
      /intersects with the MODE.s agentGuidance\.contexts\[\]\.focalTypeKeys/,
    );
    expect(overviewReplacement).toContain('settings.eligibleWorkItemTypeKeys');
    expect(overviewReplacement).toContain(
      'only the fallback for a MODE whose settings omit the list',
    );
    expect(overviewReplacement).toContain(
      'Feature eligibility intersects with the type list',
    );
  });

  it('replaces the STANDARD-only initial-slice context wording with fallback-only wording', () => {
    expect(read('V2026.09.22.064424__add_mode_work_item_type.sql')).toContain(
      'Project modes in this initial slice apply to STANDARD work items.',
    );
    expect(sql).toContain("LIKE 'Project modes in this initial slice%'");
    expect(contextGuidance).toContain('Fallback applicability');
    expect(contextGuidance).not.toContain('STANDARD');
  });

  it('names the per-mode type list in the settings, create and edit standards', () => {
    expect(settingsStandard).toContain('projectAssistant.enabled');
    expect(settingsStandard).toContain('eligibleWorkItemTypeKeys');
    expect(settingsStandard).toContain('outbound DEPENDS_ON to a Feature');
    expect(createStandard).toContain('eligibleWorkItemTypeKeys');
    expect(editStandard).toContain('settings.eligibleWorkItemTypeKeys');
    expect(editStandard).toContain(
      'only the fallback for MODEs without the list',
    );
  });

  it('rewrites the stale applicability paragraphs earlier migrations left in project MODE standards', () => {
    const authoring = read(
      'V2026.09.22.064429__teach_project_mode_authoring.sql',
    );

    expect(new RegExp(createStalePattern).test(authoring)).toBe(true);
    expect(new RegExp(editStalePattern).test(authoring)).toBe(true);
    expect(sql).toContain(
      "COALESCE(mode.writing_standards->>'create', '') ~ create_stale_pattern",
    );
    expect(sql).toContain(
      "COALESCE(mode.writing_standards->>'edit', '') ~ edit_stale_pattern",
    );
  });

  it('is idempotent for already-corrected standards', () => {
    expect(sql).toContain(
      "position(create_standard IN COALESCE(mode.writing_standards->>'create', '')) > 0",
    );
    expect(sql).toContain(
      "position(edit_standard IN COALESCE(mode.writing_standards->>'edit', '')) > 0",
    );
  });
});
