import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { GetToolGuidanceToolsProvider } from '../tools/get-tool-guidance-tools.provider';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';

import { TaskSectionKey } from '../../generated/model/taskSectionKey';
import { EntityType } from '../../generated/model/entityType';
import { WorkStatus } from '../../generated/model/workStatus';
import {
  STANDARD_WRITING_GUIDANCE,
  createWarmWorkItemTypeRegistry,
  createWarmWorkItemTypeRegistryWithCustomTypes,
  createRegistryWithArchivedSystemType,
} from '../../../test/setup/work-item-type-registry.fixture';
import type { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';

const WORK_ITEM_TYPES = [
  'STANDARD',
  'FEATURE',
  'GOAL',
  'BUG',
  'CONTRACT',
] as const;
const GENERIC_TOOLS = ['create_work_item', 'edit_work_item'] as const;
const GRAPH_TYPE = 'GUIDANCE_GRAPH';
const DEFAULT_PROJECT_ID = '123e4567-e89b-42d3-a456-426614174003';
const GRAPH_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const BUG_RESOLVED_CONTEXT = `## Preserve resolved investigation context

Preserve every grounded investigation result required for a future agent to continue without the source conversation. This includes reproduction evidence, observed behavior and conditions, debugging observations, investigation results, an established root cause or narrowed hypotheses, materially useful rejected explanations, affected components and boundaries, and the agreed fix direction. Do not summarize away evidence or erase rejected explanations that materially narrow the remaining work.

Grounded context preservation takes precedence over ordinary concision and paragraph-count guidance when the detail is material. The evidence-backed scope rule still applies: preserve only content established by the user's request or authoritative, non-archived project context, and never invent behavior or detail.`;
const GRAPH_CAPABILITY = {
  nodeChildType: 'workflow_step',
  layout: {
    sectionKey: 'graphLayout',
    schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
  },
  readableRelationships: [
    {
      edgeType: 'STANDARD',
      category: 'flow',
      sourceEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
      targetEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
    },
  ],
  editableRelationships: [
    {
      edgeType: 'STANDARD',
      category: 'flow',
      sourceEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
      targetEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
    },
  ],
  rendererKey: 'work-item-graph',
  editorKey: 'work-item-graph-editor',
  supportedActions: [
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
  ],
};

function getText(result: unknown): string {
  const r = result as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  const first = r.content?.[0];
  if (!first || first.type !== 'text') {
    throw new Error('Expected a text content entry');
  }
  return first.text;
}

async function guidanceFor(
  provider: GetToolGuidanceToolsProvider,
  toolName: (typeof GENERIC_TOOLS)[number],
  workItemType?: string,
): Promise<string> {
  const result = await provider.getToolGuidance(
    { toolName, workItemType, authoringRootProof: AUTHORING_ROOT_PROOF } as any,
    {} as any,
    { headers: { 'x-project-id': DEFAULT_PROJECT_ID } } as any,
  );
  expect((result as { isError?: boolean }).isError).toBeUndefined();
  return getText(result);
}

// The per-type authoring contract: for every work-item type, the generic
// tools' guidance must carry that type's sections, required scalars, and
// writing standards — all sourced from the registry, so the suite
// fails the moment the guidance stops reading from the registry.
describe('get_tool_guidance per-work-item-type contract', () => {
  let provider: GetToolGuidanceToolsProvider;
  let registry: WorkItemTypeRegistryService;

  beforeEach(async () => {
    registry = await createWarmWorkItemTypeRegistry();
    provider = new GetToolGuidanceToolsProvider(registry);
  });

  it('uses the project-owned canonical definition when a project is in scope', async () => {
    const projectId = '33333333-3333-4333-8333-333333333333';
    const projectRegistry = await createWarmWorkItemTypeRegistryWithCustomTypes(
      [
        {
          typeKey: WORK_ITEM_TYPE_KEYS.Standard,
          projectId,
          sectionKeys: ['projectDescription'],
          requiredScalars: ['dueDate'],
          forbiddenScalars: [],
          writingStandards: {
            create: 'project-owned STANDARD create guidance',
            edit: 'project-owned STANDARD edit guidance',
          },
        },
      ],
    );
    const projectProvider = new GetToolGuidanceToolsProvider(projectRegistry);

    const result = await projectProvider.getToolGuidance(
      {
        toolName: 'create_work_item',
        workItemType: WORK_ITEM_TYPE_KEYS.Standard,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      { headers: { 'x-project-id': projectId } } as any,
    );

    expect((result as { isError?: boolean }).isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('- Allowed section keys: projectDescription.');
    expect(text).toContain('project-owned STANDARD create guidance');
  });

  describe.each(GENERIC_TOOLS)('%s', (toolName) => {
    it.each(WORK_ITEM_TYPES)(
      "%s body carries the type's section schema from the registry",
      async (type) => {
        const text = await guidanceFor(provider, toolName, type);
        const sections = registry.getRulesForProject(
          type as WorkItemTypeKey,
          DEFAULT_PROJECT_ID,
        )?.sections;
        expect(sections).toBeDefined();
        expect(text).toContain(
          `- Allowed section keys: ${sections!.join(', ')}.`,
        );
      },
    );

    it.each(WORK_ITEM_TYPES)(
      "%s body contains only the selected mode's DB-backed writing standards",
      async (type) => {
        const text = await guidanceFor(provider, toolName, type);
        const mode = toolName === 'create_work_item' ? 'create' : 'edit';
        const otherMode = mode === 'create' ? 'edit' : 'create';
        const standards = registry.getRulesForProject(
          type as WorkItemTypeKey,
          DEFAULT_PROJECT_ID,
        )!.writingStandards;

        expect(text).toContain(standards[mode]);
        expect(text).not.toContain(standards[otherMode]);
      },
    );

    it('returns the type overview, not an error, when workItemType is omitted', async () => {
      const text = await guidanceFor(provider, toolName, undefined);
      expect(text).toContain('covers every work-item type');
      for (const type of WORK_ITEM_TYPES) {
        expect(text).toContain(type);
      }
      expect(text).toContain('DIAGRAM');
      expect(text).toContain('diagramElements');
      expect(text).toContain('workflowSteps');
    });
  });

  it.each(GENERIC_TOOLS)(
    '%s explains the registry-declared HTML/CSS payload contract',
    async (toolName) => {
      const htmlCssRegistry =
        await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: 'HTML_CSS_TYPE',
            projectId: DEFAULT_PROJECT_ID,
            sectionDefinitions: [
              { key: 'preview', label: 'Preview', kind: 'html/css' },
            ],
            allowedParentTypes: [],
          },
        ]);
      const htmlCssProvider = new GetToolGuidanceToolsProvider(htmlCssRegistry);
      const text = await guidanceFor(
        htmlCssProvider,
        toolName,
        'HTML_CSS_TYPE',
      );

      expect(text).toContain('Section `preview` uses `kind: html/css`');
      expect(text).toContain(
        '`{ html: string, css: string, sizeKey?: string }`',
      );
      expect(text).toContain('empty CSS is valid');
      expect(text).toContain('`schemaRef` is omitted');
      expect(text).toContain('omit sizeKey');
      expect(text).toContain('intentionally addressable semantic element');
      expect(text).toContain('unique, stable, non-empty `data-hh-id` value');
      expect(text).toContain(
        'Preserve that value across revisions while the same conceptual element remains',
      );
      expect(text).toContain(
        'remove or replace it when that conceptual identity ends',
      );
    },
  );

  it.each(GENERIC_TOOLS)(
    '%s explains the registry-declared structured mockup vocabulary',
    async (toolName) => {
      const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
        {
          typeKey: 'STRUCTURED_MOCKUP_TYPE',
          projectId: DEFAULT_PROJECT_ID,
          sectionDefinitions: [
            {
              key: 'mockup',
              label: 'Mockup',
              kind: 'structured-mockup',
            },
          ],
          allowedParentTypes: [],
        },
      ]);
      const typeProvider = new GetToolGuidanceToolsProvider(registry);
      const text = await guidanceFor(
        typeProvider,
        toolName,
        'STRUCTURED_MOCKUP_TYPE',
      );

      expect(text).toContain('Section `mockup` uses `kind: structured-mockup`');
      expect(text).toContain('work-item-structured-mockup.v3');
      expect(text).toContain('work-item-structured-mockup.v4');
      expect(text).toContain('work-item-structured-mockup.v5');
      expect(text).toContain('`image-placeholder`');
      expect(text).toContain('`row`');
      expect(text).toContain('`column`');
      expect(text).toContain('justify: "start" | "center" | "end" | "spread"');
      expect(text).toContain('align: "start" | "center" | "end" | "stretch"');
      expect(text).toContain('Never send renderer code');
      expect(text).toContain(
        'variant: "body" | "heading" | "caption" | "label" | "badge"',
      );
      expect(text).toContain('surface: "plain" | "panel" | "muted" | "dashed"');
      expect(text).toContain('multiline');
      expect(text).toContain('Do not flatten a multi-panel reference');
    },
  );

  describe('create_work_item required scalars per type', () => {
    it('STANDARD requires parentTaskId', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'STANDARD');
      expect(text).toMatch(/- Required fields: .*parentTaskId/);
      expect(text).toMatch(
        /`tracks\.sourceEntityId` does not replace\s+`parentTaskId`/,
      );
      expect(text).toMatch(
        /set\s+`parentTaskId` to the feature or task that structurally owns the/,
      );
    });

    it('FEATURE requires tag', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'FEATURE');
      expect(text).toMatch(/- Required fields: .*tag/);
    });

    it('GOAL accepts an optional dueDate and does not accept parentTaskId', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'GOAL');
      expect(text).toContain('- Required fields: name.');
      expect(text).not.toMatch(/- Not accepted for this type: .*dueDate/);
      expect(text).toMatch(/- Not accepted for this type: .*parentTaskId/);
    });

    it('BUG requires name and parentTaskId and rejects tag', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'BUG');
      expect(text).toMatch(/- Required fields: .*name.*parentTaskId/);
      expect(text).toMatch(/- Not accepted for this type: .*tag/);
    });

    it('CONTRACT requires parentTaskId and rejects tag and dueDate', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'CONTRACT');
      expect(text).toMatch(/- Required fields: .*name.*parentTaskId/);
      expect(text).toMatch(/- Not accepted for this type: .*tag.*dueDate/);
    });

    it('explains how independent PLAN_STAGE proposals form a dependency chain', async () => {
      const text = await guidanceFor(
        provider,
        'create_work_item',
        'PLAN_STAGE',
      );

      expect(text).toContain('independent SINGLE proposals');
      expect(text).toContain('proposal group is not required');
      expect(text).toContain('structuredContent.proposalId');
      expect(text).toContain('targetEntityType');
      expect(text).toContain('PROPOSAL');
      expect(text).toContain('targetEntityId');
      expect(text).toContain('<predecessor proposalId>');
      expect(text).toMatch(/Use `proposalId`, not `id`/);
      expect(text).toMatch(/every later Stage proposal carries/);
    });

    it.each([
      ['create_work_item', 'create'],
      ['edit_work_item', 'edit'],
    ] as const)(
      'serves bounded Contract feature-participation guidance for %s',
      async (toolName, mode) => {
        const standards = {
          create:
            'The structural feature parent is the complete ownership relationship; never duplicate it with RELATED_TO. Add Contract RELATED_TO for every other directly providing, consuming, or enforcing feature. Prose mentions create no topology. Keep workflow_step DEPENDS_ON Contract separate. Exclude ancestors, incidental implementation features, and downstream fan-out.',
          edit: 'Preserve the structural feature parent as the complete ownership relationship without duplicate RELATED_TO. Reconcile Contract RELATED_TO for every other directly providing, consuming, or enforcing feature. Prose mentions create no topology. Reconcile workflow_step DEPENDS_ON Contract separately. Remove ancestors, incidental implementation features, and downstream fan-out.',
        };
        const contractRegistry =
          await createWarmWorkItemTypeRegistryWithCustomTypes([
            {
              typeKey: 'CONTRACT',
              projectId: DEFAULT_PROJECT_ID,
              writingStandards: standards,
            },
          ]);
        const contractProvider = new GetToolGuidanceToolsProvider(
          contractRegistry,
        );
        const text = await guidanceFor(contractProvider, toolName, 'CONTRACT');

        expect(text).toContain(standards[mode]);
        expect(text).toContain('complete ownership relationship');
        expect(text).toContain(
          'every other directly providing, consuming, or enforcing feature',
        );
        expect(text).toContain('Prose mentions create no topology');
        expect(text).toContain('workflow_step DEPENDS_ON Contract');
        expect(text).toContain('incidental implementation features');
        expect(text).toContain('downstream fan-out');
        expect(text).not.toContain('marketing-start endpoint');
        expect(text).not.toContain('workflow queue will be drained');
      },
    );

    it('Diagram create guidance names the canonical compound graph payload', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'DIAGRAM');

      expect(text).toContain('## Initial Diagram graph payload');
      expect(text).toContain(
        'Use `diagramElements` for every initial Diagram Element',
      );
      expect(text).toContain('`DIAGRAM_ELEMENT`');
      expect(text).toContain('`relationship.create` operations');
      expect(text).toContain('{ refType: "temporary", tempId }');
      expect(text).toContain('approval and materialization');
      expect(text).toContain('STANDARD forbids a predicate');
      expect(text).toContain('CONDITIONAL requires a predicate');
      expect(text).toContain('LOOP accepts a predicate optionally');
      expect(text).toContain(
        '`LOOP` is a relationship variant, not a direction value',
      );
      expect(text).toContain('adding `predicate` to STANDARD is rejected');
      expect(text).toContain(
        'omitting `predicate` (or omitting `direction`) is rejected',
      );
      expect(text).toContain('adding `direction` to LOOP is rejected');
      expect(text).toContain('do not encode LOOP as `direction: "LOOP"`');
      expect(text).toContain('`layout.replace` operation');
      expect(text).not.toContain('workflowSteps');
    });

    it('Diagram create guidance states the operations/outer-field exclusivity and root parent field', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'DIAGRAM');

      expect(text).toContain(
        'outer `sections`, `parentTaskId`, `priority`, `dueDate`,',
      );
      expect(text).toContain('rejected together with');
      expect(text).toContain('parent: { refType: "existing", id: <parentId> }');
      expect(text).toContain("operation's own `parent` field instead");
    });

    it('Diagram create guidance states section.replace addressing by ref, not target', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'DIAGRAM');

      expect(text).toContain('`section.replace` has no `target`');
      expect(text).toContain('"op": "section.replace"');
      expect(text).toContain('"key": "diagramMetadata"');
      expect(text).toContain('"kind": "UX_FLOW"');
    });

    it('Diagram create guidance gives a worked grouped Mockup + Diagram authoring example', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'DIAGRAM');

      expect(text).toContain(
        '## Grouped authoring: Mockups and a Diagram together',
      );
      expect(text).toContain('`start_proposal_group`');
      expect(text).toContain('groupedAuthoring.member.memberId');
      expect(text).toContain('.reservedEntityId');
      expect(text).toContain('replace_proposal_group_prerequisites');
      expect(text).toContain('finalize_proposal_group');
    });

    it('create_work_item teaches per-element Diagram links without sourceRef', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'DIAGRAM');

      expect(text).toContain('## Linking Diagram Elements to the project');
      expect(text).toContain('`diagramElements[].edges`');
      expect(text).toContain('targetEntityType: "TASK"');
      expect(text).toContain('targetEntityType: "PROPOSAL"');
      expect(text).toContain('never use DEPENDS_ON for Contract');
      expect(text).toContain('## Links from the whole Diagram');
      expect(text).toContain('same-project CREATE proposal');
      expect(text).not.toContain('sourceRef');
    });

    it('lists project-effective element link types from the Diagram graph capability', async () => {
      const elementLink = (edgeType: string) => ({
        edgeType,
        category: 'meta',
        sourceEndpoint: {
          role: 'graphNode',
          entityTypes: ['TASK'],
          workItemTypeKeys: ['DIAGRAM_ELEMENT'],
        },
        targetEndpoint: { role: 'externalEntity', entityTypes: ['TASK'] },
      });
      const graph = {
        ...GRAPH_CAPABILITY,
        nodeChildType: 'DIAGRAM_ELEMENT',
        editableRelationships: [
          ...GRAPH_CAPABILITY.editableRelationships,
          elementLink('RELATED_TO'),
          elementLink('FULFILLED_BY'),
        ],
      };
      const graphRegistry = await createWarmWorkItemTypeRegistryWithCustomTypes(
        [
          {
            typeKey: 'DIAGRAM',
            projectId: GRAPH_PROJECT_ID,
            capabilities: { graph },
          },
        ],
      );
      const result = await new GetToolGuidanceToolsProvider(
        graphRegistry,
      ).getToolGuidance(
        {
          toolName: 'create_work_item',
          workItemType: 'DIAGRAM',
          authoringRootProof: AUTHORING_ROOT_PROOF,
        } as any,
        {} as any,
        { headers: { 'x-project-id': GRAPH_PROJECT_ID } } as any,
      );
      const text = getText(result);

      expect(text).toContain(
        'Element link types in this project: RELATED_TO, FULFILLED_BY.',
      );
      expect(text).not.toContain(
        'Element link types in this project: STANDARD',
      );
    });

    it.each(
      GENERIC_TOOLS.filter((toolName) => toolName !== 'create_work_item'),
    )(
      '%s explains deferred Diagram proposal edge sources',
      async (toolName) => {
        const text = await guidanceFor(provider, toolName, 'DIAGRAM');

        expect(text).toContain('deferred ENTITY-mode link');
        expect(text).toContain('same-project CREATE proposal');
        expect(text).toContain('`sourceRef`');
        expect(text).toContain('refType: "temporary"');
        expect(text).toContain('"existing", id');
        expect(text).toContain('Omit `sourceRef` to use the Diagram root');
        expect(text).toContain('Only PROPOSAL targets accept `sourceRef`');
      },
    );

    it('advertises the generic graph change-set surface in edit guidance', async () => {
      const graphRegistry = await createWarmWorkItemTypeRegistryWithCustomTypes(
        [
          {
            typeKey: GRAPH_TYPE,
            projectId: GRAPH_PROJECT_ID,
            capabilities: {
              graph: GRAPH_CAPABILITY,
            },
          },
        ],
      );
      const graphProvider = new GetToolGuidanceToolsProvider(graphRegistry);
      const result = await graphProvider.getToolGuidance(
        {
          toolName: 'edit_work_item',
          workItemType: GRAPH_TYPE,
          authoringRootProof: AUTHORING_ROOT_PROOF,
        } as any,
        {} as any,
        { headers: { 'x-project-id': GRAPH_PROJECT_ID } } as any,
      );
      expect((result as { isError?: boolean }).isError).toBeUndefined();
      const text = getText(result);

      expect(text).not.toContain('## Initial Diagram graph payload');
      expect(text).not.toContain('`workflowLinks`');
      expect(text).toContain('## Generic graph change-set editing');
      expect(text).toContain('`relationship.create`');
      expect(text).toContain('reconnectRelationship');
      expect(text).toContain('STANDARD forbids a predicate');
      expect(text).toContain('CONDITIONAL requires a predicate');
      expect(text).toContain('LOOP accepts a predicate');
      expect(text).toContain(
        '`LOOP` is a relationship variant, not a direction value',
      );
      expect(text).toContain('adding `predicate` to STANDARD is rejected');
      expect(text).toContain(
        'omitting `predicate` (or omitting `direction`) is rejected',
      );
      expect(text).toContain('adding `direction` to LOOP is rejected');
      expect(text).toContain('do not encode LOOP as `direction: "LOOP"`');
      expect(text).toContain('`layout.replace`');
      expect(text).toContain('`layout.clear`');
      expect(text).toContain('`layoutBoundary`');
      expect(text).toContain('Keep graph relationships in the operation set');
      expect(text).toContain('Do not send `graphLayout` as prose');
    });

    it('does not advertise graph editing for a type without graph capabilities', async () => {
      const text = await guidanceFor(provider, 'edit_work_item', 'STANDARD');

      expect(text).not.toContain('## Generic graph change-set editing');
      expect(text).not.toContain('`layoutBoundary`');
    });
  });

  it('get_diagram guidance describes the text view and empty-read semantics', async () => {
    const result = await provider.getToolGuidance(
      { toolName: 'get_diagram' } as any,
      {} as any,
      {} as any,
    );
    const text = getText(result);

    expect(text).toContain('`get_diagram({ workflowId })`');
    expect(text).toContain('`elements`, `flow`, `fulfillment`');
    expect(text).toContain('`{ refType: "existing", id }`');
    expect(text).toContain(
      'Use `get_context` for broader hierarchy orientation',
    );
    expect(text).toContain('`get_edges`');
    expect(text).toContain('`none returned by this read`');
    expect(text).toContain('It is not proof that no links are');
    expect(text).toContain('indented four spaces');
    expect(text).not.toContain('get_workflow');
  });

  describe.each(GENERIC_TOOLS)('%s STANDARD scope authority', (toolName) => {
    it('serves the approved reviewable-change wording exactly once', async () => {
      const text = await guidanceFor(provider, toolName, 'STANDARD');

      expect(text.split(STANDARD_WRITING_GUIDANCE)).toHaveLength(2);
      expect(text).not.toMatch(/@\[\w+:[0-9a-f-]{36}\|/i);
      for (const obsolete of [
        '## Evidence-backed scope',
        '## Preserve resolved context',
        'Tasks are ready to implement when written',
        'expose the chosen shape',
        '3–4 bullets',
        'no decision archaeology',
        'Task Tools',
      ]) {
        expect(text).not.toContain(obsolete);
      }
    });

    it('retains field folding and structured relationship mechanics', async () => {
      const text = await guidanceFor(provider, toolName, 'STANDARD');

      expect(text).toContain('dedicated `implementation` parameter');
      expect(text).toContain('trailing `## Implementation` block');
      expect(text).toContain("proposal's structured `edges` parameter");
      expect(text).toContain('approval performs the atomic transition');
      expect(text).toContain('`DEPENDS_ON` edge in `edges`');
      if (toolName === 'edit_work_item') {
        expect(text).toContain('preserves the existing description');
        expect(text).toContain(
          'no replacement description section is supplied',
        );
      }
    });

    it('serves the complete known service-set contract from the registry', async () => {
      const text = await guidanceFor(provider, toolName, 'STANDARD');
      expect(text).toContain('## Complete known service scope');
      expect(text).toContain(
        'include `serviceIds` whenever implementation scope is known',
      );
      expect(text).toContain('complete set');
      expect(text).toContain('without guessing additional services');
      expect(text).toContain('supply an empty array only to assert');
    });
  });

  describe.each(GENERIC_TOOLS)('%s role-based service scope', (toolName) => {
    it('includes service scope for BUG and excludes it for project-info types', async () => {
      const bug = await guidanceFor(provider, toolName, 'BUG');
      const feature = await guidanceFor(provider, toolName, 'FEATURE');

      expect(bug).toContain('## Complete known service scope');
      expect(bug).toContain('registry role is `work-item`');
      expect(feature).not.toContain('## Complete known service scope');
    });
  });

  describe.each(GENERIC_TOOLS)(
    '%s resolved-context preservation',
    (toolName) => {
      it('preserves established STANDARD decisions and necessary rationale', async () => {
        const text = await guidanceFor(provider, toolName, 'STANDARD');

        expect(text).toContain(
          'Preserve established decisions, constraints, and necessary rationale',
        );
        expect(text).toContain(
          'Do not reopen settled choices or reconstruct unrelated history',
        );
        expect(text).toContain('remove repetition and speculative detail');
      });

      it('preserves the complete grounded BUG investigation context', async () => {
        const text = await guidanceFor(provider, toolName, 'BUG');

        expect(text).toContain(BUG_RESOLVED_CONTEXT);
        expect(text).toContain('reproduction evidence');
        expect(text).toContain(
          'an established root cause or narrowed hypotheses',
        );
        expect(text).toContain('materially useful rejected explanations');
        expect(text).toContain('affected components and boundaries');
        expect(text).toContain(
          'takes precedence over ordinary concision and paragraph-count guidance',
        );
        expect(text).toContain('The evidence-backed scope rule still applies');
      });
    },
  );

  describe('edit_work_item FEATURE initiating-context scope', () => {
    it('scopes edits to affected content without granting topology mutation authority', async () => {
      const text = await guidanceFor(provider, 'edit_work_item', 'FEATURE');

      expect(text).toContain('## Scope to the initiating work');
      expect(text).toContain(
        'initiated from a task, plan, design doc, or other bounded',
      );
      expect(text).toContain(
        'Preserve\nunrelated feature and design-doc statements',
      );
      expect(text).toContain(
        'unless the initiating request establishes that they are\naffected',
      );
      expect(text).toContain('A conflict is evidence to flag or clarify');
      expect(text).toContain(
        'does\nnot authorize proposing unrelated feature edits automatically',
      );
    });

    it('does not add the edit-only scope rule to FEATURE create guidance', async () => {
      const text = await guidanceFor(provider, 'create_work_item', 'FEATURE');

      expect(text).not.toContain('## Scope to the initiating work');
      expect(text).not.toContain(
        'initiated from a task, plan, design doc, or other bounded',
      );
    });
  });

  describe.each(GENERIC_TOOLS)(
    '%s workflow-first feature modeling',
    (toolName) => {
      const workflowCoverageStandards = {
        create: `## Workflow coverage

Before finalizing a behavior-bearing feature, identify the workflow the
feature owns or participates in. A feature may own its workflow or be
meaningfully represented by an ancestor or cross-feature workflow. Broader
coverage counts only when the workflow steps actually represent the feature's
behavior; do not create a ceremonial duplicate workflow for every nested
feature.

Keep the modeling surfaces distinct. Feature requirements declare durable
outcomes. workflow_step items describe states, actions, decisions, and
handoffs; STANDARD, CONDITIONAL, and LOOP describe flow between those steps.
When a meaningful workflow step has concrete implementation, author
FULFILLED_BY from the workflow_step to the implementing STANDARD task.

If no meaningful workflow, step, or STANDARD-task implementation target
exists, surface the missing coverage for user review. Do not automatically
generate a workflow, task, or fulfillment link merely to make the graph look
complete.`,
        edit: `## Workflow coverage

Before finalizing a behavior-bearing feature, identify the workflow the
feature owns or participates in. A feature may own its workflow or be
meaningfully represented by an ancestor or cross-feature workflow. Broader
coverage counts only when the workflow steps actually represent the feature's
behavior; do not create a ceremonial duplicate workflow for every nested
feature.

Keep the modeling surfaces distinct. Feature requirements declare durable
outcomes. workflow_step items describe states, actions, decisions, and
handoffs; STANDARD, CONDITIONAL, and LOOP describe flow between those steps.
When a meaningful workflow step has concrete implementation, author
FULFILLED_BY from the workflow_step to the implementing STANDARD task.

If no meaningful workflow, step, or STANDARD-task implementation target
exists, surface the missing coverage for user review. Do not automatically
generate a workflow, task, or fulfillment link merely to make the graph look
complete.`,
      };

      async function guidanceWithCoverage(typeKey: 'FEATURE' | 'workflow') {
        const coverageRegistry =
          await createWarmWorkItemTypeRegistryWithCustomTypes([
            {
              typeKey,
              projectId: DEFAULT_PROJECT_ID,
              writingStandards: workflowCoverageStandards,
            },
          ]);
        return guidanceFor(
          new GetToolGuidanceToolsProvider(coverageRegistry),
          toolName,
          typeKey,
        );
      }

      it('accepts a feature-owned workflow as meaningful coverage', async () => {
        const text = await guidanceWithCoverage('FEATURE');

        expect(text).toContain(
          'identify the workflow the\nfeature owns or participates in',
        );
        expect(text).toContain('A feature may own its workflow');
      });

      it('accepts ancestor or cross-feature participation without ceremonial duplication', async () => {
        const text = await guidanceWithCoverage('FEATURE');

        expect(text).toContain('ancestor or cross-feature workflow');
        expect(text).toContain('do not create a ceremonial duplicate workflow');
      });

      it('surfaces behavior-rich features without workflow coverage for review', async () => {
        const text = await guidanceWithCoverage('workflow');

        expect(text).toContain('surface the missing coverage for user review');
        expect(text).toContain('Do not automatically\ngenerate a workflow');
      });

      it('requires concrete STANDARD-task fulfillment for implemented steps', async () => {
        const text = await guidanceWithCoverage('workflow');

        expect(text).toContain(
          'Feature requirements declare durable\noutcomes',
        );
        expect(text).toContain(
          'FULFILLED_BY from the workflow_step to the implementing STANDARD task',
        );
        expect(text).toContain('STANDARD-task implementation target');
      });
    },
  );

  describe.each(GENERIC_TOOLS)('%s SUPERSEDES guidance', (toolName) => {
    it('derives eligible and ineligible predecessor types from allowed statuses', async () => {
      const text = await guidanceFor(provider, toolName, 'BUG');
      const types = registry.getActiveTypeKeys(DEFAULT_PROJECT_ID).sort();
      const eligible = types.filter((type) =>
        registry
          .getRulesForProject(type, DEFAULT_PROJECT_ID)
          ?.allowedStatuses.includes(WorkStatus.Superseded),
      );
      const ineligible = types.filter(
        (type) =>
          !registry
            .getRulesForProject(type, DEFAULT_PROJECT_ID)
            ?.allowedStatuses.includes(WorkStatus.Superseded),
      );

      expect(text).toContain(
        `- Eligible predecessor types: ${eligible.join(', ')}.`,
      );
      expect(text).toContain(
        `- Ineligible predecessor types: ${ineligible.join(', ')}.`,
      );
      expect(ineligible).toEqual(expect.arrayContaining(['BUG', 'GOAL']));
      expect(eligible).toEqual(expect.arrayContaining(['FEATURE', 'STANDARD']));
      expect(text).toContain(
        `${ineligible.join(' and ')} predecessors cannot be targeted by`,
      );
      expect(text).toContain(
        `${eligible.join(' and ')} predecessors remain successor-authored`,
      );
    });

    it('excludes an archived project-owned type from new-use choices', async () => {
      const archivedRegistry = await createRegistryWithArchivedSystemType(
        WORK_ITEM_TYPE_KEYS.Bug,
      );
      const archivedProvider = new GetToolGuidanceToolsProvider(
        archivedRegistry,
      );
      const result = await archivedProvider.getToolGuidance(
        {
          toolName,
          workItemType: WORK_ITEM_TYPE_KEYS.Standard,
          authoringRootProof: AUTHORING_ROOT_PROOF,
        },
        {} as any,
        { headers: { 'x-project-id': DEFAULT_PROJECT_ID } } as any,
      );
      const text = getText(result);
      const eligibleLine = text
        .split('\n')
        .find((line) => line.startsWith('- Eligible predecessor types:'));
      const ineligibleLine = text
        .split('\n')
        .find((line) => line.startsWith('- Ineligible predecessor types:'));

      expect(eligibleLine).toBeDefined();
      expect(ineligibleLine).toBeDefined();
      expect(eligibleLine).not.toContain(WORK_ITEM_TYPE_KEYS.Bug);
      expect(ineligibleLine).not.toContain(WORK_ITEM_TYPE_KEYS.Bug);
    });
  });

  describe('lifecycle-aware work-item edit safety', () => {
    it.each(['STANDARD', 'BUG'] as const)(
      'applies section-specific status rules to %s work items',
      async (type) => {
        const text = await guidanceFor(provider, 'edit_work_item', type);

        expect(text).toContain('## Prefer updating over appending');
        expect(text).toContain('## Work-item section edit safety');
        expect(text).toContain(
          'section content that records what the work does or did',
        );
        expect(text).toContain('check status before editing sections');
        expect(text).toContain('`ACTIVE` is ambiguous');
        expect(text).toContain('ask the user before editing sections');
        expect(text).toContain(
          '`VERIFYING`: ask the user before editing sections',
        );
        expect(text).toContain(
          '`COMPLETED`: do not edit sections unless the user instructs you to.',
        );
      },
    );

    it('does not add the edit-only lifecycle safety rule to create guidance or project-info types', async () => {
      const standardCreate = await guidanceFor(
        provider,
        'create_work_item',
        'STANDARD',
      );
      const bugCreate = await guidanceFor(provider, 'create_work_item', 'BUG');
      const featureEdit = await guidanceFor(
        provider,
        'edit_work_item',
        'FEATURE',
      );

      expect(standardCreate).not.toContain('## Work-item section edit safety');
      expect(bugCreate).not.toContain('## Work-item section edit safety');
      expect(featureEdit).not.toContain('## Work-item section edit safety');
    });

    it('renders lifecycle safety for a project-defined work-item type with the full status set', async () => {
      const projectId = '44444444-4444-4444-8444-444444444444';
      const customRegistry =
        await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: 'LIFECYCLE_ITEM',
            projectId,
            allowedStatuses: [
              WorkStatus.Backlog,
              WorkStatus.Active,
              WorkStatus.Verifying,
              WorkStatus.Completed,
            ],
          },
        ]);
      const customProvider = new GetToolGuidanceToolsProvider(customRegistry);
      const result = await customProvider.getToolGuidance(
        {
          toolName: 'edit_work_item',
          workItemType: 'LIFECYCLE_ITEM',
          authoringRootProof: AUTHORING_ROOT_PROOF,
        } as any,
        {} as any,
        { headers: { 'x-project-id': projectId } } as any,
      );

      expect(getText(result)).toContain('`ACTIVE` is ambiguous');
    });

    it('omits lifecycle safety for a project-defined work-item type without all lifecycle statuses', async () => {
      const projectId = '55555555-5555-4555-8555-555555555555';
      const customRegistry =
        await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: 'BACKLOG_ONLY',
            projectId,
            allowedStatuses: [WorkStatus.Backlog, WorkStatus.Active],
          },
        ]);
      const customProvider = new GetToolGuidanceToolsProvider(customRegistry);
      const result = await customProvider.getToolGuidance(
        {
          toolName: 'edit_work_item',
          workItemType: 'BACKLOG_ONLY',
          authoringRootProof: AUTHORING_ROOT_PROOF,
        } as any,
        {} as any,
        { headers: { 'x-project-id': projectId } } as any,
      );

      expect(getText(result)).not.toContain('## Work-item section edit safety');
    });

    it('omits section safety for a full-lifecycle type with a non-work-item role', async () => {
      const projectId = '66666666-6666-4666-8666-666666666666';
      const customRegistry =
        await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: 'GRAPH_NODE_ITEM',
            projectId,
            role: 'project-info',
          },
        ]);
      const customProvider = new GetToolGuidanceToolsProvider(customRegistry);
      const result = await customProvider.getToolGuidance(
        {
          toolName: 'edit_work_item',
          workItemType: 'GRAPH_NODE_ITEM',
          authoringRootProof: AUTHORING_ROOT_PROOF,
        } as any,
        {} as any,
        { headers: { 'x-project-id': projectId } } as any,
      );

      expect(getText(result)).not.toContain('## Work-item section edit safety');
    });
  });

  describe('proof-of-read guidance', () => {
    it.each(GENERIC_TOOLS)(
      '%s keeps the shared per-type proof-of-read path',
      async (toolName) => {
        const text = await guidanceFor(provider, toolName, 'STANDARD');

        expect(text).toContain(
          '`create_work_item` and `edit_work_item` require this',
        );
        expect(text).toContain(
          'It is keyed to project `123e4567-e89b-42d3-a456-426614174003`',
        );
        expect(text).toContain('work-item type `STANDARD`');
      },
    );
  });
});

