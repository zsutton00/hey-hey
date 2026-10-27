/**
 * Long-form, agent-facing guidance for MCP tools whose `@Tool` description
 * is intentionally short. Agents should call `get_tool_guidance(toolName)`
 * to fetch the body before invoking the underlying tool.
 *
 * Adding a new entry is purely a content addition: declare the body and a
 * one-line `description`, and the `get_tool_guidance` zod-enum input will
 * pick up the new key automatically.
 */
import type {
  WorkItemTypeRegistryService,
  WorkItemTypeRules,
} from '../../services/tasks/work-item-type-registry.service';
import { WorkStatus } from '../../generated/model/workStatus';
import { AGENT_EDGE_TYPES } from './agent-edge-vocabulary';
import {
  CREATE_WORK_ITEM_TYPE_AUTHORING_AXES,
  CREATE_WORK_ITEM_TYPE_CAPABILITY_AXES,
  WORK_ITEM_TYPE_PARENTAGE_GUIDANCE,
} from './work-item-type-proposal-tools.provider';
import {
  CREATE_WORK_ITEM_TYPE_GUESS_LEAD_INS,
  CREATE_WORK_ITEM_TYPE_REVIEW_INSTRUCTION,
  CREATE_WORK_ITEM_TYPE_REVIEW_QUESTIONS,
} from './work-item-type-review-contract';
import {
  isWorkItemServiceScopeEligible,
  WORK_ITEM_SERVICE_SCOPE_GUIDANCE,
} from '../../services/tasks/work-item-service-scope-policy';

const MATERIAL_CONTEXT_PRESERVATION_RULE = (authoredType: string): string =>
  `Carry every material decision, constraint, rationale, and implementation detail established in the current conversation into the authored ${authoredType}; future consumers may not have access to the conversation.`;

const EXAMPLE_USE_GUIDANCE =
  'Examples may be used when they clarify a consequential authoring distinction.';

const appendExampleUseGuidance = (body: string): string =>
  [body, '', EXAMPLE_USE_GUIDANCE].join('\n');

const appendAuthoringContextRule = (
  body: string,
  authoredType: string,
): string =>
  [
    body,
    '',
    MATERIAL_CONTEXT_PRESERVATION_RULE(authoredType),
    '',
    EXAMPLE_USE_GUIDANCE,
  ].join('\n');

const PLAN_SCOPE_AND_JUDGMENT_GUIDANCE = `## Plan scope and judgment

Write the plan needed to deliver the user's requested outcome within the existing project. Do not expand the product or technical design merely to make the plan more comprehensive, robust, or future-proof.

### Authority and grounding
- Establish scope from the user's request, explicit decisions and corrections, and applicable existing requirements.
- Inspect relevant project context before claiming a capability exists or deciding that new machinery is needed.
- Your authored journey, design prose, and acceptance criteria cannot authorize one another. Repeating an agent suggestion in another artifact does not establish that the user requested it.

### Handling missing information
- Use existing behavior and conventions when they answer the question.
- Leave local implementation details to implementation when they do not change the requested behavior, required work, or an existing obligation.
- Omit optional improvements. Do not ask the user to decide whether to include every conceivable enhancement.
- Ask when a missing answer prevents accurate planning because different answers materially change behavior, scope, or required work. First check available context, then explain the concrete consequence of the choice.

### Required detail
Describe the work, established ownership, dependencies, necessary integration boundaries, and observable outcomes. Include enough detail to coordinate implementation; do not require every implementation choice to be settled. A new mechanism needs a demonstrated connection to the requested outcome or an applicable constraint. A hypothetical future problem is insufficient justification.

### Before submitting
Check every material addition against the original scope and applicable requirements. If omitting it would still fulfill those requirements, omit it. Acceptance criteria must summarize authorized outcomes, not introduce stronger guarantees. On edits, preserve unaffected grounded decisions, but remove or revise unsupported assumptions and their downstream consequences when scope is corrected. Preserve the document's structure without entrenching its mistakes. Carry material grounded decisions and rationale into the document so future consumers do not need the conversation.

### Examples — do not generalize these into technology bans

Technical: A user asks to download filtered order history as CSV. The application already supports filtered queries and file downloads. Do not add an export service, queue, job lifecycle, cleanup scheduler, and email delivery because exports might become large. Use the existing paths. If investigation establishes a concrete limit, address that demonstrated constraint.

Product: A user asks to save restaurant dishes as favorites and revisit them. Accounts and a dish catalog already exist. Do not add taste profiling, recommendations, alerts, or a weekly digest because they might improve engagement. Plan saving, removing, and revisiting favorites; follow existing interface conventions for incidental details.`.split(
  '\n',
);

/**
 * Backticked, comma-joined render of the canonical agent edge vocabulary,
 * inlined into the proposal-edges guidance below so adding or retiring a
 * type in {@link AGENT_EDGE_TYPES} updates the rendered guidance with no
 * separate edit here.
 */
const AGENT_EDGE_VOCAB_FRAGMENT = AGENT_EDGE_TYPES.map((t) => `\`${t}\``).join(
  ', ',
);

const CREATE_WORK_ITEM_TYPE_AUTHORING_AXES_FRAGMENT =
  CREATE_WORK_ITEM_TYPE_AUTHORING_AXES.map((axis) => `\`${axis}\``).join(', ');

const CREATE_WORK_ITEM_TYPE_CAPABILITY_AXES_FRAGMENT =
  CREATE_WORK_ITEM_TYPE_CAPABILITY_AXES.map((axis) => `\`${axis}\``).join(', ');

const CREATE_WORK_ITEM_TYPE_REVIEW_QUESTIONNAIRE_FRAGMENT =
  CREATE_WORK_ITEM_TYPE_REVIEW_QUESTIONS.flatMap(
    ({ title, prompt, exampleGuess }, index) => [
      `### ${index + 1}. ${title}`,
      '',
      `**Question:** ${prompt}`,
      '',
      `> **${CREATE_WORK_ITEM_TYPE_GUESS_LEAD_INS[index % CREATE_WORK_ITEM_TYPE_GUESS_LEAD_INS.length]!}:** ${exampleGuess}`,
      '',
    ],
  ).join('\n');

/**
 * Resolved guidance surface for the generic create_work_item / edit_work_item
 * tools. `forType` assembles one type's authoring contract on demand from the
 * work-item type registry (section schema, required/forbidden scalars, writing
 * standards) for any registry key — built-in or project-defined custom — rather
 * than a precomputed map of only the built-ins. `noWorkItemType` is the
 * omitted-type overview.
 */
export interface WorkItemGuidanceBody {
  /**
   * Assemble the authoring contract for a single type by key in the active
   * project snapshot. The provider gates unknown and archived keys to the
   * shared valid-types error before calling, so a miss here is a programming
   * error, not a user one.
   */
  forType(typeKey: string, projectId: string): string;
  noWorkItemType: string;
}

/**
 * Lazy builder for the work-item guidance bodies. The per-type contract is
 * drawn from the registry snapshot, which only exists at request time —
 * so the body is a function the provider invokes per call with the injected
 * registry, not a value baked in at module load.
 */
export type WorkItemGuidanceBuilder = (
  registry: WorkItemTypeRegistryService,
) => WorkItemGuidanceBody;

export type ToolGuidanceBody = string | WorkItemGuidanceBuilder;

/**
 * Shared summary used by the long-form edit guidance and the generic edit
 * tool descriptions. Keep this sentence as the canonical policy summary so
 * agents see the same lifecycle distinctions regardless of which surface they
 * read first.
 */
export const LIFECYCLE_AWARE_TASK_EDIT_SAFETY_SUMMARY =
  'For an effective type with registry role `work-item` (normally `STANDARD` or `BUG`), apply status-aware safety only to section content that records what the work does or did: check status before editing sections.';

const STANDARD_TASK_DEPENDENCY_GUIDANCE =
  'When authoring multiple tasks, declare a `DEPENDS_ON` edge in `edges` when one task cannot proceed without another; authoring or ordering tasks together alone does not establish a dependency.';

