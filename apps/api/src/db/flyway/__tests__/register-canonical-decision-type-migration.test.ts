import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ENTITY_PROMPT_TEMPLATE_SELECTOR_BY_KEY,
  validateEntityPromptTemplateContent,
} from '../../../services/entity-prompt-template.service';
import { WORK_ITEM_TYPE_KEYS } from '../../../services/tasks/work-item-type-keys';

const flywayFile = (name: string) =>
  readFileSync(resolve(__dirname, '../../../../db/flyway', name), 'utf8');

const withoutComments = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

// Statement keywords only: guidance prose legitimately says "Update".
const statementKeywords = (code: string) =>
  code.replace(/'(?:[^']|'')*'/gu, "''");

const verificationStep = (proposing: string) =>
  `Required verification step: every time you propose ${proposing}, you must call \`suggest_feature_verification\` after proposing it. There is no exception, including when no code has changed and when you believe nothing is affected: the call exists because something may have been affected, and you do not get to decide it was not. Pass the most affected feature and, in the discrepancy text, list every entity that may be impacted, whatever its type (features first, but also tasks, design docs, Contracts, Mockups, Diagrams, and other Decisions). These are starting points for the verifier, not the boundary of what it checks. Tell the user the impact you found and the entities you named.`;

// The Decision definition as it is defined for projects today. The migration
// must seed exactly this, apart from the icon, which is the `decision` glyph.
const LIVE_DECISION_DEFINITION = {
  typeKey: 'decision',
  name: 'Decision',
  role: 'project-info',
  iconKey: 'decision',
  description:
    'A Decision records one deliberate project choice and the reasons and consequences that make it authoritative. Use it for a noteworthy choice the user has made that strongly affects the project. A Decision may distill an outcome from a design doc, be constrained by Contracts, and remain linked to work shaped by it. Do not infer a Decision from implementation alone: code and topology may reveal what currently exists, but they do not prove that the choice was deliberate.',
  sectionDefinitions: [
    {
      key: 'decision',
      kind: 'markdown',
      label: 'Decision',
      writingStandard:
        'State exactly one concrete choice and its intended scope. Make the choice understandable without reconstructing implementation evidence. Do not write an observation such as what the code currently uses unless the project has deliberately adopted it as authoritative.',
    },
    {
      key: 'rationale',
      kind: 'markdown',
      label: 'Rationale',
      writingStandard:
        'Explain why this choice was made and identify the material requirements, constraints, evidence, or Contracts that shaped it. Record important rejected alternatives when they clarify the boundary, but do not require ceremonial option inventories for small choices. Cite source design docs and other authoritative entities by mention rather than duplicating their contents.',
    },
    {
      key: 'consequences',
      kind: 'markdown',
      label: 'Consequences',
      writingStandard:
        'State the practical constraints and freedoms created by the choice: what subsequent work must preserve, what remains interchangeable, and any known condition that should trigger reconsideration. Distinguish consequences from implementation tasks and from provider-owned promises that belong in Contracts.',
    },
  ],
  allowedParentTypes: ['FEATURE', 'STANDARD', 'BUG'],
  edgeTargets: [
    { edgeType: 'RELATED_TO', targetTypeKeys: [] },
    { edgeType: 'DEPENDS_ON', targetTypeKeys: ['CONTRACT', 'decision'] },
    { edgeType: 'DERIVES_FROM', targetTypeKeys: [] },
    { edgeType: 'SUPERSEDES', targetTypeKeys: ['decision'] },
    {
      edgeType: 'CONTRADICTS',
      targetTypeKeys: ['FEATURE', 'CONTRACT', 'decision'],
    },
    { edgeType: 'EVOLVES', targetTypeKeys: ['decision'] },
  ],
  allowedStatuses: ['ACTIVE', 'SUPERSEDED', 'ARCHIVED'],
  requiredScalars: [],
  forbiddenScalars: ['dueDate', 'tag'],
  parentage: { allowedParentEntityTypes: ['TASK', 'DESIGN_DOC'] },
  tracking: { allowedSourceTaskTypes: [], allowedSourceEntityTypes: [] },
  agentSettableStatuses: ['ACTIVE', 'ARCHIVED'],
  anchorableReportTypes: [],
  writingStandards: {
    edit: `Preserve one atomic choice and its historical meaning. Update rationale or consequences when authoritative project intent is clarified, not merely because implementation drifted. If a new choice replaces the old one, create a successor with a successor-authored SUPERSEDES relationship rather than rewriting history or directly setting SUPERSEDED. Archive only when the record was erroneous or no longer useful and no successor replaces it. Before a material edit or a superseding successor, repeat the impact review: run at least five distinct searches and read the best hits. Reconcile mentions and typed relationships after material edits, keeping Contracts authoritative for promises, design docs authoritative for broader deliberation, and tasks authoritative for implementation work.\n\n${verificationStep('an edit to a Decision, material or not')}`,
    create: `Create one Decision per independently replaceable choice. Use a concise title that states the chosen direction, not the meeting or research activity. Complete Decision, Rationale, and Consequences with substantive but lightweight content. Consult the graph before authoring and trace what the choice affects: run at least five distinct searches (the choice itself, the features and tasks it touches, related design docs, Contracts, existing Decisions) and read the best hits. If a design doc owns the deliberation, preserve it and make the Decision derive from it; if a Contract constrains the choice, cite and link that Contract without restating its promise. Parent the Decision beneath the nearest authoritative feature or source design doc, using task parentage only for genuinely task-local choices. Add only materially accurate relationships. Do not link every entity that happens to use the implementation, and do not infer intent from code or topology alone.\n\n${verificationStep('a Decision')}`,
  },
  agentGuidance: {
    overview:
      'Use a Decision for one deliberate choice that should guide later project work and remain understandable after its original conversation is gone. Consult the nearest feature, task, design doc, Contracts, and existing Decisions before authoring. Do not reverse-engineer ambient implementation into intent. Keep design exploration in design docs, durable provider promises in Contracts, and implementation work in tasks.',
    examples: [
      {
        title: 'Technology choice',
        guidance:
          'Use PostgreSQL as the authoritative relational store is a Decision when the project deliberately adopts that choice and records why, what must treat it as authoritative, and what could justify reconsideration.',
      },
      {
        title: 'Observation is not a Decision',
        guidance:
          'The API currently imports a PostgreSQL client is implementation evidence, not proof of a deliberate project choice.',
      },
      {
        title: 'Contract boundary',
        guidance:
          'Durably store accepted endpoint data is a Contract candidate when it is a deliberately guaranteed provider-owned result. The Decision may explain why PostgreSQL was selected to fulfill that promise without making the Contract depend on PostgreSQL.',
      },
    ],
    contexts: [
      {
        focalTypeKeys: ['FEATURE'],
        guidance:
          'A Feature may own several Decisions, but a requirement is not automatically a Decision. A Decision exists only when there is a deliberate choice intended to govern the Feature or its future implementation.\n\nExamples:\n\n“Users can export their data” → requirement, not Decision.\n“Exports use an asynchronous job because synchronous generation cannot satisfy the supported data volume” → potentially a Decision, if deliberately adopted.\nA descriptive paragraph explaining current behavior → not automatically a Decision.\nThe agent should ask: Where is the choice, and where is the evidence that the project meant to adopt it?',
      },
      {
        focalTypeKeys: ['STANDARD', 'BUG'],
        guidance:
          'A task primarily consumes and implements Decisions.\n\nBefore implementation, the agent should inspect applicable active Decisions from the task’s parent context and direct relationships. It should pause when:\n\nThe task contradicts an active Decision.\nThe task relies on a superseded Decision.\nTwo applicable Decisions conflict.\nCorrect implementation requires silently overturning a Decision.\nIt must not inspect the resulting code and retroactively announce, “Apparently we decided to use this library.”\n\nA task session can still be where a Decision is made—but only when the user or an authoritative design source actually makes the choice. The task is then evidence of where the decision arose, not proof inferred from the implementation.',
      },
      {
        focalTypeKeys: ['CONTRACT'],
        guidance:
          'A Contract and Decision both require deliberate intent, but record different things:\n\nDecision: “We chose this direction.”\nContract: “Others may rely on this provider delivering this result.”\nA Contract can genuinely depend on a Decision when the Decision is part of the intended foundation of the promise—not merely its current machinery. In other cases, the Decision is only the current fulfillment strategy and the two are RELATED_TO.\n\nMost importantly, changing or superseding a Decision connected to Contracts triggers impact review. It does not automatically rewrite those Contracts. For every connected Contract, the agent must determine whether it:\n\nRemains fulfilled under the new Decision.\nRequires a different implementation to remain fulfilled.\nWould be breached by the proposed change.\nMust deliberately evolve through a separate user-reviewed change.\nA Decision change that would breach a Contract is high priority and must be raised to the user.',
      },
    ],
  },
  acceptedConfigKinds: [],
  capabilities: {
    requiresParent: true,
    planEligible: false,
    hasSetInitialStatus: false,
    rendersInline: false,
    showsInExplorerSidebar: false,
  },
  graphConfiguration: null,
};