// A project-defined custom type must carry the same authoring contract the
// built-ins do, sourced from its own registry definition rather than a
// precomputed map. Unknown and archived keys fall through to the shared
// valid-types error.
describe('get_tool_guidance for project-defined custom types', () => {
  const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
  const CUSTOM_KEY = 'EXPERIMENT';
  const CUSTOM_CREATE_STANDARDS = 'Custom experiment create discipline prose.';
  const CUSTOM_EDIT_STANDARDS = 'Custom experiment edit discipline prose.';

  const customSpec = {
    typeKey: CUSTOM_KEY,
    projectId: PROJECT_ID,
    name: 'Experiment',
    sectionKeys: [
      TaskSectionKey.Description,
      TaskSectionKey.AcceptanceCriteria,
    ],
    requiredScalars: ['dueDate'],
    forbiddenScalars: ['tag'],
    writingStandards: {
      create: CUSTOM_CREATE_STANDARDS,
      edit: CUSTOM_EDIT_STANDARDS,
    },
  };

  const requestFor = (projectId?: string): any => ({
    headers: projectId ? { 'x-project-id': projectId } : {},
  });

  async function customGuidance(
    provider: GetToolGuidanceToolsProvider,
    toolName: 'create_work_item' | 'edit_work_item',
    workItemType: string,
    projectId?: string,
  ): Promise<{ text: string; isError?: boolean }> {
    const result = (await provider.getToolGuidance(
      {
        toolName,
        workItemType,
        authoringRootProof: AUTHORING_ROOT_PROOF,
      } as any,
      {} as any,
      requestFor(projectId),
    )) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: result.content[0]?.text ?? '', isError: result.isError };
  }

  it("serves the custom type's contract from its registry definition", async () => {
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      customSpec,
    ]);
    const provider = new GetToolGuidanceToolsProvider(registry);

    const { text, isError } = await customGuidance(
      provider,
      'create_work_item',
      CUSTOM_KEY,
      PROJECT_ID,
    );
    expect(isError).toBeUndefined();
    expect(text).toContain(
      `# create_work_item (${CUSTOM_KEY}) — agent guidance`,
    );
    expect(text).toContain(
      '- Allowed section keys: description, acceptanceCriteria.',
    );
    expect(text).toMatch(/- Required fields: name, dueDate\./);
    expect(text).toContain('- Not accepted for this type: tag, parentTaskId.');
    expect(text).toContain('## Complete known service scope');
    expect(text).toContain(CUSTOM_CREATE_STANDARDS);
  });

  it('serves the edit-mode writing standards for the custom type', async () => {
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      customSpec,
    ]);
    const provider = new GetToolGuidanceToolsProvider(registry);

    const { text } = await customGuidance(
      provider,
      'edit_work_item',
      CUSTOM_KEY,
      PROJECT_ID,
    );
    expect(text).toContain(CUSTOM_EDIT_STANDARDS);
  });

  it('reads the project scope from the X-Project-ID header', async () => {
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      customSpec,
    ]);
    const provider = new GetToolGuidanceToolsProvider(registry);

    // No params.projectId — only the header carries the scope.
    const { text, isError } = await customGuidance(
      provider,
      'create_work_item',
      CUSTOM_KEY,
      PROJECT_ID,
    );
    expect(isError).toBeUndefined();
    expect(text).toContain(
      `# create_work_item (${CUSTOM_KEY}) — agent guidance`,
    );
  });

  it('returns the valid-types error for an unknown key', async () => {
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      customSpec,
    ]);
    const provider = new GetToolGuidanceToolsProvider(registry);

    const { text, isError } = await customGuidance(
      provider,
      'create_work_item',
      'NOT_A_TYPE',
      PROJECT_ID,
    );
    expect(isError).toBe(true);
    expect(text).toContain('is not a usable type for this project');
    expect(text).toContain('Valid types:');
  });

  it('returns the valid-types error for an archived custom key', async () => {
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      { ...customSpec, lifecycleStatus: 'archived' as const },
    ]);
    const provider = new GetToolGuidanceToolsProvider(registry);

    const { text, isError } = await customGuidance(
      provider,
      'create_work_item',
      CUSTOM_KEY,
      PROJECT_ID,
    );
    expect(isError).toBe(true);
    expect(text).toContain('is not a usable type for this project');
  });

  it('errors when a custom key is requested without project scope', async () => {
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      customSpec,
    ]);
    const provider = new GetToolGuidanceToolsProvider(registry);

    const { text, isError } = await customGuidance(
      provider,
      'create_work_item',
      CUSTOM_KEY,
      undefined,
    );
    expect(isError).toBe(true);
    expect(text).toContain('Missing projectId');
  });
});