const FLOW_RELATIONSHIP_VARIANT_GUIDANCE = [
  '',
  '## Flow relationship variants',
  '',
  'Choose the flow relationship variant with `edgeType`. `LOOP` is a relationship variant, not a direction value. Do not put `LOOP` in `direction`; STANDARD and CONDITIONAL use `direction: "forward"` or `direction: "backward"`, while LOOP omits `direction`.',
  '',
  '### `STANDARD`',
  '',
  'Requires `category: "flow"` and `direction`; STANDARD forbids a predicate, so omit `predicate`.',
  'Valid:',
  '```json',
  '{',
  '  "op": "relationship.create",',
  '  "ref": { "refType": "temporary", "tempId": "standard-link" },',
  '  "source": { "refType": "existing", "id": "<source-id>" },',
  '  "target": { "refType": "existing", "id": "<target-id>" },',
  '  "edgeType": "STANDARD",',
  '  "category": "flow",',
  '  "direction": "forward"',
  '}',
  '```',
  'Invalid: adding `predicate` to STANDARD is rejected; omitting `direction` is also invalid.',
  '```json',
  '{ "edgeType": "STANDARD", "category": "flow", "direction": "forward", "predicate": "approved" }',
  '```',
  '',
  '### `CONDITIONAL`',
  '',
  'Requires `category: "flow"` and `direction`; CONDITIONAL requires a predicate, and it must be non-blank.',
  'Valid:',
  '```json',
  '{',
  '  "op": "relationship.create",',
  '  "ref": { "refType": "temporary", "tempId": "conditional-link" },',
  '  "source": { "refType": "existing", "id": "<source-id>" },',
  '  "target": { "refType": "existing", "id": "<target-id>" },',
  '  "edgeType": "CONDITIONAL",',
  '  "category": "flow",',
  '  "direction": "forward",',
  '  "predicate": "approved == true"',
  '}',
  '```',
  'Invalid: omitting `predicate` (or omitting `direction`) is rejected.',
  '```json',
  '{ "edgeType": "CONDITIONAL", "category": "flow", "direction": "forward" }',
  '```',
  '',
  '### `LOOP`',
  '',
  'Requires `category: "flow"` and omits `direction`. LOOP accepts a predicate optionally: both a predicate-free LOOP and a predicate-bearing LOOP are valid.',
  'Valid with an optional predicate:',
  '```json',
  '{',
  '  "op": "relationship.create",',
  '  "ref": { "refType": "temporary", "tempId": "retry-loop" },',
  '  "source": { "refType": "existing", "id": "<source-id>" },',
  '  "target": { "refType": "existing", "id": "<target-id>" },',
  '  "edgeType": "LOOP",',
  '  "category": "flow",',
  '  "predicate": "attempts < 3"',
  '}',
  '```',
  'Valid without a predicate: keep the same shape and omit `predicate`.',
  'Invalid: adding `direction` to LOOP is rejected; do not encode LOOP as `direction: "LOOP"`.',
  '```json',
  '{ "edgeType": "LOOP", "category": "flow", "direction": "forward" }',
  '```',
].join('\n');

export interface ToolGuidanceEntry {
  /** One-line human-readable summary, surfaced in the tool catalog. */
  description: string;
  /** Long-form prompt body the calling agent should read in full. */
  body: ToolGuidanceBody;
}

/**
 * Assemble the per-type authoring contract for the generic work-item
 * tools. Everything in the body is drawn from the work-item type registry —
 * the type's section schema, its required and forbidden scalars, its
 * parentage rules, and its long-form writing standards — so a new type
 * needs a registry entry, not new guidance wiring.
 *
 * Returns a lazy builder rather than a value: the registry snapshot only
 * exists at request time, so the provider invokes this per call with the
 * injected registry instead of binding against a module-load constant.
 */