const SQL_LITERAL = /'((?:[^']|'')*)'(::jsonb)?|NULL/gu;

// Reads the values of the single INSERT ... SELECT as { column: value }, with
// string literals unescaped and jsonb literals parsed.
const seededColumns = (sql: string): Record<string, unknown> => {
  const code = withoutComments(sql);
  const columnList = /INSERT INTO work_item_type_template \(([^)]*)\)/u.exec(
    code,
  )?.[1];
  const selectList =
    /SELECT\s+gen_random_uuid\(\),([\s\S]*?)\nWHERE NOT EXISTS/u.exec(
      code,
    )?.[1];
  if (!columnList || !selectList) {
    throw new Error('Decision migration is not a single INSERT ... SELECT');
  }
  const columns = columnList.split(',').map((column) => column.trim());
  const values = [...selectList.matchAll(SQL_LITERAL)].map((match) => {
    if (match[0] === 'NULL') return null;
    const text = match[1]!.replace(/''/gu, "'");
    return match[2] ? (JSON.parse(text) as unknown) : text;
  });
  const timestamps = [...selectList.matchAll(/CURRENT_TIMESTAMP/gu)];
  expect(timestamps).toHaveLength(2);
  const seeded = columns.filter(
    (column) =>
      column !== 'id' && column !== 'created_at' && column !== 'updated_at',
  );
  expect(values).toHaveLength(seeded.length);
  return Object.fromEntries(seeded.map((column, i) => [column, values[i]]));
};

