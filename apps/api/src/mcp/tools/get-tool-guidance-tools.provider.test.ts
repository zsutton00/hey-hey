import { GetToolGuidanceToolsProvider } from './get-tool-guidance-tools.provider';
import {
  TOOL_GUIDANCE,
  type ToolGuidanceBody,
  type ToolGuidanceKey,
} from './tool-guidance';
import {
  AUTHORING_ROOT_PROOF,
  TOPOLOGY_AUTHORING_GUIDANCE,
} from './authoring-guidance';
import { guidanceTokenForType } from './work-item-guidance-token';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import {
  STANDARD_WRITING_GUIDANCE,
  createWarmWorkItemTypeRegistry,
} from '../../../test/setup/work-item-type-registry.fixture';

function getText(result: unknown): string {
  const r = result as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  expect(Array.isArray(r.content)).toBe(true);
  const first = r.content[0];
  expect(first?.type).toBe('text');
  if (!first) throw new Error('Expected at least one content entry');
  return first.text;
}

const WORK_ITEM_KEYS = new Set<ToolGuidanceKey>([
  'create_work_item',
  'edit_work_item',
]);
const WORK_ITEM_TYPES = [
  'STANDARD',
  'FEATURE',
  'GOAL',
  'BUG',
  'CONTRACT',
] as const;
const PROJECT_ID = '123e4567-e89b-42d3-a456-426614174003';
const OTHER_PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const EXAMPLE_USE_GUIDANCE =
  'Examples may be used when they clarify a consequential authoring distinction.';
const STANDARD_TASK_DEPENDENCY_GUIDANCE =
  'When authoring multiple tasks, declare a `DEPENDS_ON` edge in `edges` when one task cannot proceed without another; authoring or ordering tasks together alone does not establish a dependency.';
const materialContextPreservationRule = (authoredType: string): string =>
  `Carry every material decision, constraint, rationale, and implementation detail established in the current conversation into the authored ${authoredType}; future consumers may not have access to the conversation.`;

