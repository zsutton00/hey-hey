import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.09.23.025555__refine_project_mode_authoring_guidance.sql',
);
const parentMigrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.09.22.094613__require_feature_parent_for_project_modes.sql',
);
const pickerMigrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.09.24.022851__publish_mode_picker_summary_guidance.sql',
);
const leannessMigrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.10.04.010000__make_leanness_primary_mode_authoring_rule.sql',
);

describe('project MODE authoring guidance migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const parentSql = readFileSync(parentMigrationPath, 'utf8');
  const pickerSql = readFileSync(pickerMigrationPath, 'utf8');

  it('adds first-sentence guidance to canonical and active project MODE definitions', () => {
    expect(pickerSql).toContain('UPDATE work_item_type_template AS mode');
    expect(pickerSql).toContain('UPDATE work_item_type AS mode');
    expect(pickerSql).toContain("mode.lifecycle_status = 'active'");
    expect(pickerSql).toContain("section->>'key' = 'description'");
    expect(pickerSql).toContain(
      'a concise, standalone summary for the launch picker',
    );
    expect(pickerSql).toContain('a concise, standalone launch-picker summary');
    expect(pickerSql).toContain(
      'keep its first sentence a concise, standalone launch-picker summary',
    );
    expect(pickerSql).toContain("NULLIF(section->>'writingStandard', '')");
    expect(pickerSql).toContain(
      "NULLIF(mode.writing_standards->>'create', '')",
    );
    expect(pickerSql).not.toContain('UPDATE task');
  });

  it('replaces only canonical MODE writing standards', () => {
    expect(sql).toContain('UPDATE work_item_type_template AS mode');
    expect(sql).toContain("WHERE mode.type_key = 'MODE'");
    expect(sql.match(/SET writing_standards/g)).toHaveLength(1);
    expect(sql).not.toContain('UPDATE work_item_type AS mode');
    expect(sql).not.toContain('section_definitions =');
    expect(sql).not.toContain('allowed_parent_types =');
    expect(sql).not.toContain('capabilities =');
    expect(sql).not.toContain('agent_guidance =');
    expect(sql).not.toContain('description =');
  });

  it('updates create and edit in place without reconstructing the definition', () => {
    expect(sql).toContain("COALESCE(mode.writing_standards, '{}'::jsonb)");
    expect(sql).toContain("'{create}'");
    expect(sql).toContain("'{edit}'");
    expect(sql).toContain('to_jsonb(guidance.create_guidance)');
    expect(sql).toContain('to_jsonb(guidance.edit_guidance)');
    expect(sql).toContain(
      "mode.writing_standards->>'create' IS DISTINCT FROM guidance.create_guidance",
    );
    expect(sql).toContain(
      "mode.writing_standards->>'edit' IS DISTINCT FROM guidance.edit_guidance",
    );
  });

  it('fails clearly when the preceding canonical MODE definition is absent', () => {
    expect(sql).toContain('canonical MODE template is missing');
    expect(sql).toContain('RAISE EXCEPTION');
  });

  it('publishes the complete create guidance', () => {
    expect(sql).toContain(
      'Author the MODE as a project-specific instruction bundle for an already capable coding agent.',
    );
    expect(sql).toContain(
      'Include only instructions that materially change decisions or execution in this project',
    );
    expect(sql).toContain(
      'make each instruction only as specific as the risk and consequence of deviation require',
    );
    expect(sql).toContain('Keep `MODE.md` as a concise entry document');
    expect(sql).toContain(
      'conditional procedures, detailed examples, checklists, and deeper reference material',
    );
    expect(sql).toContain('supporting Markdown files for on-demand reading');
    expect(sql).toContain(
      'selected work item, feature ancestry and graph context, design documents, Service scope, permissions, proposal boundaries, and launch constraints',
    );
    expect(sql).toContain(
      'Registry fields remain authoritative for description, applicability, discovery, and eligibility',
    );
    expect(sql).toContain('not a packaged skill');
    expect(sql).toContain(
      'scripts, assets, hooks, tool installation, executable extensions, automatic activation',
    );
    expect(sql).toContain(
      'Codex-, Claude-, or other vendor-specific runtime semantics',
    );
  });

  it('publishes the complete edit guidance', () => {
    expect(sql).toContain(
      'Revise only the MODE instructions and supporting Markdown files needed for the requested behavioral change',
    );
    expect(sql).toContain(
      'preserving unrelated files and every registry-owned definition axis',
    );
    expect(sql).toContain('Write for an already capable coding agent');
    expect(sql).toContain(
      'scale specificity to the risk and consequence of deviation',
    );
    expect(sql).toContain(
      'MODE content must not restate, weaken, or replace them',
    );
    expect(sql).toContain(
      'Do not duplicate registry-owned description, applicability, discovery, or eligibility metadata in `MODE.md`',
    );
    expect(sql).toContain('skill packaging');
  });

  it('requires a Feature parent without conflating placement with applicability', () => {
    expect(parentSql).toContain('UPDATE work_item_type_template');
    expect(parentSql).toContain('UPDATE work_item_type');
    expect(parentSql).toContain(
      'allowed_parent_types = \'["FEATURE"]\'::jsonb',
    );
    expect(parentSql).toContain("'{allowedParentEntityTypes}'");
    expect(parentSql).toContain('\'["TASK"]\'::jsonb');
    expect(parentSql).toContain("'{requiresParent}'");
    expect(parentSql).toContain("'true'::jsonb");
    expect(parentSql).toContain('DEPENDS_ON');
    expect(parentSql).toContain('jsonb_array_elements_text');
    expect(parentSql).toContain("UNION\n                  SELECT 'FEATURE'");
    expect(parentSql).toContain("'{targetTypeKeys}'");
    expect(parentSql).toContain('FEATURE');
    expect(parentSql).toContain('existing MODE rows are orphaned');
    expect(parentSql).toContain(
      'parent.project_id IS DISTINCT FROM mode.project_id',
    );
    expect(parentSql).toContain(
      'parent.organization_id IS DISTINCT FROM mode.organization_id',
    );
  });

  describe('leanness as the primary rule', () => {
    const leanSql = readFileSync(leannessMigrationPath, 'utf8');

    it('prepends to canonical and active project MODE writing standards only', () => {
      expect(leanSql).toContain('UPDATE work_item_type_template AS mode');
      expect(leanSql).toContain('UPDATE work_item_type AS mode');
      expect(leanSql).toContain('mode.project_id IS NOT NULL');
      expect(leanSql).toContain("mode.lifecycle_status = 'active'");
      expect(leanSql.match(/SET writing_standards/g)).toHaveLength(2);
      expect(leanSql).toContain(
        "concat_ws(E'\\n\\n', guidance.create_standard, NULLIF(mode.writing_standards->>'create', ''))",
      );
      expect(leanSql).toContain(
        "concat_ws(E'\\n\\n', guidance.edit_standard, NULLIF(mode.writing_standards->>'edit', ''))",
      );
      expect(leanSql).not.toContain('section_definitions =');
      expect(leanSql).not.toContain('allowed_parent_types =');
      expect(leanSql).not.toContain('capabilities =');
      expect(leanSql).not.toContain('agent_guidance =');
      expect(leanSql).not.toContain('description =');
      expect(leanSql).not.toContain('UPDATE task');
    });

    it('skips rows that already carry the rule', () => {
      expect(leanSql).toContain(
        "position(guidance.create_standard IN COALESCE(mode.writing_standards->>'create', '')) = 0",
      );
      expect(leanSql).toContain(
        "position(guidance.edit_standard IN COALESCE(mode.writing_standards->>'edit', '')) = 0",
      );
    });

    it('fails clearly when the canonical MODE definition is absent', () => {
      expect(leanSql).toContain('canonical MODE template is missing');
      expect(leanSql).toContain('RAISE EXCEPTION');
    });

    it('states leanness first and tests every line against session context', () => {
      expect(leanSql).toContain(
        'Keep the MODE lean; this is its primary rule.',
      );
      expect(leanSql).toContain(
        "the system prompt, the selected work item''s feature ancestry and graph context, Project Assistant research, implementation hints, and each Service''s AGENTS.md, and the agent can find and read code on its own, so every line must supply something those do not",
      );
    });

    it('centres a MODE on what an agent would otherwise miss, plus intent when it differs', () => {
      expect(leanSql).toContain(
        'The core of most MODEs is what an agent would otherwise miss: gotchas that cost time, cross-Service traps, the in-between steps that no single feature or file reveals, and symptom-to-cause diagnosis.',
      );
      expect(leanSql).toContain(
        "When the session''s purpose differs from a default coding session, also state its intent: what it is for, what it produces, the format and quality bar of that output, the workflow that gets there, and when the work is done.",
      );
      expect(leanSql).toContain(
        '(gotchas, cross-Service traps, in-between steps that no single feature or file reveals, symptom-to-cause diagnosis)',
      );
      expect(leanSql).toContain(
        '(purpose, deliverable, output format and quality bar, workflow, done condition)',
      );
    });

    it('anchors a MODE to its features by mention and limits file references', () => {
      expect(leanSql).toContain(
        'Anchor the MODE to the features, design docs, and Contracts it covers by mention, without summarizing them, so the graph carries their current state and changes to them lead back to the MODE.',
      );
      expect(leanSql).toContain(
        'Do not map files or symbols the agent can find itself; name a file or symbol only when a gotcha cannot be stated without it',
      );
      expect(leanSql).toContain(
        'and mentions of the features, design docs, and Contracts it covers',
      );
      expect(leanSql).toContain(
        'or maps of files and symbols the agent can find itself',
      );
      expect(leanSql).not.toContain('per-Service maps of the files');
    });

    it('names what does not belong and requires verification and shrink-on-edit', () => {
      expect(leanSql).toContain(
        'Exclude restated feature requirements, design-doc decisions, Contract promises, regression matrices that restate requirements, and copies of open bug details.',
      );
      expect(leanSql).toContain(
        'it does not hold summaries of those entities, restated feature requirements, design-doc decisions, Contract promises, regression matrices that restate requirements, copies of open bug details',
      );
      expect(leanSql).toContain(
        'Whenever you touch a MODE, check that the files and symbols it names still exist and still behave as described, remove content that duplicates those sources, and replace summaries with mentions',
      );
      expect(leanSql).toContain(
        'so an edit leaves the MODE smaller or no larger than the requested change requires',
      );
    });
  });
});