describe('V2026.10.21.120000: register canonical Decision type', () => {
  const sql = flywayFile(
    'V2026.10.21.120000__register_canonical_decision_type.sql',
  );
  const code = withoutComments(sql);
  const seeded = seededColumns(sql);

  it('seeds the live definition, with the decision icon', () => {
    expect(seeded).toEqual({
      type_key: LIVE_DECISION_DEFINITION.typeKey,
      name: LIVE_DECISION_DEFINITION.name,
      role: LIVE_DECISION_DEFINITION.role,
      icon_key: LIVE_DECISION_DEFINITION.iconKey,
      description: LIVE_DECISION_DEFINITION.description,
      section_definitions: LIVE_DECISION_DEFINITION.sectionDefinitions,
      allowed_parent_types: LIVE_DECISION_DEFINITION.allowedParentTypes,
      edge_targets: LIVE_DECISION_DEFINITION.edgeTargets,
      allowed_statuses: LIVE_DECISION_DEFINITION.allowedStatuses,
      required_scalars: LIVE_DECISION_DEFINITION.requiredScalars,
      forbidden_scalars: LIVE_DECISION_DEFINITION.forbiddenScalars,
      parentage: LIVE_DECISION_DEFINITION.parentage,
      tracking: LIVE_DECISION_DEFINITION.tracking,
      agent_settable_statuses: LIVE_DECISION_DEFINITION.agentSettableStatuses,
      anchorable_report_types: LIVE_DECISION_DEFINITION.anchorableReportTypes,
      writing_standards: LIVE_DECISION_DEFINITION.writingStandards,
      agent_guidance: LIVE_DECISION_DEFINITION.agentGuidance,
      accepted_config_kinds: LIVE_DECISION_DEFINITION.acceptedConfigKinds,
      capabilities: LIVE_DECISION_DEFINITION.capabilities,
      graph_configuration: LIVE_DECISION_DEFINITION.graphConfiguration,
    });
  });

  it('keeps the section keys the Decisions evaluation reads, in order', () => {
    expect(
      (seeded.section_definitions as { key: string }[]).map(({ key }) => key),
    ).toEqual(['decision', 'rationale', 'consequences']);
  });

  it('keeps the verification step in both the create and edit standards', () => {
    const standards = seeded.writing_standards as Record<string, string>;
    expect(standards.create).toContain(verificationStep('a Decision'));
    expect(standards.edit).toContain(
      verificationStep('an edit to a Decision, material or not'),
    );
  });

  it('orders the contextual guidance Feature, Task and Bug, then Contract', () => {
    const { contexts } = seeded.agent_guidance as {
      contexts: { focalTypeKeys: string[] }[];
    };
    expect(contexts.map(({ focalTypeKeys }) => focalTypeKeys)).toEqual([
      ['FEATURE'],
      ['STANDARD', 'BUG'],
      ['CONTRACT'],
    ]);
  });

  it('keeps the registration key equal to the existing Decision key', () => {
    expect(seeded.type_key).toBe(WORK_ITEM_TYPE_KEYS.Decision);
  });

  it('is guarded on the canonical template table alone, so project rows never decide it', () => {
    expect((code.match(/INSERT INTO/gu) ?? []).length).toBe(1);
    expect(code).toContain(
      "WHERE NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'decision')",
    );
    expect(code).not.toMatch(/\bwork_item_type\b/u);
  });

  it('never updates, deletes or upserts', () => {
    expect(statementKeywords(code)).not.toMatch(/\b(UPDATE|DELETE)\b/iu);
    expect(statementKeywords(code)).not.toMatch(/ON\s+CONFLICT/iu);
  });
});