function buildWorkItemGuidanceBody(
  mode: 'create' | 'edit',
): WorkItemGuidanceBuilder {
  const toolName = mode === 'create' ? 'create_work_item' : 'edit_work_item';

  const lifecycleAwareEditSafetyGuidance = (
    cfg: WorkItemTypeRules,
  ): string[] => {
    const lifecycleStatuses = [
      WorkStatus.Active,
      WorkStatus.Verifying,
      WorkStatus.Completed,
    ];
    const exposesLifecycle =
      cfg.role === 'work-item' &&
      lifecycleStatuses.every((status) => cfg.allowedStatuses.includes(status));

    return mode === 'edit' && exposesLifecycle
      ? [
          '',
          '## Work-item section edit safety',
          '',
          LIFECYCLE_AWARE_TASK_EDIT_SAFETY_SUMMARY,
          '',
          '`ACTIVE` is ambiguous. Unless recent context establishes that',
          'implementation has not begun, ask the user before editing sections.',
          '',
          '`VERIFYING`: ask the user before editing sections.',
          '',
          '`COMPLETED`: do not edit sections unless the user instructs you to.',
        ]
      : [];
  };

  // Element-sourced links to entities outside the Diagram, as the
  // project-effective graph capability declares them.
  const diagramElementLinkTypes = (cfg: WorkItemTypeRules): string[] =>
    Array.from(
      new Set(
        (cfg.graph?.editableRelationships ?? [])
          .filter(
            (relationship) =>
              relationship.sourceEndpoint.role === 'graphNode' &&
              relationship.targetEndpoint.role === 'externalEntity',
          )
          .map((relationship) => relationship.edgeType),
      ),
    );

  // Mechanics only; the meaning of each group kind lives in the type's
  // writing standards so create and edit read one semantic source.
  const graphGroupsGuidance = (cfg: WorkItemTypeRules): string[] => {
    const groups = cfg.graph?.groups;
    if (!groups) return [];
    return [
      '',
      'Optional groups and nested boundaries are stored in the declared `' +
        groups.sectionKey +
        '` section.',
      'Replace the complete value with `section.replace` on the graph root;',
      'members use `{ kind: "persistedWorkItem", workItemId }` or',
      '`{ kind: "temporaryWorkItem", temporaryRef }` and must be elements of',
      'this graph. Group edits never move saved positions; do not send',
      'coordinates for groups.',
    ];
  };

  const diagramCreatePayloadGuidance = (
    typeKey: string,
    cfg: WorkItemTypeRules,
  ): string[] =>
    mode === 'create' && typeKey === 'DIAGRAM'
      ? [
          '',
          '## Initial Diagram graph payload',
          '',
          'Use `diagramElements` for every initial Diagram Element. Each entry',
          'declares a proposal-scoped `tempId`, name, registry-declared sections,',
          'and optional scalar fields. The server fixes the child type to',
          '`DIAGRAM_ELEMENT` and structural parent to the new Diagram; do not',
          'repeat either value in the element payload.',
          '',
          'Supply one DIAGRAM root `workItem.create` in `operations`. Author',
          'flow relationships with `relationship.create` operations and reference',
          'an element with `{ refType: "temporary", tempId }` using exactly',
          'the same `tempId` declared in `diagramElements`. These identities',
          'remain stable through proposal projection and are resolved to real',
          'work-item IDs during approval and materialization.',
          '',
          'Use the project-effective Diagram graph capability for allowed',
          'relationship types, endpoint roles, direction, predicate, and',
          'metadata rules. The complete root, elements, sections, relationships,',
          'and layout are projected and validated before proposal persistence.',
          FLOW_RELATIONSHIP_VARIANT_GUIDANCE,
          '',
          '`graphLayout` is optional authored-layout state. Use a',
          '`layout.replace` operation and `layoutBoundary` when positions are',
          'authored; omit both when consumers should compute automatic layout.',
          'Do not send an empty placeholder or put graph layout in prose.',
          ...graphGroupsGuidance(cfg),
          '',
          'Do not use outer `edges` for Diagram-internal relationships. Keep',
          'those relationships in the graph operation set; proposal-level',
          'links are declared separately in `edges`.',
          '',
          '## Linking Diagram Elements to the project',
          '',
          "Declare every link from an element in that element's",
          '`diagramElements[].edges` entry: `{ edgeType, targetEntityType,',
          'targetEntityId, description? }`. Use `targetEntityType: "TASK"` for an',
          'existing work item; the link is created when the Diagram is approved.',
          'Use `targetEntityType: "PROPOSAL"` for a same-project CREATE proposal',
          'from this round; the link is created from the element when that',
          'proposal is approved. Do not repeat the element identity elsewhere.',
          '',
          ...(diagramElementLinkTypes(cfg).length > 0
            ? [
                `Element link types in this project: ${diagramElementLinkTypes(cfg).join(', ')}.`,
              ]
            : []),
          'Informational links such as RELATED_TO connect an element to an',
          'artifact that explains it, such as a Mockup or a more detailed',
          "Diagram. GUARANTEES, IMPLEMENTS and CONSUMES record the element's",
          'responsibility for a CONTRACT; never use DEPENDS_ON for Contract',
          'participation. FULFILLED_BY points at the existing work item that',
          'implements the element. SUPERSEDES is not an element link. The',
          'project registry checks each link type against the target type, and',
          'every invalid link is reported by element before the proposal is',
          'saved. The type guidance below explains when each link applies.',
        ]
      : [];

  const diagramProposalEdgeGuidance = (typeKey: string): string[] =>
    typeKey !== 'DIAGRAM'
      ? []
      : mode === 'create'
        ? [
            '',
            '## Links from the whole Diagram',
            '',
            'Use outer `edges` only for links from the Diagram itself, such as a',
            'deferred ENTITY-mode link to a same-project CREATE proposal that has',
            'not been rejected. Links from a Diagram Element belong in its',
            '`diagramElements[].edges` entry.',
          ]
        : [
            '',
            '## Links from a Diagram to another proposal',
            '',
            'Use outer `edges` for a deferred ENTITY-mode link to another',
            'proposal. The target must be a same-project CREATE proposal that',
            'has not been rejected. `sourceRef` may identify a Diagram Element',
            'in this projected change set with `{ refType: "temporary",',
            'tempId }`, or an existing Diagram Element with `{ refType:',
            '"existing", id }`. Omit `sourceRef` to use the Diagram root.',
            'The project registry checks the source-to-target type and edge',
            'combination before the proposal is saved.',
            '',
            'Only PROPOSAL targets accept `sourceRef`. Links to existing TASK',
            'or DESIGN_DOC entities stay in `operations`. Durable',
            '`endpointMode: "PROPOSAL"` links continue to connect proposal',
            'identities and do not carry `sourceRef`.',
          ];

  const standardTaskDependencyGuidance = (typeKey: string): string[] =>
    typeKey === 'STANDARD' ? ['', STANDARD_TASK_DEPENDENCY_GUIDANCE] : [];

  const planStageCreateDependencyGuidance = (typeKey: string): string[] =>
    mode === 'create' && typeKey === 'PLAN_STAGE'
      ? [
          '',
          '## Ordering multiple Plan Stages',
          '',
          'Plan Stages may be authored as independent SINGLE proposals; a',
          'proposal group is not required. Their order is still mandatory graph',
          'state: every Stage after the first must declare one `DEPENDS_ON` edge',
          'to its immediate predecessor in its own `create_work_item` call.',
          '',
          'Create the predecessor first. Read its exact',
          '`structuredContent.proposalId` response field, then create the next',
          'Stage with:',
          '```json',
          JSON.stringify(
            {
              edges: [
                {
                  edgeType: 'DEPENDS_ON',
                  targetEntityType: 'PROPOSAL',
                  targetEntityId: '<predecessor proposalId>',
                  description:
                    'This Stage follows the immediately preceding Stage.',
                },
              ],
            },
            null,
            2,
          ),
          '```',
          '',
          'Use `proposalId`, not `id` or the nil `targetEntityId` returned for',
          'the not-yet-materialized Task. `targetEntityType: "PROPOSAL"` defers',
          'the relationship until both independent proposals are approved. Do',
          'not omit the edge when the predecessor is still only a proposal.',
          '',
          'Before finishing a multi-Stage authoring turn, verify that the first',
          'Stage has no Stage prerequisite and every later Stage proposal carries',
          'exactly one immediate-predecessor `DEPENDS_ON` declaration.',
        ]
      : [];

  const graphEditGuidance = (cfg: WorkItemTypeRules): string[] => {
    if (mode !== 'edit' || !cfg.graph) return [];
    const relationships = cfg.graph.editableRelationships
      .map((relationship) => relationship.edgeType)
      .join(', ');
    return [
      '',
      '## Generic graph change-set editing',
      '',
      'Use `operations` to propose node, section, relationship, and layout',
      'changes atomically. Existing work items and relationships use',
      '`{ refType: "existing", id }`; creates use proposal-scoped',
      '`{ refType: "temporary", tempId }` identities that later operations',
      'may reference in the same request.',
      '',
      `Supported graph actions: ${cfg.graph.supportedActions.join(', ')}.`,
      `Editable relationship types: ${relationships || 'none'}.`,
      '',
      'Read the current graph before composing an edit. Reuse each returned',
      'persisted work-item `id` for an existing node and each returned',
      'persisted relationship `id` for an existing edge. Names are labels and',
      'collision checks, never identity selectors; do not recreate an existing',
      'node because its name matches.',
      '',
      'Relationship operations:',
      '- `relationship.create` uses a temporary relationship identity and',
      '  declares source, target, edgeType, and any declared metadata. Use a',
      '  temporary identity only for a relationship created in this request.',
      '- `relationship.update` changes relationship fields without moving its',
      '  endpoints. Changing source or target is a reconnection and requires',
      '  the reconnectRelationship action; explicitly update the persisted',
      '  relationship rather than creating a parallel replacement.',
      '- `relationship.delete` accepts either an existing or temporary',
      '  relationship identity. Delete the persisted relationship being removed',
      '  before adding any replacement relationship.',
      ...(cfg.graph.editableRelationships.some((relationship) =>
        ['STANDARD', 'CONDITIONAL', 'LOOP'].includes(relationship.edgeType),
      )
        ? [FLOW_RELATIONSHIP_VARIANT_GUIDANCE]
        : []),
      '',
      'Layout is stored in the declared `' +
        cfg.graph.layout.sectionKey +
        '` section.',
      'Use `layout.replace` with the complete set of positioned entries and',
      'pass `layoutBoundary` as the complete set of identities expected in',
      'that layout, reusing the same persisted or temporary identity for each',
      'entry. Use `layout.clear` to remove the layout section entirely.',
      'Temporary work-item identities must be declared by a workItem.create',
      'operation in this change set; unknown, cross-root, duplicate, and',
      'unresolved references are rejected before proposal persistence.',
      'Do not send `' +
        cfg.graph.layout.sectionKey +
        '` as prose in `sections`;',
      'layout replacement and clearing are graph operations.',
      ...graphGroupsGuidance(cfg),
      '',
      'Keep graph relationships in the operation set. Outer proposal `edges`',
      'remain separate and do not alter the projected graph.',
    ];
  };

  const tracksCreateGuidance =
    mode === 'create'
      ? [
          '',
          '## Compound TRACKS attachment',
          '',
          'When the new work item must be tracked by an existing tracking-source',
          'work item, pass `tracks: { sourceEntityId }` on this same',
          '`create_work_item` call. The server resolves the source type and',
          'checks its registry-configured target allow-list before persisting',
          'the proposal. `tracks.sourceEntityId` does not replace',
          '`parentTaskId`: when the new type requires a parent, set',
          '`parentTaskId` to the feature or task that structurally owns the',
          'new work, not to a goal-like tracking source that cannot have',
          'children. Use `attach_to_goal` only when the target entity already',
          'exists.',
        ]
      : [];

  const supersedesGuidance = (
    registry: WorkItemTypeRegistryService,
    projectId: string,
  ): string[] => {
    const typeKeys = registry.getActiveTypeKeys(projectId).sort();
    const eligible: string[] = [];
    const ineligible: string[] = [];

    for (const typeKey of typeKeys) {
      const rules = registry.getRulesForProject(typeKey, projectId);
      if (!rules) continue;
      const destination = rules.allowedStatuses.includes(WorkStatus.Superseded)
        ? eligible
        : ineligible;
      destination.push(typeKey);
    }

    return [
      '',
      '## SUPERSEDES declarations',
      '',
      '`SUPERSEDES` is successor-authored: point the declaration at the',
      'predecessor work item being replaced. The predecessor must have',
      '`SUPERSEDED` in its registry-resolved allowed-status policy.',
      '',
      `- Eligible predecessor types: ${eligible.join(', ')}.`,
      `- Ineligible predecessor types: ${ineligible.join(', ')}.`,
      '',
      `${ineligible.join(' and ')} predecessors cannot be targeted by`,
      '`SUPERSEDES`. Choose the relationship or lifecycle action that matches',
      'the actual case instead. Eligible declarations against',
      `${eligible.join(' and ')} predecessors remain successor-authored.`,
    ];
  };

  const assembleContract = (
    typeKey: string,
    cfg: WorkItemTypeRules,
    registry: WorkItemTypeRegistryService,
    projectId: string,
  ): string => {
    const required: string[] = [];
    if (mode === 'create') {
      required.push('name');
      if (cfg.requiresParent) required.push('parentTaskId');
      required.push(...cfg.requiredScalars);
    }

    const notAccepted: string[] = [...cfg.forbiddenScalars];
    if (registry.getAllowedParentTypes(typeKey, projectId).length === 0) {
      notAccepted.push('parentTaskId');
    }

    const serviceScopeGuidance =
      isWorkItemServiceScopeEligible(cfg) &&
      !cfg.writingStandards[mode].includes('## Complete known service scope')
        ? [WORK_ITEM_SERVICE_SCOPE_GUIDANCE]
        : [];

    const sectionContentLines = cfg.sectionDefinitions.flatMap((section) => {
      const sectionMetadata = [
        `- Section \`${section.key}\` is labeled \`${section.label}\`.`,
        ...(section.writingStandard
          ? [`  Section writing standard: ${section.writingStandard}`]
          : []),
      ];
      if (section.kind === 'html/css') {
        const profiles = section.sizeProfiles;
        const sizingGuidance = profiles?.length
          ? ` Available sizeKey values: ${profiles.map(({ key, label }) => `\`${key}\` (${label})`).join(', ')}; default: \`${section.defaultSizeKey}\`.`
          : ' This legacy definition has no configured size profiles; omit sizeKey.';
        return [
          ...sectionMetadata,
          `- Section \`${section.key}\` uses \`kind: html/css\`: send exactly ` +
            '`{ html: string, css: string, sizeKey?: string }`; empty CSS is valid and `schemaRef` is omitted.' +
            sizingGuidance +
            ' Never embed raw width or height values in item content.',
          '  Give every intentionally addressable semantic element a unique, stable, non-empty `data-hh-id` value. Preserve that value across revisions while the same conceptual element remains; remove or replace it when that conceptual identity ends.',
        ];
      }
      if (section.kind === 'structured-mockup') {
        const profiles = section.sizeProfiles;
        const sizingGuidance = profiles?.length
          ? ` Available sizeKey values: ${profiles.map(({ key, label }) => `\`${key}\` (${label})`).join(', ')}; default: \`${section.defaultSizeKey}\`.`
          : ' This definition has no configured size profiles; omit sizeKey.';
        return [
          ...sectionMetadata,
          `- Section \`${section.key}\` uses \`kind: structured-mockup\`: send one ` +
            '`{ schemaVersion: "work-item-structured-mockup.v3" | "work-item-structured-mockup.v4" | "work-item-structured-mockup.v5", revision: positiveInteger, content: Component[], annotations: Annotation[], sizeKey?: string }` document.' +
            sizingGuidance,
          '  V3 component kinds are `text`, `button`, `input`, `card`, `rectangle`, `divider`, `image-placeholder`, `row`, and `column`; v4 adds `slot`, `icon`, and `mockup-occurrence`; v5 adds `caret` and `shape` plus semantic and appearance properties.',
          '  Every component has strict `props` with a unique non-empty `id`, `width: { mode: "fit" | "fill" | "fixed", value?: positiveInteger }`, and `height: { mode: "content" | "fixed", value?: positiveInteger }`; `value` is present only for `fixed`.',
          '  Text uses `text` and optional `variant: "body" | "heading" | "caption" | "label" | "badge"`; button uses `label`; input uses `label`, `placeholder`, optional `value`, and optional boolean `multiline` (set true for writing areas; omitted values containing newlines also render multiline); card/rectangle may use `label`; image-placeholder uses `altText`; divider has no additional props.',
          '  Row and column components also carry ordered `children`, plus non-negative integer `gap` and `padding`, independent `justify: "start" | "center" | "end" | "spread"` for main-axis distribution, and `align: "start" | "center" | "end" | "stretch"` for cross-axis positioning. Optional `surface: "plain" | "panel" | "muted" | "dashed"` gives containers a host-owned treatment; omission means plain. Use panel or dashed containers when a card or upload area needs editable children. Nest only through row/column children. Never send renderer code, HTML, CSS, JavaScript, URLs, or unknown properties.',
          '  Preserve the reference composition before simplifying decoration: map major panels to a row, preserve their relative widths using fixed dimensions within the selected canvas, then nest headers, writing areas, upload areas, and footers. Do not flatten a multi-panel reference into one centered column. Preserve visible copy, badges, and footer labels; use heading/caption/label/badge text roles deliberately. A notes-and-documents reference should retain its approximately 2:1 notes/upload split, multiline writing area, Editable badge, and both footer labels.',
        ];
      }
      if (section.kind === 'json' || typeof section.schemaRef === 'string') {
        return [
          ...sectionMetadata,
          `- Section \`${section.key}\` uses schema-backed JSON content` +
            (section.schemaRef ? ` (${section.schemaRef}).` : '.'),
        ];
      }
      return sectionMetadata;
    });

    const contractLines = [
      `# ${toolName} (${typeKey}) — agent guidance`,
      '',
      '## Authoring contract (from the work-item type registry)',
      '',
      `- Allowed section keys: ${cfg.sections.join(', ')}.`,
      ...sectionContentLines,
      required.length > 0
        ? `- Required fields: ${required.join(', ')}.`
        : '- Required fields: none beyond targetEntityId and at least one change.',
      `- Accepted launch-config kinds: ${
        cfg.acceptedConfigKinds.length > 0
          ? cfg.acceptedConfigKinds.join(', ')
          : 'none'
      }. This policy is explicit; do not infer it from the type key, role, or capabilities.`,
      ...(notAccepted.length > 0
        ? [`- Not accepted for this type: ${notAccepted.join(', ')}.`]
        : []),
    ];

    const editModeGuidance =
      mode === 'edit'
        ? [
            '',
            '## Prefer updating over appending',
            '',
            'Prefer updating over appending unless the change truly only adds.',
            "Rewrite to the current state, don't narrate the diff from a prior",
            'version.',
            ...lifecycleAwareEditSafetyGuidance(cfg),
          ]
        : [];

    return appendAuthoringContextRule(
      [
        contractLines.join('\n'),
        ...editModeGuidance,
        ...tracksCreateGuidance,
        ...supersedesGuidance(registry, projectId),
        ...diagramCreatePayloadGuidance(typeKey, cfg),
        ...planStageCreateDependencyGuidance(typeKey),
        ...graphEditGuidance(cfg),
        ...diagramProposalEdgeGuidance(typeKey),
        ...standardTaskDependencyGuidance(typeKey),
        ...serviceScopeGuidance,
        '',
        cfg.writingStandards[mode],
      ].join('\n'),
      `${typeKey} work item`,
    );
  };

  const noWorkItemType = [
    `# ${toolName} — agent guidance`,
    '',
    `\`${toolName}\` covers every work-item type. Call`,
    `\`get_tool_guidance({ toolName: "${toolName}", workItemType })\` with`,
    "the type you are authoring to get that type's sections, required",
    'fields, and writing standards. The built-in types:',
    '',
    '- **STANDARD** — a unit of implementation work; requires parentTaskId.',
    '- **FEATURE** — a durable product deliverable; requires tag.',
    '- **GOAL** — a time-bound outcome statement; requires dueDate, always top-level.',
    '- **BUG** — a defect report.',
    '- **CONTRACT** — a feature-parented agreement marker for cross-boundary contracts.',
    '- **DIAGRAM** — a graph-shaped design artifact. For initial children, use canonical `diagramElements` (each carrying its own links in `edges`) plus graph `operations` for flow relationships and layout.',
    '- **DIAGRAM_ELEMENT** — a semantic element placed inside a Diagram.',
    '- **MODE** — a project-owned coding-agent behavior bundle with a catalog description and validated text-file bundle.',
    '- **workflow** — a graph-shaped workflow container. For initial children, use `workflowSteps` (aliases: `steps`, `children`) and `workflowLinks` (aliases: `flowLinks`, `flowEdges`).',
    '- **workflow_step** — a leaf step inside a workflow.',
    '',
    'A project may also define custom types; pass a custom type key the same way.',
  ].join('\n');

  return (registry) => ({
    forType: (typeKey: string, projectId: string): string => {
      const cfg = registry.getRulesForProject(typeKey, projectId);
      if (!cfg) {
        throw new Error(
          `No work-item type rules for '${typeKey}'` +
            ` in project ${projectId}` +
            '; unknown or archived keys must be gated before assembly.',
        );
      }
      return assembleContract(typeKey, cfg, registry, projectId);
    },
    noWorkItemType,
  });
}