describe('get_tool_guidance for project-scoped MODE', () => {
  const MODE_PROJECT_ID = DEFAULT_PROJECT_ID;
  const MODE_CREATE_STANDARDS =
    "Author the MODE as a project-specific instruction bundle for an already capable coding agent. Include only instructions that materially change decisions or execution in this project, and make each instruction only as specific as the risk and consequence of deviation require. Keep `MODE.md` as a concise entry document that states the mode's purpose, its governing project-specific constraints, and when to read each supporting Markdown file. Put conditional procedures, detailed examples, checklists, and deeper reference material in supporting Markdown files for on-demand reading. The mode operates inside the session-provided selected work item, feature ancestry and graph context, design documents, Service scope, permissions, proposal boundaries, and launch constraints; preserve those inputs and never restate, weaken, or replace them. Registry fields remain authoritative for description, applicability, discovery, and eligibility, so do not duplicate that metadata in `MODE.md`. A MODE is an instruction bundle, not a packaged skill: do not add scripts, assets, hooks, tool installation, executable extensions, automatic activation, or Codex-, Claude-, or other vendor-specific runtime semantics.";
  const MODE_EDIT_STANDARDS =
    'Revise only the MODE instructions and supporting Markdown files needed for the requested behavioral change, preserving unrelated files and every registry-owned definition axis. Write for an already capable coding agent: retain only project-specific material that materially changes decisions or execution, and scale specificity to the risk and consequence of deviation. Keep `MODE.md` concise and move conditional procedures, detailed examples, checklists, and deeper reference material into supporting Markdown files that the entry document names for on-demand reading. Preserve the session-provided selected work item, feature ancestry and graph context, design documents, Service scope, permissions, proposal boundaries, and launch constraints; MODE content must not restate, weaken, or replace them. Do not duplicate registry-owned description, applicability, discovery, or eligibility metadata in `MODE.md`. Keep the MODE an instruction bundle only: do not introduce scripts, assets, hooks, tool installation, executable extensions, automatic activation, skill packaging, or vendor-specific runtime semantics.';
  const MODE_CREATE_LEANNESS_STANDARD =
    "Keep the MODE lean; this is its primary rule. Sessions in this mode already receive the system prompt, the selected work item's feature ancestry and graph context, Project Assistant research, implementation hints, and each Service's AGENTS.md, and the agent can find and read code on its own, so every line must supply something those do not. The core of most MODEs is what an agent would otherwise miss: gotchas that cost time, cross-Service traps, the in-between steps that no single feature or file reveals, and symptom-to-cause diagnosis. When the session's purpose differs from a default coding session, also state its intent: what it is for, what it produces, the format and quality bar of that output, the workflow that gets there, and when the work is done. Anchor the MODE to the features, design docs, and Contracts it covers by mention, without summarizing them, so the graph carries their current state and changes to them lead back to the MODE. Do not map files or symbols the agent can find itself; name a file or symbol only when a gotcha cannot be stated without it, because such references go stale when code changes outside this mode. Exclude restated feature requirements, design-doc decisions, Contract promises, regression matrices that restate requirements, and copies of open bug details.";
  const MODE_EDIT_LEANNESS_STANDARD =
    "Keep the MODE lean; this is its primary rule. Sessions in this mode already receive the system prompt, the selected work item's feature ancestry and graph context, Project Assistant research, implementation hints, and each Service's AGENTS.md, and the agent can find and read code on its own, so every line must supply something those do not. A MODE holds what an agent would otherwise miss (gotchas, cross-Service traps, in-between steps that no single feature or file reveals, symptom-to-cause diagnosis), the session's intent where it differs from a default coding session (purpose, deliverable, output format and quality bar, workflow, done condition), and mentions of the features, design docs, and Contracts it covers; it does not hold summaries of those entities, restated feature requirements, design-doc decisions, Contract promises, regression matrices that restate requirements, copies of open bug details, or maps of files and symbols the agent can find itself. Whenever you touch a MODE, check that the files and symbols it names still exist and still behave as described, remove content that duplicates those sources, and replace summaries with mentions, so an edit leaves the MODE smaller or no larger than the requested change requires.";
  const MODE_SECTION_SUMMARY_STANDARD =
    'Make the first sentence of the catalog description a concise, standalone summary for the launch picker. Keep the full description in this section.';
  const MODE_CREATE_SUMMARY_STANDARD =
    'Make the first sentence of the catalog description a concise, standalone launch-picker summary; keep the full description in the description section.';
  const MODE_EDIT_SUMMARY_STANDARD =
    'When editing the catalog description, keep its first sentence a concise, standalone launch-picker summary and retain the full description in the description section.';

  const modeSpec = {
    typeKey: 'MODE',
    projectId: MODE_PROJECT_ID,
    name: 'Agent Mode',
    sectionDefinitions: [
      {
        key: 'description',
        label: 'Catalog description',
        kind: 'markdown' as const,
        writingStandard: `State when to choose the mode. ${MODE_SECTION_SUMMARY_STANDARD}`,
      },
      {
        key: 'files',
        label: 'Files',
        kind: 'json' as const,
        schemaRef: '#/components/schemas/ProjectModeFiles',
        writingStandard: 'Provide the validated project-mode-files.v1 bundle.',
      },
    ],
    allowedParentTypes: ['FEATURE'],
    allowedParentEntityTypes: [EntityType.Task],
    capabilities: { requiresParent: true },
    forbiddenScalars: ['dueDate', 'tag'],
    writingStandards: {
      create: `${MODE_CREATE_LEANNESS_STANDARD}\n\n${MODE_CREATE_STANDARDS}\n\n${MODE_CREATE_SUMMARY_STANDARD}`,
      edit: `${MODE_EDIT_LEANNESS_STANDARD}\n\n${MODE_EDIT_STANDARDS}\n\n${MODE_EDIT_SUMMARY_STANDARD}`,
    },
  };

  it.each(GENERIC_TOOLS)(
    '%s exposes the updated MODE standard with the existing registry contract',
    async (toolName) => {
      const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
        modeSpec,
      ]);
      const provider = new GetToolGuidanceToolsProvider(registry);
      const text = await guidanceFor(provider, toolName, 'MODE');

      expect(text).toContain(`# ${toolName} (MODE) — agent guidance`);
      expect(text).toContain('- Allowed section keys: description, files.');
      expect(text).toContain(
        'Section `description` is labeled `Catalog description`.',
      );
      expect(text).toContain(MODE_SECTION_SUMMARY_STANDARD);
      expect(text).toContain(
        toolName === 'create_work_item'
          ? MODE_CREATE_SUMMARY_STANDARD
          : MODE_EDIT_SUMMARY_STANDARD,
      );
      expect(text).toContain('Section `files` is labeled `Files`.');
      expect(text).toContain(
        'Section `files` uses schema-backed JSON content (#/components/schemas/ProjectModeFiles).',
      );
      expect(text).toContain(
        toolName === 'create_work_item'
          ? 'Required fields: name, parentTaskId.'
          : 'Required fields: none beyond targetEntityId and at least one change.',
      );
      expect(text).toContain('Not accepted for this type: dueDate, tag.');
      expect(text).toContain(
        toolName === 'create_work_item'
          ? MODE_CREATE_STANDARDS
          : MODE_EDIT_STANDARDS,
      );
      expect(text).not.toContain(
        toolName === 'create_work_item'
          ? MODE_EDIT_STANDARDS
          : MODE_CREATE_STANDARDS,
      );
    },
  );

  it.each(GENERIC_TOOLS)(
    '%s leads MODE guidance with the leanness rule',
    async (toolName) => {
      const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
        modeSpec,
      ]);
      const provider = new GetToolGuidanceToolsProvider(registry);
      const text = await guidanceFor(provider, toolName, 'MODE');
      const isCreate = toolName === 'create_work_item';
      const leanness = isCreate
        ? MODE_CREATE_LEANNESS_STANDARD
        : MODE_EDIT_LEANNESS_STANDARD;
      const existing = isCreate ? MODE_CREATE_STANDARDS : MODE_EDIT_STANDARDS;
      const summary = isCreate
        ? MODE_CREATE_SUMMARY_STANDARD
        : MODE_EDIT_SUMMARY_STANDARD;

      expect(text).toContain(leanness);
      expect(text).not.toContain(
        isCreate ? MODE_EDIT_LEANNESS_STANDARD : MODE_CREATE_LEANNESS_STANDARD,
      );
      expect(text.indexOf(leanness)).toBeLessThan(text.indexOf(existing));
      expect(text.indexOf(existing)).toBeLessThan(text.indexOf(summary));
      expect(text).toContain(
        'so every line must supply something those do not',
      );
      expect(text).toContain('cross-Service traps');
      expect(text).toContain('regression matrices that restate requirements');
    },
  );

  it.each(GENERIC_TOOLS)(
    '%s resolves the updated canonical fallback through the effective project registry',
    async (toolName) => {
      const canonicalSource =
        await createWarmWorkItemTypeRegistryWithCustomTypes([modeSpec]);
      const canonicalRules = canonicalSource.getRulesForProject(
        'MODE',
        MODE_PROJECT_ID,
      );
      expect(canonicalRules).toBeDefined();

      const registry = await createWarmWorkItemTypeRegistry();
      const getRulesForProject = registry.getRulesForProject.bind(registry);
      const getActiveTypeKeys = registry.getActiveTypeKeys.bind(registry);
      const getAllowedParentTypes =
        registry.getAllowedParentTypes.bind(registry);
      const assertTypeActive = registry.assertTypeActive.bind(registry);
      jest
        .spyOn(registry, 'getRulesForProject')
        .mockImplementation((typeKey, projectId) =>
          typeKey === 'MODE' && projectId === MODE_PROJECT_ID
            ? canonicalRules
            : getRulesForProject(typeKey, projectId),
        );
      jest
        .spyOn(registry, 'getActiveTypeKeys')
        .mockImplementation((projectId) => [
          ...getActiveTypeKeys(projectId),
          'MODE',
        ]);
      jest
        .spyOn(registry, 'getAllowedParentTypes')
        .mockImplementation((typeKey, projectId) =>
          typeKey === 'MODE' && projectId === MODE_PROJECT_ID
            ? canonicalRules!.allowedParentTaskTypes
            : getAllowedParentTypes(typeKey, projectId),
        );
      jest
        .spyOn(registry, 'assertTypeActive')
        .mockImplementation((typeKey, projectId) => {
          if (typeKey !== 'MODE' || projectId !== MODE_PROJECT_ID) {
            assertTypeActive(typeKey, projectId);
          }
        });

      const text = await guidanceFor(
        new GetToolGuidanceToolsProvider(registry),
        toolName,
        'MODE',
      );

      expect(text).toContain(
        toolName === 'create_work_item'
          ? MODE_CREATE_STANDARDS
          : MODE_EDIT_STANDARDS,
      );
      expect(text).toContain('- Allowed section keys: description, files.');
      expect(text).toContain('Not accepted for this type: dueDate, tag.');
    },
  );

  it.each(GENERIC_TOOLS)(
    '%s preserves complete project-override precedence',
    async (toolName) => {
      const overrideStandards = {
        create: 'Project-owned MODE create guidance.',
        edit: 'Project-owned MODE edit guidance.',
      };
      const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
        { ...modeSpec, writingStandards: overrideStandards },
      ]);
      const text = await guidanceFor(
        new GetToolGuidanceToolsProvider(registry),
        toolName,
        'MODE',
      );

      expect(text).toContain(
        toolName === 'create_work_item'
          ? overrideStandards.create
          : overrideStandards.edit,
      );
      expect(text).not.toContain(MODE_CREATE_STANDARDS);
      expect(text).not.toContain(MODE_EDIT_STANDARDS);
    },
  );
});