describe('V2026.10.21.120100: publish canonical Decision entity prompt template', () => {
  const sql = flywayFile(
    'V2026.10.21.120100__publish_canonical_decision_entity_prompt_template.sql',
  );
  const code = withoutComments(sql);
  const templateKey = 'entity_context.work_item.decision';

  it('publishes the selector registered for the Decision key', () => {
    const selector = /'(\{"entityType":"WORK_ITEM"[^']*\})'::jsonb/u.exec(
      code,
    )?.[1];
    expect(JSON.parse(selector ?? 'null')).toEqual(
      ENTITY_PROMPT_TEMPLATE_SELECTOR_BY_KEY[templateKey],
    );
    expect(code).toContain(`'${templateKey}',\n  '{`);
  });

  it('publishes one canonical valid V1 revision, skipped once one is published', () => {
    expect((code.match(/INSERT INTO/gu) ?? []).length).toBe(1);
    expect(code).toContain("'CANONICAL',\n  'PUBLISHED',\n  'VALID',");
    expect(code).toMatch(
      new RegExp(
        `WHERE NOT EXISTS \\(\\s*SELECT 1\\s*FROM entity_prompt_template_revisions\\s*WHERE template_key = '${templateKey}'\\s*AND ownership_scope = 'CANONICAL'\\s*AND lifecycle_state = 'PUBLISHED'`,
        'u',
      ),
    );
  });

  it('has content that passes the V1 template language', () => {
    const content = (/\+ 1,\s*E'([^']+)'/u.exec(code)?.[1] ?? '').replace(
      /\\n/gu,
      '\n',
    );
    expect(content).toContain('\n## Decision\n');
    expect(validateEntityPromptTemplateContent(content, 'V1')).toEqual([]);
  });

  it('leaves project-owned revisions untouched', () => {
    expect(statementKeywords(code)).not.toMatch(/\b(UPDATE|DELETE)\b/iu);
    expect(statementKeywords(code)).not.toMatch(/ON\s+CONFLICT/iu);
    expect(code).not.toContain("'PROJECT'");
  });
});