export const TOOL_GUIDANCE = {
  create_work_item_type: {
    description:
      'Complete configuration contract and writing discipline for create_work_item_type.',
    body: appendExampleUseGuidance(
      [
        '# create_work_item_type — agent guidance',
        '',
        '## Required review round',
        '',
        'Before calling `create_work_item_type`, send one review message containing',
        'every question below exactly once and in this order. Do not split the set',
        'across turns or omit a question because the request appears complete.',
        '',
        'Under each exact question, add one Markdown blockquote containing a concise',
        'proposed answer inferred from the request, relevant graph context, analogous',
        'built-in types, and project conventions. Use a natural lead-in such as',
        '`It sounds like`, `My read is`, `Based on your description`, or another',
        'clear phrase; do not repeat one mechanical label for every answer.',
        'The sample guesses shown below demonstrate useful specificity only. Never',
        'copy them as canned answers. Replace every sample with your real inference',
        'for the requested type and make that inference directly reviewable.',
        'Replace `$customType` with the proposed display name in the two questions',
        'that use it. Follow the Markdown format shown so questions and proposed',
        'answers are visually distinct.',
        '',
        CREATE_WORK_ITEM_TYPE_REVIEW_QUESTIONNAIRE_FRAGMENT,
        CREATE_WORK_ITEM_TYPE_REVIEW_INSTRUCTION,
        '',
        'End the review message with that exact instruction, then stop and wait for',
        "the user's reply. Do not call `create_work_item_type` in the same turn. The",
        'user may approve the whole set or correct any proposed answer. Apply those',
        'corrections before translating the reviewed product brief into configuration.',
        '',
        'This fixed review replaces improvised follow-up questions. Do not add another',
        'question merely because a schema field was not discussed. Never show raw',
        'field names, enum names, empty-array semantics, or an axis-by-axis configuration',
        'summary unless the user explicitly requests implementation detail.',
        '',
        '## Internal translation contract',
        '',
        `The live proposal schema exposes: ${CREATE_WORK_ITEM_TYPE_AUTHORING_AXES_FRAGMENT}.`,
        '',
        '- **Identity and presentation:** `key` is the stable immutable registry',
        '  key; `name`, `iconKey`, `colorKey`, and `description` define the user-facing name,',
        '  icon, purpose, and when to use the type.',
        '- **Ordered content sections:** author `sections` in display order. Each',
        '  section declares `key`, `label`, and its own `writingStandard`. Markdown',
        '  sections use string content. Schema-backed JSON sections use `kind: json`',
        '  with `schemaRef`. HTML/CSS sections use `kind: html/css`; structured',
        '  mockups use `kind: structured-mockup`. Both omit `schemaRef`, may declare',
        '  definition-owned size profiles, and keep item content as the single editable authority.',
        '- **Scalar policy:** choose `requiredScalars` and `forbiddenScalars` only',
        '  from the closed `WorkItemTypeScalarField` vocabulary. A scalar in',
        '  neither list is optional; do not invent scalar keys or a per-section',
        '  `required` flag.',
        '- **Launch configuration policy:** choose `acceptedConfigKinds` explicitly',
        '  when this type should retain a typed launch default. Omit or use an',
        '  empty array for types that do not accept one; never infer acceptance',
        '  from the type key, role, or another capability.',
        '- **Lifecycle:** define ordered `allowedStatuses`. Agents may propose',
        '  every allowed status by default: omit `agentSettableStatuses` unless',
        '  the user deliberately wants to restrict agents to a narrower list.',
        '  `SUPERSEDED` is always reached through the supersede transition, never',
        '  an ordinary status edit. Do not use capability flags to stand in for',
        '  lifecycle policy.',
        '- **Hierarchy and parentage:** define work-item-type parentage with',
        '  `allowedParentTypes` on each child definition, and',
        '  non-work-item parentage with `allowedParentEntityTypes`. Keep these',
        '  explicit policies distinct from hierarchy-related capability switches.',
        `  ${WORK_ITEM_TYPE_PARENTAGE_GUIDANCE}`,
        '- **TRACKS policy:** use `tracking` as the dedicated TRACKS authorization',
        '  target-owned surface, covering `allowedSourceEntityTypes` and',
        '  `allowedSourceTaskTypes`. Source eligibility is derived by inversion.',
        '  `edgeTargets` and capability flags do not',
        '  authorize TRACKS, and legacy aliases such as `canBeTrackedByGoals` are',
        '  not supported substitutes.',
        '  Treat this as abstract-container behavior: the source gathers related',
        '  work that remains elsewhere in the hierarchy. Do not expose TRACKS as a',
        '  product term in the review.',
        '- **Generic typed relationships:** use `edgeTargets` only for the',
        '  non-TRACKS typed edges this type may originate and the type keys each',
        '  edge may target. Translate ordinary user language such as “connects to”',
        '  into a broad RELATED_TO policy focused on the named target types unless',
        '  the user clearly describes a stronger relationship. Do not ask the user',
        '  to choose edge vocabulary.',
        '- **Reports and writing standards:** use `anchorableReportTypes` for',
        '  report anchoring and `writingStandards.create` /',
        '  `writingStandards.edit` for type-level authoring rules; these are',
        '  separate from per-section writing standards.',
        `- **Named product capabilities:** supported keys are ${CREATE_WORK_ITEM_TYPE_CAPABILITY_AXES_FRAGMENT}.`,
        '  `showsInExplorerSidebar` is the explicit Explorer opt-in. Use each',
        '  boolean only for the product behavior it names; an arbitrary entry',
        '  does not create product behavior.',
        '- **Structured graph capability:** use `capabilities.graph` only for',
        '  graph-capable types. Keep `nodeChildType`, `layout.sectionKey` and',
        '  `layout.schemaRef`, `readableRelationships`, `editableRelationships`,',
        '  optional `searchableMetaLinkTargets`, `rendererKey`, `editorKey`, and',
        '  `supportedActions` aligned as one coherent graph contract.',
        '',
        '## Contract boundaries',
        '',
        'Author only fields accepted by the live `create_work_item_type` parameter',
        'contract. Do not copy registry-only provenance or lifecycle metadata into',
        'the proposal, and do not present persisted-but-inert fields, planned',
        'extensions, unknown capability keys, or legacy aliases as supported',
        'behavior. Submit one axis-complete definition after the material choices',
        'are grounded.',
      ].join('\n'),
    ),
  },

  create_plan: {
    description:
      'How to draft the design-doc markdown body and when to propose a plan via create_plan.',
    body: appendExampleUseGuidance(
      [
        '# create_plan — agent guidance',
        '',
        '## When to propose a plan',
        '',
        'Reach for `create_plan` when the user has described work that is non-trivial',
        'enough to benefit from staged execution — anything that touches multiple',
        'files, crosses service boundaries, requires a sequence of dependent changes,',
        'or has user-visible scope worth confirming before you start writing code.',
        'A bug fix in a single function or a one-line config change does not need a',
        'plan; a feature, a refactor, or a migration almost always does.',
        '',
        'Trigger conditions:',
        '- The user asked for a feature, refactor, migration, or multi-step task.',
        '- The work spans more than one file or one logical concern.',
        '- There is meaningful ambiguity about scope, ordering, or integration that',
        '  the user should sign off on before implementation.',
        '- You would otherwise have to invent assumptions that the user has not',
        '  explicitly confirmed.',
        '',
        '## Drafting the design-doc markdown body',
        '',
        'You — the calling agent — draft the full design-doc markdown body and pass',
        'it as `designDocMarkdown`. The value supplied in `planTitle` is the plan',
        'and PRD title; do not duplicate document owner, status, release date,',
        'stakeholders, or other platform metadata as mandatory prose. Use the',
        'section template below verbatim. Each section has a specific job; keep',
        'them in this order so reviewers know where to find each kind of decision.',
        '',
        '### Section template',
        '',
        '```markdown',
        '## Problem Statement & Context',
        'Keep this concise and grounded in the user need, affected users, and motivation.',
        '',
        '## Goals and Non-Goals',
        'State intended outcomes and explicitly name the in-scope and out-of-scope',
        'boundaries. Keep speculative future work and trivial preferences out.',
        '',
        '## Target Users & Use Cases',
        'Describe the target users, their scenarios, entry points, relevant states, and',
        'intended outcomes.',
        '',
        '## User Experience (UX) & Design',
        'Describe user-facing flows from their entry points through meaningful states to',
        'their intended outcomes. Capture interaction and accessibility expectations,',
        'and point to available design artifacts when they exist; do not require a',
        'mockup for every change.',
        '',
        '## User Stories & Acceptance Criteria',
        'Capture user-visible behavior and compact, verifiable criteria. User-story',
        'syntax such as "As a..." is optional; use the concise form that makes',
        'behavior reviewable.',
        '',
        '## Success Metrics',
        'Record only known, meaningful measures and their intended interpretation.',
        'Do not invent KPIs, telemetry, targets, or other measures that are not known.',
        '',
        '## Assumptions, Constraints & Dependencies',
        'Record the grounded conditions, constraints, and dependencies that shape the',
        'plan. Check each assumption against the project before writing it down.',
        '',
        '## Technical Requirements',
        'Technical detail may be absent from initial user input, but the final plan must',
        'ground the required technical depth in the subsections below before stages and',
        'implementation tasks are proposed.',
        '',
        '### Technical Approach',
        'Describe how the work fits together at the level of decisions, responsibilities,',
        'data shapes, and seams — not code. Specify the shared decisions needed for',
        'downstream tasks to agree on required interfaces and behavior.',
        'Where the work builds on, depends on, or',
        'changes something that already exists, reference that feature by name',
        '(@[feature:id|title]) instead of restating it. Do not list file paths or function',
        'signatures; keep this prose at the level of decisions, not a step-by-step',
        'implementation guide. Verify each premise against the project before writing it.',
        'Reference a feature only when the work genuinely relies on it; a forced web of',
        'references is as harmful as none.',
        '',
        '### Implementation Breakdown',
        'Translate the resolved Technical Approach into ordered, outcome-oriented units',
        'of work that are independently understandable. Organize the units freely to',
        'suit the design; this is not a rigid checklist. For each unit, name the',
        'capability or component being changed, what it produces, its prerequisites, the',
        'result it hands to later units, relevant boundary inputs and outputs, and an',
        'observable verification point for completion. Name every service each unit',
        'modifies or relies on, including supporting contract and generated-client',
        'repositories. Split a unit only when the work itself is independently',
        'executable, not merely because multiple services participate. Make request paths,',
        'data flows, events, payload agreements, and the source of truth for those',
        'agreements explicit at the seams. Name components, responsibilities, state and',
        'data shapes, seams, and sequence, but leave exact repository files, symbols,',
        'commands, signatures, and diffs for later phase grounding.',
        '',
        '### Integration Contracts',
        'Describe the concrete contracts — APIs, schemas, events, and file formats — that',
        'the work consumes or produces. Name the other surfaces that depend on these',
        'contracts so changes to them remain visible.',
        '',
        '### Detailed Data Flows and Downstream Task Convergence',
        'Trace how data and control move through the named services and boundaries,',
        'including request paths, events, payload and state shapes, ordering, ownership,',
        'sources of truth, and downstream handoffs. Make the data flows complete enough',
        'that independently proposed implementation tasks converge on the same behavior',
        'and interfaces rather than inventing missing schemas, events, or sequencing.',
        '```',
        '',
        ...PLAN_SCOPE_AND_JUDGMENT_GUIDANCE,
        '',
        '## Do NOT pre-materialize a design doc proposal',
        '',
        '`create_plan` is the single entry point. Do not call `create_design_doc`',
        'first to materialize a separate design-doc proposal — the markdown body',
        'you pass to `create_plan` IS the design doc, and the workflow seeded on',
        'acceptance handles materialization. Calling both produces duplicate',
        'artifacts and confuses the approval flow.',
        '',
        '## What the user sees after acceptance',
        '',
        'Submitting `create_plan` creates a proposal in DRAFT status. When the',
        'user accepts that proposal:',
        '- A fresh conversation is created.',
        '- A plan-from-design-doc workflow is seeded inside the new conversation,',
        '  using the `designDocMarkdown` you supplied as its input.',
        '- The workflow materializes the design doc, plan, stages, and steps.',
        '',
        "The proposal's `targetEntityId` is the nil UUID until enactment — the",
        'real conversation id is assigned at acceptance time and is not returned',
        'from the `create_plan` call. Do not try to look it up synchronously.',
      ].join('\n'),
    ),
  },
  create_work_item: {
    description:
      'Per-type writing standards for create_work_item: pass workItemType ' +
      '(for example STANDARD, FEATURE, GOAL, BUG, CONTRACT, or a project-defined key) ' +
      'to get the sections, required fields, and authoring discipline for the type being created.',
    body: buildWorkItemGuidanceBody('create'),
  },

  edit_work_item: {
    description:
      'Per-type writing standards for edit_work_item: pass workItemType ' +
      '(for example STANDARD, FEATURE, GOAL, BUG, CONTRACT, or a project-defined key) ' +
      'to get the update rules and authoring discipline for the type being edited.',
    body: buildWorkItemGuidanceBody('edit'),
  },

  create_design_doc: {
    description:
      'Writing standards for create_design_doc: BRAINSTORM-only shape and the decision-capture discipline.',
    body: appendExampleUseGuidance(
      [
        '# create_design_doc — agent guidance',
        '',
        '## What a design doc is',
        '',
        'A design doc holds the decisions a task or feature is too short to',
        'carry: alternatives considered, tradeoffs made, the *why* behind a',
        'choice. It is the home for decision archaeology that explicitly does',
        'not belong in tasks.',
        '',
        '## Tool shape — narrow on purpose',
        '',
        '`create_design_doc` accepts a single `content` string (plus optional',
        '`name`, `tags`, `summary`) and always produces a BRAINSTORM design',
        'document. Agents do not pick section keys — the server wraps `content`',
        'as the sole `content` section. ADR / DECISION / PLAN_DOCUMENT templates',
        'use dedicated flows, not this tool.',
        '',
        '## Discipline',
        '',
        'Canonical writing standards live on @[feature:b551cf45-e5b1-413d-9163-541e0a5c9bc3|Design Doc Tools].',
        'Read that feature for the full rule set: lead-with-the-decision,',
        "reference-don't-restate, one-decision-per-doc, signal-to-noise.",
        '',
        '## Section shape (within `content`)',
        '',
        'Lead with the decision, not the context. State what is being decided',
        'and why up front. Background, constraints, and alternatives follow —',
        'they exist to support the decision, not bury it.',
        '',
        'Typical sections inside `content`:',
        '- **Problem** — what is wrong or missing, not what will be built.',
        '- **Proposed approach** — the chosen solution at a level an implementer',
        '  can use, without being a step-by-step implementation guide. This is',
        '  also where the grounded technical shape lives: how the work fits',
        '  together at the level of decisions and data shapes.',
        '- **Alternatives considered** — what was looked at and why each was',
        '  rejected or deferred.',
        '- **Trade-offs** — explicit gains and sacrifices of the chosen approach.',
        '',
        '## Ground the technical shape',
        '',
        'The proposed approach is where the work fits together — the decisions',
        'and data shapes that connect the pieces. Specify the shared decisions',
        'needed for downstream tasks to agree on required interfaces and behavior.',
        'Where the work builds on, depends on, or changes something that already',
        'exists, reference that feature by name (@[feature:id|title]) instead of',
        'restating it. Do not list file paths or function signatures, and keep',
        'this prose at the level of decisions — not a step-by-step implementation',
        'guide. The discipline is not "cite the code" — it is do not assume a',
        'solution, system, or design that does not already exist. Verify each',
        'premise against the project before you write it down. Reference a',
        'feature only when the work genuinely relies on it; a forced web of',
        'references is as harmful as none, and most claims need no reference at',
        'all.',
        '',
        '## Preserve plan-document implementation breakdowns',
        '',
        'When authoring plan-document content, preserve its required section order:',
        '`Executive Outcome`, `User Journey`, `Technical Approach`,',
        '`Implementation Breakdown`, `Outcomes & AC`, `Explicit Assumptions`,',
        '`Scope Boundary`, then `Integration Contracts`. The breakdown carries',
        'ordered, outcome-oriented units with their results, prerequisites,',
        'downstream handoffs, boundary inputs and outputs, and observable',
        'verification. In a multi-service plan, every unit names its complete known',
        'Service set; split only independently executable work and',
        'describe the connecting request paths, data flows, events, payload',
        'agreements, and their source of truth at the seams. Keep one resolved',
        'design across Technical Approach and the breakdown. Name components,',
        'responsibilities, state and data shapes, seams, and sequence, but reserve',
        'exact files, symbols, commands, signatures, and diffs for later phase',
        'grounding. The internal organization is flexible, not a rigid checklist.',
        '',
        ...PLAN_SCOPE_AND_JUDGMENT_GUIDANCE,
        '',
        '## Voice',
        '',
        'Clear and concise. Each section serves its purpose without filler. No',
        'code-level implementation details — those belong on tasks or',
        'implementation hints.',
      ].join('\n'),
    ),
  },
  edit_design_doc: {
    description:
      'Writing standards for edit_design_doc: how to amend an existing design document without weakening the decision-capture discipline.',
    body: appendExampleUseGuidance(
      [
        '# edit_design_doc — agent guidance',
        '',
        '## When to reach for edit_design_doc',
        '',
        'Use `edit_design_doc` when the user asks for a concrete change to a',
        "design document's section content. Do not ask clarifying questions when",
        "the user's intent is clear — make the edit. The tool edits the content",
        'of existing sections; it does not add or remove sections.',
        '',
        '## What a design document is',
        '',
        'A design doc holds the decisions a task or feature is too short to',
        'carry: alternatives considered, trade-offs made, the *why* behind a',
        'choice. It is the home for decision archaeology that explicitly does',
        'not belong in tasks.',
        '',
        '## Discipline',
        '',
        'The discipline that governs `create_design_doc` applies symmetrically',
        'here. Canonical writing standards live on @[feature:b551cf45-e5b1-413d-9163-541e0a5c9bc3|Design Doc Tools].',
        'Edit paths cannot be a back door for rules a creation path enforces.',
        '',
        '## Section register',
        '',
        'Read the existing document and its template before editing. Preserve its',
        'effective section structure: section identities, headings, order, and',
        'boundaries. Amend requested content in place; do not migrate headings.',
        'Creation guidance supplies writing discipline, not a replacement outline.',
        '',
        'For `PLAN_DOCUMENT`, preserve the existing outline for both current PRD',
        'and earlier Plan documents. Neither outline is a migration target.',
        'Other templates retain their own section contracts. Apply the generic',
        'section advice below only when those sections belong to the document’s',
        'effective template; never translate Plan content into these headings.',
        '',
        '- **Problem** — what is wrong or missing, not what will be built. Edits',
        '  that smuggle solution language into the problem statement weaken the',
        "  doc's ability to motivate the decision.",
        '- **Proposed approach** — the chosen solution at a level an implementer',
        '  can use, without becoming a step-by-step implementation guide. If the',
        '  user is asking for code-level detail, redirect to a task or',
        '  implementation hint instead. This section also carries the grounded',
        '  technical shape — how the work fits together at the level of',
        '  decisions and data shapes that remain grounded in the authorized scope.',
        '- **Alternatives considered** — what was looked at and why each was',
        '  rejected or deferred, retaining relevant grounded rationale.',
        '- **Trade-offs** — explicit gains and sacrifices of the chosen approach.',
        '  Update these when an authorized scope correction changes the choice.',
        '',
        '## Ground the technical shape',
        '',
        'When an edit touches technical content in its existing sections, keep it',
        'grounded. Specify how the work fits together — the decisions and data',
        'shapes needed for downstream work to agree on required interfaces and',
        'behavior. Where the work builds on, depends on, or',
        'changes something that already exists, reference that feature by name',
        '(@[feature:id|title]) instead of restating it; do not list file paths',
        'or function signatures. The discipline is not "cite the code" — it is',
        'do not assume a solution, system, or design that does not already',
        'exist. Verify each premise against the project before you write it',
        'down. Reference a feature only when the work genuinely relies on it; a',
        'forced web of references is as harmful as none, and most claims need no',
        'reference at all. An edit must not strip this grounding back out.',
        '',
        '## Preserve the implementation breakdown',
        '',
        'Preserve Technical Approach, service-owned Implementation Breakdown,',
        'Integration Contracts, and Detailed Data Flows and Downstream Task',
        'Convergence as explicit technical content within the existing structure',
        '(including under `Technical Requirements` in PRD documents). Do not flatten',
        'that content into generic prose or remove it to fit a different outline.',
        'For units retained after scope corrections, preserve each ordered, outcome-oriented',
        'unit’s result, Service ownership,',
        'prerequisites, downstream handoff,',
        'boundary inputs and outputs, observable verification, and the complete',
        'known Service set. Split only independently executable cross-Service',
        'work and preserve the request paths, data',
        'flows, events, payload agreements, and the source of truth that connects',
        'them. Do not let an edit fork the resolved Technical Approach or raise',
        'the breakdown to file-level grounding: it may name components,',
        'responsibilities, state and data shapes, seams, and sequence, but exact',
        'files, symbols, commands, signatures, and diffs belong to later phase',
        'grounding. Its internal organization remains flexible, not a rigid',
        'checklist.',
        '',
        ...PLAN_SCOPE_AND_JUDGMENT_GUIDANCE,
        '',
        '## Common edit failure modes',
        '',
        '- **Code-level implementation detail leaking in.** Function signatures,',
        '  line-level pseudo-code, and file paths belong on tasks or',
        '  implementation hints. Redirect.',
        '- **Decision archaeology being deleted.** "We chose X because Y" is',
        '  what the doc exists to capture. Retain grounded reasoning that remains',
        '  applicable after scope corrections.',
        '- **Echoing the document back instead of editing it.** If the user',
        '  asked for a change, make the change.',
        '- **Conflating description and decision.** Background and constraints',
        '  support the decision; they should not bury it. Lead with the decision',
        '  on edits to the proposed approach section.',
        '- **Grounded technical shape eroding on edit.** Trimming the proposed',
        '  approach until the decisions and data shapes that connect the work',
        '  are gone, or swapping feature references for vague prose, leaves',
        '  downstream tasks free to drift. Preserve the grounded middle.',
        '',
        '## Voice',
        '',
        'Clear and concise. Each section serves its purpose without filler.',
        'Match the existing tone and level of detail already in the document.',
      ].join('\n'),
    ),
  },
  propose_future_revision: {
    description:
      'When and how to call propose_future_revision to stage a reviewed, non-live future revision of a Feature, Contract, Diagram, Mockup or Design Doc.',
    body: [
      '# propose_future_revision — agent guidance',
      '',
      '## When to reach for it',
      '',
      'Use `propose_future_revision` when a change to a Feature, Contract,',
      'Diagram, Mockup or Design Doc describes the outcome of implementation',
      'work that is not yet delivered — for example, "once the migration task',
      'is done, this Feature should describe the new API". Declare that',
      'implementation work as the completion dependencies. Approval stores the',
      'future without touching live content; a user applies it later, once',
      'its completion dependencies are ready.',
      '',
      'Use an ordinary proposal (`edit_work_item` or `edit_design_doc`) for',
      "changes to an implementation task's own instructions, editorial",
      'corrections, and guidance meant to govern work now — even when a',
      'related task exists. Creating the implementation work, or proposing it',
      'alongside the future, never replaces declaring it as a dependency.',
      '',
      'Features, Contracts, Diagrams and Mockups use `targetEntityType: "TASK"`;',
      'Design Docs use `"DESIGN_DOC"`.',
      '',
      '## The mutation',
      '',
      '`mutation` describes only what changes; the server reads the baseline,',
      'applies your change and stores the complete future result. It is',
      'validated before anything is persisted:',
      '',
      '- **New future** — reserve a fresh UUID as `futureId`, set',
      '  `operation: "REVISE"` and `expectedRevision: 0`.',
      '- **Refinement** — reuse the `futureId` and set `expectedRevision` to',
      "  its current reviewed revision. `changes` apply to the future's latest",
      '  reviewed result and its baseline and dependencies are kept unless you',
      '  supply them, so earlier reviewed changes are never lost. The approved',
      '  future stays intact while the refinement is pending or if it is',
      '  rejected.',
      '- **Cancellation** — `operation: "CANCEL"`, the `futureId` and its',
      '  current `expectedRevision`.',
      '',
      '`baseline` is optional. Omit it (or pass `{ kind: "LIVE" }`) to write',
      'against current live content; pass `{ kind: "FUTURE", futureId,',
      'revision }` to build on another reviewed future of the same target.',
      '',
      '`changes` uses the same shape as a live edit:',
      '',
      '- Feature, Contract, Diagram or Mockup — the `edit_work_item` fields:',
      '  `name`, `priority`, `tag`, `initiativeId`, `dueDate`, `assigneeId`,',
      '  `parentTaskId`, `sections` and, for Features, `requirementOps`.',
      '  `requirementOps` adds a requirement with no ids, and updates or',
      '  deletes one by its requirement id; do not also send',
      '  `sections[requirements]`. Diagram element and relationship edits use',
      '  `changes.operations`; root prose changes continue to use `sections`.',
      '  Diagram operations preserve elements, relationships, references, layout and groups in the complete non-live result; Apply uses the generic graph materializer.',
      '- Design Doc — the `edit_design_doc` fields: `name`, `template`,',
      '  `tags`, `summary`, `parentEntityId`, `parentEntityType` and',
      '  `sections` of `{ key, content }` for existing section keys.',
      '',
      'Sections you leave out stay as they are. Status (and, for work items,',
      'type, config and source) always comes from the baseline.',
      '',
      '`dependencies` is the complete list of tasks, bugs or Plans that must be',
      'COMPLETED before the future can be applied. Express them only here —',
      'the tool takes no `edges` or `tracks`, and live-target links are rejected.',
      '',
      '## Prose and review',
      '',
      'For a Feature, Contract, Diagram or Mockup whose change touches sections,',
      'pass the `guidanceToken` from',
      '`get_tool_guidance({ toolName: "edit_work_item", workItemType })`;',
      'the same writing standards apply to the future result as to a live edit.',
      'Design Docs need no `guidanceToken`, matching `edit_design_doc`.',
      '',
      'Non-empty `dependencies` or a `groupContext` are topology: pass the',
      '`authoringRootProof` from `get_authoring_guidance()`.',
      '',
      '## Grouping',
      '',
      'A standalone call is the default and is enough on its own. Pass',
      '`groupContext` only when the future belongs to a coordinated multi-',
      'proposal change already authored as an explicit proposal group (see',
      '`start_proposal_group`), for example when a dependency is a task created',
      'in the same group.',
      '',
      '## Result',
      '',
      'The response returns `proposalId` and `futureId`; cite the future by its',
      '`futureId` when linking later work to it.',
    ].join('\n'),
  },
  list_reports_by_entity: {
    description:
      'When to call list_reports_by_entity to resolve prior reports attached to an entity.',
    body: [
      '# list_reports_by_entity — agent guidance',
      '',
      '## When to call',
      '',
      'Use this tool when you are about to act on or write about a task,',
      'parent task, plan stage, or plan step and need to know what prior',
      'work (plan reports, implement reports, validation walkthroughs, etc.)',
      'is already attached to that entity. The validation-session flow is the',
      "canonical caller: before drafting a walkthrough, list the entity's",
      'PLAN and IMPLEMENT reports so the walkthrough builds on what already',
      'happened rather than re-deriving it.',
      '',
      'Other good fits:',
      '- An agent is resuming work on an entity and wants to see what handoff',
      '  reports exist (PLAN, IMPLEMENT, FEATURE_SYNC_HANDOFF).',
      '- An agent is summarizing or auditing an entity and needs the list of',
      '  reports to read into context.',
      '- An agent needs the originating flow execution id (`sourceExecution`)',
      '  for a prior report attached to the entity.',
      '',
      '## Inputs',
      '',
      '- `entityId` (required): UUID of the entity whose reports to list.',
      '  Any entity type that can carry reports is accepted — task, parent',
      '  task, plan stage, plan step, plan, design doc, feature, etc.',
      '- `reportType` (optional): narrows the result to a single ReportType',
      '  (e.g. `IMPLEMENT`, `PLAN`, `VALIDATION_WALKTHROUGH`). Accepts a',
      '  free string so unknown values from newer clients still round-trip;',
      '  the service rejects values it cannot resolve with a',
      '  `reportType must be one of: ...` error.',
      '',
      '## Response shape',
      '',
      'A compact `ReportSummaryDto[]`, newest first, containing only `id`,',
      '`reportType`, `sourceExecution`, and `createdAt`. The full payload is',
      '*not* returned — pair this tool with `get_report_body` to read a',
      'specific report once you have decided which ones are relevant.',
      '',
      'Read-only: this tool does not terminate the turn and is safe to call',
      'inline whenever the agent needs to orient on prior reports attached',
      'to an entity.',
    ].join('\n'),
  },
  get_diagram: {
    description:
      'Read one Diagram as compact text: its description, kind and level, elements with their descriptions, links grouped as flow, fulfillment, Contract participation or informational, and groups.',
    body: [
      '# get_diagram — agent guidance',
      '',
      '## When to call',
      '',
      'Use `get_diagram({ workflowId })` to read one Diagram in one bounded read.',
      '`workflowId` is the Diagram id. The result is text: a header with the',
      'Diagram id, name, kind and level, then `elements`, `flow`, `fulfillment`,',
      '`contracts`, `links` and `groups` sections, and a `layout` line.',
      'The Diagram description sits under the header; each element description',
      'sits under its element line.',
      '',
      'Use `get_context` for broader hierarchy orientation and `get_edges` for',
      'capped one-hop topology discovery, but never infer Diagram Elements or',
      'their relationships from either. Do not rebuild this view by calling those',
      'tools once per element.',
      '',
      '## Reading the result',
      '',
      'Every element and link line starts with its persisted id. Pass an element',
      'id as `{ refType: "existing", id }` in an edit_work_item operation that',
      'refers to that element. Pass a link id the same way when updating or',
      'deleting that relationship.',
      '',
      'Descriptions are authored text printed as-is. Every description line is',
      'indented four spaces; removing that indent recovers the text exactly, so a',
      'rebuild keeps it. An element with no description prints nothing extra.',
      '',
      'Flow links are STANDARD, CONDITIONAL or LOOP links between elements; each',
      'shows its direction and predicate where the link carries them. Fulfillment',
      'links are FULFILLED_BY implementation evidence. Contract participation is',
      'GUARANTEES, IMPLEMENTS or CONSUMES. The links section carries every other',
      'readable link, including DEPENDS_ON to a Contract.',
      '',
      'A section that prints `none returned by this read` means only that this',
      'scoped read returned no matching entries. It is not proof that no links are',
      'persisted. A line saying more elements may exist means the read limit was',
      'reached and the view is incomplete. If the result conflicts with a direct',
      'graph inspection, first verify the organization, project, endpoint scope,',
      'and graph-service identity before concluding that the relationship is absent.',
      '',
      "The layout is omitted. Replace a Diagram's layout as a whole through",
      'edit_work_item; a cleared layout returns to canonical automatic placement.',
      '',
      'Missing, inaccessible, out-of-project, or non-Diagram targets fail visibly.',
      'Do not invent placeholder Diagram fields or silently treat an invalid',
      'target as an empty Diagram.',
    ].join('\n'),
  },
} as const satisfies Record<string, ToolGuidanceEntry>;

export type ToolGuidanceKey = keyof typeof TOOL_GUIDANCE;