describe('GetToolGuidanceToolsProvider', () => {
  let provider: GetToolGuidanceToolsProvider;
  let registry: WorkItemTypeRegistryService;

  beforeAll(async () => {
    registry = await createWarmWorkItemTypeRegistry();
  });

  beforeEach(() => {
    provider = new GetToolGuidanceToolsProvider(registry);
  });

  it.each(Object.entries(TOOL_GUIDANCE))(
    'TOOL_GUIDANCE entry %s has non-empty description and body',
    (key, entry) => {
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);

      const body: ToolGuidanceBody = entry.body;
      if (typeof body === 'string') {
        expect(body.length).toBeGreaterThan(0);
      } else if (typeof body === 'function') {
        // Work-item bodies are lazy builders resolved against the registry.
        const built = body(registry);
        for (const type of WORK_ITEM_TYPES) {
          expect(typeof built.forType(type, PROJECT_ID)).toBe('string');
          expect(built.forType(type, PROJECT_ID).length).toBeGreaterThan(0);
        }
        expect(typeof built.noWorkItemType).toBe('string');
        expect(built.noWorkItemType.length).toBeGreaterThan(0);
      }
      expect(key).toBe(key);
    },
  );

  const flatKeys = (Object.keys(TOOL_GUIDANCE) as ToolGuidanceKey[]).filter(
    (k) => !WORK_ITEM_KEYS.has(k),
  );

  it.each(flatKeys)(
    'returns the %s body for a valid toolName (flat-body tools)',
    async (key) => {
      const result = await provider.getToolGuidance(
        { toolName: key },
        {} as any,
        {} as any,
      );
      const text = getText(result);
      const body = TOOL_GUIDANCE[key].body;
      expect(typeof body).toBe('string');
      expect(text).toBe(body);
      expect((result as { isError?: boolean }).isError).toBeUndefined();
    },
  );

  it('includes the generic example-use rule without embedding the motivating Contract example', async () => {
    const result = await provider.getToolGuidance(
      {
        toolName: 'create_work_item',
        workItemType: 'CONTRACT',
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      { headers: { 'x-project-id': PROJECT_ID } } as any,
    );
    const text = getText(result);

    expect(text).toContain(EXAMPLE_USE_GUIDANCE);
    expect(text).not.toContain('marketing-start endpoint');
    expect(text).not.toContain('workflow queue will be drained');
  });

  it.each(['create_work_item', 'edit_work_item'] as const)(
    'includes the dependency reminder in STANDARD %s guidance',
    async (toolName) => {
      const result = await provider.getToolGuidance(
        {
          toolName,
          workItemType: 'STANDARD',
          authoringRootProof: AUTHORING_ROOT_PROOF,
        },
        {} as any,
        { headers: { 'x-project-id': PROJECT_ID } } as any,
      );

      expect(getText(result)).toContain(STANDARD_TASK_DEPENDENCY_GUIDANCE);
    },
  );

  it('shares the approved STANDARD writing block and proof across create, single edit, and batch edit', async () => {
    for (const toolName of ['create_work_item', 'edit_work_item'] as const) {
      const result = await provider.getToolGuidance(
        {
          toolName,
          workItemType: 'STANDARD',
          authoringRootProof: AUTHORING_ROOT_PROOF,
        },
        {} as any,
        { headers: { 'x-project-id': PROJECT_ID } } as any,
      );
      const text = getText(result);
      expect(text.split(STANDARD_WRITING_GUIDANCE)).toHaveLength(2);
      expect(text).toContain(guidanceTokenForType('STANDARD', PROJECT_ID));
      expect(text).toContain(
        '`create_work_item` and `edit_work_item` require this',
      );
    }
  });

  describe.each(['create_work_item', 'edit_work_item'] as const)(
    'work-item-type body selection for %s',
    (key) => {
      const body: ToolGuidanceBody = TOOL_GUIDANCE[key].body;
      if (typeof body !== 'function') {
        throw new Error(`Expected ${key} to have a per-work-item-type body`);
      }

      it.each(WORK_ITEM_TYPES)(
        'returns the %s body with the per-type proof-of-read token appended',
        async (type) => {
          const result = await provider.getToolGuidance(
            {
              toolName: key,
              workItemType: type,
              authoringRootProof: AUTHORING_ROOT_PROOF,
            },
            {} as any,
            { headers: { 'x-project-id': PROJECT_ID } } as any,
          );
          const text = getText(result);
          // The per-type writing standards still come through verbatim...
          expect(text).toContain(body(registry).forType(type, PROJECT_ID));
          expect(text).toContain(
            materialContextPreservationRule(`${type} work item`),
          );
          // ...with the proof-of-read token block appended so the token
          // rides the body the agent reads.
          expect(text).toContain('## Proof-of-read token');
          expect(text).toContain(guidanceTokenForType(type, PROJECT_ID));
          expect(text).toContain(`project \`${PROJECT_ID}\``);
          expect((result as { isError?: boolean }).isError).toBeUndefined();
        },
      );

      it('issues a token for the active project snapshot, not just the type key', async () => {
        const first = await provider.getToolGuidance(
          {
            toolName: key,
            workItemType: 'STANDARD',
            projectId: PROJECT_ID,
            authoringRootProof: AUTHORING_ROOT_PROOF,
          },
          {} as any,
          {} as any,
        );
        const second = await provider.getToolGuidance(
          {
            toolName: key,
            workItemType: 'STANDARD',
            projectId: OTHER_PROJECT_ID,
            authoringRootProof: AUTHORING_ROOT_PROOF,
          },
          {} as any,
          {} as any,
        );

        expect(getText(first)).toContain(
          guidanceTokenForType('STANDARD', PROJECT_ID),
        );
        expect(getText(second)).toContain(
          guidanceTokenForType('STANDARD', OTHER_PROJECT_ID),
        );
        expect(guidanceTokenForType('STANDARD', PROJECT_ID)).not.toBe(
          guidanceTokenForType('STANDARD', OTHER_PROJECT_ID),
        );
      });

      it('rejects typed guidance without authoritative project context', async () => {
        const result = await provider.getToolGuidance(
          {
            toolName: key,
            workItemType: WORK_ITEM_TYPES[0],
            authoringRootProof: AUTHORING_ROOT_PROOF,
          },
          {} as any,
          {} as any,
        );
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(getText(result)).toContain('Missing projectId');
      });

      it('does not append a token to the type overview (no workItemType)', async () => {
        const result = await provider.getToolGuidance(
          { toolName: key },
          {} as any,
          {} as any,
        );
        const text = getText(result);
        expect(text).not.toContain('## Proof-of-read token');
      });

      it('returns the type overview when workItemType is omitted (no error)', async () => {
        const result = await provider.getToolGuidance(
          { toolName: key },
          {} as any,
          {} as any,
        );
        expect(getText(result)).toBe(body(registry).noWorkItemType);
        expect(getText(result)).toContain('covers every work-item type');
        expect((result as { isError?: boolean }).isError).toBeUndefined();
      });
    },
  );

  it('keeps lifecycle edit safety out of create guidance while rendering it for BUG edits', async () => {
    const createResult = await provider.getToolGuidance(
      {
        toolName: 'create_work_item',
        workItemType: 'BUG',
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      { headers: { 'x-project-id': PROJECT_ID } } as any,
    );
    const editResult = await provider.getToolGuidance(
      {
        toolName: 'edit_work_item',
        workItemType: 'BUG',
        authoringRootProof: AUTHORING_ROOT_PROOF,
      },
      {} as any,
      { headers: { 'x-project-id': PROJECT_ID } } as any,
    );

    expect(getText(createResult)).not.toContain(
      '## Work-item section edit safety',
    );
    expect(getText(editResult)).toContain('`ACTIVE` is ambiguous');
    expect(getText(editResult)).toContain(
      '`VERIFYING`: ask the user before editing sections',
    );
    expect(getText(editResult)).toContain(
      '`COMPLETED`: do not edit sections unless the user instructs you to.',
    );
  });

  describe('plan and design-doc resolved-direction guidance', () => {
    async function getEditGuidance(): Promise<string> {
      const result = await provider.getToolGuidance(
        { toolName: 'edit_design_doc' },
        {} as any,
        {} as any,
      );
      return getText(result).replace(/\s+/g, ' ');
    }

    it('preserves current PRD sections and explicit technical content on edit', async () => {
      const text = await getEditGuidance();

      expect(text).toContain(
        'For `PLAN_DOCUMENT`, preserve the existing outline for both current PRD and earlier Plan documents',
      );
      expect(text).toContain('Neither outline is a migration target');
      expect(text).toContain('service-owned Implementation Breakdown');
      expect(text).toContain(
        'Detailed Data Flows and Downstream Task Convergence as explicit technical content within the existing structure',
      );
      expect(text).toContain(
        'including under `Technical Requirements` in PRD documents',
      );
      expect(text).not.toContain('edited here under another');
    });

    it('preserves earlier Plan outlines without imposing a section migration', async () => {
      const text = await getEditGuidance();

      expect(text).toContain(
        'preserve the existing outline for both current PRD and earlier Plan documents',
      );
      expect(text).toContain(
        'section identities, headings, order, and boundaries',
      );
      expect(text).toContain(
        'Amend requested content in place; do not migrate headings',
      );
      expect(text).toContain('Neither outline is a migration target');
      expect(text).not.toContain('must preserve the required section order');
    });

    it('limits generic section advice to the effective template', async () => {
      const text = await getEditGuidance();

      expect(text).toContain(
        'Read the existing document and its template before editing',
      );
      expect(text).toContain(
        'Other templates retain their own section contracts',
      );
      expect(text).toContain(
        'Apply the generic section advice below only when those sections belong to the document’s effective template',
      );
      expect(text).toContain(
        'never translate Plan content into these headings',
      );
      expect(text).toContain('**Problem**');
      expect(text).toContain('**Proposed approach**');
      expect(text).toContain('**Alternatives considered**');
      expect(text).toContain('**Trade-offs**');
      expect(text).toContain(
        'Creation guidance supplies writing discipline, not a replacement outline',
      );
    });

    it('create_plan uses PRD-facing headings with technical subsections', async () => {
      const result = await provider.getToolGuidance(
        { toolName: 'create_plan' },
        {} as any,
        {} as any,
      );
      const text = getText(result);
      const compactText = text.replace(/\s+/g, ' ');
      const headings = [
        '## Problem Statement & Context',
        '## Goals and Non-Goals',
        '## Target Users & Use Cases',
        '## User Experience (UX) & Design',
        '## User Stories & Acceptance Criteria',
        '## Success Metrics',
        '## Assumptions, Constraints & Dependencies',
        '## Technical Requirements',
      ];

      let previousIndex = -1;
      for (const heading of headings) {
        const headingIndex = text.indexOf(heading);
        expect(headingIndex).toBeGreaterThan(previousIndex);
        previousIndex = headingIndex;
      }

      const technicalHeadings = [
        '### Technical Approach',
        '### Implementation Breakdown',
        '### Integration Contracts',
        '### Detailed Data Flows and Downstream Task Convergence',
      ];
      previousIndex = text.indexOf('## Technical Requirements');
      for (const heading of technicalHeadings) {
        const headingIndex = text.indexOf(heading);
        expect(headingIndex).toBeGreaterThan(previousIndex);
        previousIndex = headingIndex;
      }

      expect(compactText).toContain('user-facing flows');
      expect(compactText).toContain('meaningful states');
      expect(compactText).toContain(
        'interaction and accessibility expectations',
      );
      expect(compactText).toContain('available design artifacts');
      expect(compactText).toContain('do not require a mockup for every change');
      expect(compactText).toContain(
        'User-story syntax such as "As a..." is optional',
      );
      expect(compactText).toContain('only known, meaningful measures');
      expect(compactText).toContain('Do not invent KPIs, telemetry, targets');
      expect(compactText).toMatch(/ordered, outcome-oriented/);
      expect(compactText).toContain('prerequisites');
      expect(compactText).toContain('downstream handoffs');
      expect(compactText).toContain('boundary inputs and outputs');
      expect(compactText).toContain('observable verification');
      expect(compactText).toContain('Name every service each unit');
      expect(compactText).toContain('independently executable');
      expect(compactText).toContain('request paths');
      expect(compactText).toContain('data flows');
      expect(compactText).toContain('events');
      expect(compactText).toContain('payload agreements');
      expect(compactText).toContain('source of truth');
      expect(compactText).toContain('files');
      expect(compactText).toContain('symbols');
      expect(compactText).toContain('commands');
      expect(compactText).toContain('signatures');
      expect(compactText).toContain('diffs');
      expect(compactText).toContain('later phase grounding');
      expect(compactText).toContain('not a rigid checklist');
      expect(compactText).toContain('Goals and Non-Goals');
      expect(compactText).toContain('Technical Requirements');

      expect(text).not.toMatch(
        /^## (Executive Outcome|User Journey|Technical Approach|Implementation Breakdown|Outcomes & AC|Explicit Assumptions|Scope Boundary|Integration Contracts)$/m,
      );
      expect(text).not.toMatch(/^## Open Questions$/m);
    });

    it.each(['create_design_doc', 'edit_design_doc'] as const)(
      '%s requires and preserves complete Service implementation coverage',
      async (toolName) => {
        const result = await provider.getToolGuidance(
          { toolName },
          {} as any,
          {} as any,
        );
        const text = getText(result);
        const compactText = text.replace(/\s+/g, ' ');

        if (toolName === 'create_design_doc') {
          expect(compactText).toContain('Executive Outcome');
          expect(compactText).toContain('Explicit Assumptions');
          expect(compactText).toContain('Scope Boundary');
          expect(compactText).toContain('User Journey');
          expect(compactText).toContain('Outcomes & AC');
        }
        expect(compactText).toContain('Technical Approach');
        expect(compactText).toContain('Implementation Breakdown');
        expect(compactText).toContain('Integration Contracts');
        expect(compactText).toMatch(/ordered, outcome-oriented/);
        expect(compactText).toContain('prerequisites');
        expect(compactText).toMatch(/downstream handoff|hands to later units/);
        expect(compactText).toContain('boundary inputs and outputs');
        expect(compactText).toContain('observable verification');
        expect(compactText).toMatch(
          /complete known Service set|Name every service each unit modifies or relies on/,
        );
        expect(compactText).toMatch(
          /split (?:a unit )?only (?:when|if) the work (?:itself )?is independently executable|split only independently executable(?: cross-Service)? work/i,
        );
        expect(compactText).toContain('request paths');
        expect(compactText).toContain('data flows');
        expect(compactText).toContain('events');
        expect(compactText).toContain('payload agreements');
        expect(compactText).toContain('source of truth');
        expect(compactText).toContain('files');
        expect(compactText).toContain('symbols');
        expect(compactText).toContain('commands');
        expect(compactText).toContain('signatures');
        expect(compactText).toContain('diffs');
        expect(compactText).toContain('later phase grounding');
        expect(compactText).toContain('not a rigid checklist');
      },
    );

    it.each(['create_plan', 'create_design_doc', 'edit_design_doc'] as const)(
      '%s grounds scope in user authority without reintroducing conflicting rules',
      async (toolName) => {
        const result = await provider.getToolGuidance(
          { toolName },
          {} as any,
          {} as any,
        );
        const text = getText(result).replace(/\s+/g, ' ');

        expect(text.match(/## Plan scope and judgment/g)).toHaveLength(1);
        expect(text).toContain(
          'explicit decisions and corrections, and applicable existing requirements',
        );
        expect(text).toContain(
          'journey, design prose, and acceptance criteria cannot authorize one another',
        );
        expect(text).toContain(
          'Leave local implementation details to implementation',
        );
        expect(text).toContain('Omit optional improvements');
        expect(text).toContain(
          'different answers materially change behavior, scope, or required work',
        );
        expect(text).toContain('First check available context');
        expect(text).toContain(
          'Acceptance criteria must summarize authorized outcomes',
        );
        expect(text).toContain(
          'remove or revise unsupported assumptions and their downstream consequences',
        );
        expect(text).toContain(
          'Carry material grounded decisions and rationale',
        );
        expect(text).toContain('download filtered order history as CSV');
        expect(text).toContain('save restaurant dishes as favorites');
        expect(text).not.toContain('nothing left to invent');
        expect(text).not.toContain('one checked assumption');
        expect(text).not.toContain('Final User Journey scope-fidelity pass');
        expect(text).not.toContain('Compare every planned behavior');
        expect(text).not.toContain('design it there first');
        expect(text).not.toContain('Design unsupported behavior');
        expect(text).not.toContain(
          'Update the appropriate design section first',
        );
        expect(text).not.toContain('Carry every material decision');
      },
    );

    it('keeps plan proposal mechanics separate from scope guidance', async () => {
      const result = await provider.getToolGuidance(
        { toolName: 'create_plan' },
        {} as any,
        {} as any,
      );
      const text = getText(result);
      expect(text.indexOf('## Plan scope and judgment')).toBeLessThan(
        text.indexOf(
          'Submitting `create_plan` creates a proposal in DRAFT status.',
        ),
      );
      expect(text).toContain('Do NOT pre-materialize a design doc proposal');
    });
  });

  it('returns a clear isError CallToolResult for an unknown toolName', async () => {
    const result = await provider.getToolGuidance(
      { toolName: 'NOT_A_REAL_TOOL' as unknown as ToolGuidanceKey },
      {} as any,
      {} as any,
    );
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getText(result)).toContain('Unknown toolName');
  });

  it('returns deterministic shared topology guidance and a reusable root proof', () => {
    expect(provider.getAuthoringGuidance()).toEqual({
      guidance: TOPOLOGY_AUTHORING_GUIDANCE,
      authoringRootProof: AUTHORING_ROOT_PROOF,
    });
    expect(provider.getAuthoringGuidance()).toEqual(
      provider.getAuthoringGuidance(),
    );
    expect(TOPOLOGY_AUTHORING_GUIDANCE).toContain(
      'A durable authoritative producer interface may qualify before a consumer exists.',
    );
    expect(TOPOLOGY_AUTHORING_GUIDANCE).toContain(
      'outside a Diagram, use the narrowest authoritative operation',
    );
    expect(TOPOLOGY_AUTHORING_GUIDANCE).toContain(
      'Record participant responsibility explicitly: GUARANTEES identifies',
    );
    expect(TOPOLOGY_AUTHORING_GUIDANCE).toContain(
      'Diagram participant relationships are distinct',
    );
    expect(TOPOLOGY_AUTHORING_GUIDANCE).toContain(
      'Ad hoc interactions, broad channels, reference roll-ups',
    );
    expect(TOPOLOGY_AUTHORING_GUIDANCE).toContain(
      'structural parentage is sufficient for its owning feature',
    );
    expect(TOPOLOGY_AUTHORING_GUIDANCE).toContain(
      'create `RELATED_TO` for every other feature directly evidenced as providing, consuming, or enforcing',
    );
    expect(TOPOLOGY_AUTHORING_GUIDANCE).toContain(
      'prose mentions materialize neither relationship',
    );
    expect(TOPOLOGY_AUTHORING_GUIDANCE).toContain(
      'ancestors, incidental implementation features, or every downstream feature',
    );
    expect(TOPOLOGY_AUTHORING_GUIDANCE).toContain(
      'do not use feature-level `DEPENDS_ON` without a separately evidenced delivery dependency',
    );
  });

  it('rejects typed guidance until the shared root guidance has been read', async () => {
    const result = await provider.getToolGuidance(
      { toolName: 'create_work_item', workItemType: 'STANDARD' },
      {} as any,
      { headers: { 'x-project-id': PROJECT_ID } } as any,
    );

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(getText(result)).toContain('get_authoring_guidance()');
  });

  it('rejects an unknown toolName through the zod input parser', () => {
    const { z } = require('zod');
    const TOOL_GUIDANCE_KEYS = Object.keys(TOOL_GUIDANCE) as [
      string,
      ...string[],
    ];
    const inputSchema = z.object({ toolName: z.enum(TOOL_GUIDANCE_KEYS) });
    const parsed = inputSchema.safeParse({ toolName: 'NOT_A_REAL_TOOL' });
    expect(parsed.success).toBe(false);
  });
});
