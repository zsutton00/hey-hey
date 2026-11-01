import { describe, expect, it } from 'vitest';
import {
  RunEntityReferenceEntityTypeEnum,
  LocalPromptTaskType,
} from '../../../shared/agent-bridge-contract/generated/api';
import { buildProjectAssistantPrompt as buildPromptContract } from '../../prompts/project-assistant';
import type { AgentProviderId } from '../../providers/provider-config';
import type { ProjectAssistantPolicy } from '../../prompt-type-handler';

type ProjectAssistantBuildPayload = Parameters<typeof buildPromptContract>[0];

const ALL_POLICY: ProjectAssistantPolicy = {
  allowEdgeUpdates: false,
  notifyDiscrepancies: false,
  workItemProposalMode: 'all',
};

const buildProjectAssistantPrompt = (
  payload: ProjectAssistantBuildPayload,
  services: Parameters<typeof buildPromptContract>[1] = {},
  options: {
    handoffTo?: string;
    policy?: ProjectAssistantPolicy;
    focalTaskType?: LocalPromptTaskType;
    parallelResearchSubagents?: boolean;
    hasNearestParentFeature?: boolean;
    provider?: AgentProviderId;
  } = {},
): string =>
  buildPromptContract(payload, services, {
    handoffTo: options.handoffTo ?? 'coding_agent',
    policy: options.policy ?? ALL_POLICY,
    focalTaskType: options.focalTaskType ?? LocalPromptTaskType.Standard,
    parallelResearchSubagents: options.parallelResearchSubagents ?? false,
    hasNearestParentFeature: options.hasNearestParentFeature ?? true,
    provider: options.provider,
  });

const makePayload = (
  overrides: Partial<ProjectAssistantBuildPayload> = {},
): ProjectAssistantBuildPayload =>
  ({
    promptType: 'research',
    entity: {
      entityType: RunEntityReferenceEntityTypeEnum.Task,
      entityId: 'task-1',
    },
    startupInput: {
      focalEntity: {
        entityType: RunEntityReferenceEntityTypeEnum.Task,
        entityId: 'task-1',
      },
      task: {
        id: 'task-1',
        title: 'Wire research mode',
        taskType: LocalPromptTaskType.Standard,
        description: 'Do work.',
      },
      adjacentScopeTasks: [],
      evidenceItems: [],
    },
    ...overrides,
  }) as ProjectAssistantBuildPayload;

const buildPrompt = (
  payload: ProjectAssistantBuildPayload = makePayload(),
  policy: ProjectAssistantPolicy = ALL_POLICY,
  handoffTo?: string,
): string =>
  buildProjectAssistantPrompt(payload, {}, { policy, ...(handoffTo ? { handoffTo } : {}) });

describe('buildProjectAssistantPrompt with research subagents off', () => {
  const renderOff = (
    workItemProposalMode: ProjectAssistantPolicy['workItemProposalMode'],
    focalTaskType: LocalPromptTaskType = LocalPromptTaskType.Standard,
  ): string =>
    buildProjectAssistantPrompt(
      makePayload(),
      {},
      {
        policy: { allowEdgeUpdates: false, notifyDiscrepancies: true, workItemProposalMode },
        focalTaskType,
        parallelResearchSubagents: false,
      },
    );

  it('keeps the full prompt unchanged for every proposal mode', () => {
    expect(renderOff('none')).toMatchSnapshot('subagents off, proposal mode none');
    expect(renderOff('edit')).toMatchSnapshot(
      'subagents off, proposal mode edit, fulfilledBy-eligible standard task',
    );
    expect(renderOff('all')).toMatchSnapshot(
      'subagents off, proposal mode all, fulfilledBy-eligible standard task',
    );
    expect(renderOff('all', LocalPromptTaskType.Feature)).toMatchSnapshot(
      'subagents off, proposal mode all, non-standard task',
    );
  });
});

describe('buildProjectAssistantPrompt', () => {
  it('requests maintenance advice only after bounded artifact discovery', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('purpose: "maintenance"');
    expect(prompt).not.toContain('`get_work_item_type_guidance`');
    expect(prompt).toContain('`get_work_item_type_guidance_batch`');
    expect(prompt).toContain('typeKeys: [key]');
    expect(prompt).toContain('deduplicated array of 1–10 relevant encountered keys');
    expect(prompt).toContain('same purpose');
    expect(prompt).toContain('request order');
    expect(prompt).toContain('do not load the type catalog');
    expect(prompt).toContain('once per encountered type');
    expect(prompt).toContain('preserve Diagram Element identities and task traceability');
  });
  it('matches full subagents-on parent prompts for enabled and disabled proposal authority', () => {
    expect(
      buildProjectAssistantPrompt(makePayload(), {}, { parallelResearchSubagents: true }),
    ).toMatchSnapshot('proposal drafting enabled');
    expect(
      buildProjectAssistantPrompt(
        makePayload(),
        {},
        {
          policy: {
            allowEdgeUpdates: false,
            notifyDiscrepancies: false,
            workItemProposalMode: 'none',
          },
          parallelResearchSubagents: true,
        },
      ),
    ).toMatchSnapshot('proposal drafting disabled');
  });

  it('applies intent-first Contract discovery to Diagram aggregates without widening authority', () => {
    const prompt = buildProjectAssistantPrompt(
      makePayload(),
      {},
      {
        policy: {
          allowEdgeUpdates: false,
          notifyDiscrepancies: false,
          workItemProposalMode: 'none',
        },
      },
    );

    expect(prompt).toContain('## Contract discovery through Diagrams');
    expect(prompt).toMatch(/provider-owned durable intent is the threshold/i);
    expect(prompt).toMatch(/even before any consumer exists/i);
    expect(prompt).toMatch(
      /Cross-feature scope, consumer count, an endpoint, a schema, a broad channel, or an ordinary dependency does not establish a Contract by itself/i,
    );
    expect(prompt).toMatch(
      /read its elements, flow links, fulfillment links, Contract participation, and informational links with `get_diagram`/i,
    );
    expect(prompt).toMatch(
      /Diagram entity types use `get_diagram` instead of `get_context`; never infer Diagram Elements or topology from orientation context/i,
    );
    expect(prompt).toMatch(/explicitly GUARANTEES the existing Contract/i);
    expect(prompt).toMatch(/GUARANTEES, IMPLEMENTS, or CONSUMES responsibility is missing/i);
    expect(prompt).toMatch(/evidenced provider intent with no existing Contract/i);
    expect(prompt).toMatch(/plausible but unconfirmed provider intent/i);
    expect(prompt).toMatch(/ordinary non-contractual flow/i);
    expect(prompt).toMatch(
      /`STANDARD`, `CONDITIONAL`, and `LOOP` process flow, `FULFILLED_BY` implementation evidence, and explicit `GUARANTEES`, `IMPLEMENTS`, and `CONSUMES` participant responsibilities separate/i,
    );
    expect(prompt).toMatch(/Never create a legacy Diagram-element `DEPENDS_ON` Contract link/i);
    expect(prompt).toMatch(/Graph edge updates are disabled/i);
    expect(prompt).toMatch(/Visible discrepancy notices are disabled/i);
    expect(prompt).toMatch(/Work-item proposal drafting is disabled/i);
    expect(prompt).toMatch(/classifications remain required handoff context/i);
  });

  it('calibrates readiness evidence around settled behavior and evidenced choices', () => {
    const prompt = buildPrompt();

    expect(prompt).toMatch(
      /routine fault localization, service ownership tracing, code discovery/i,
    );
    expect(prompt).toMatch(/possible Temporal, migration, rollout, or cross-service consequence/i);
    expect(prompt).toMatch(/materially different valid outcomes/i);
    expect(prompt).toContain(
      'The Clarify-routing behavior and workflow-aware routing are already recorded',
    );
    expect(prompt).toContain('Authoritative context leaves two or more valid lifecycle');
  });

  it('frames the project graph as the primary lens, stated positively', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('The project is the primary lens');
    expect(prompt).toContain('The project graph is the subject.');
    // No archeology: never contrasts against the trigger prompt as a prior subject.
    expect(prompt).not.toMatch(/not the user's trigger prompt/i);
    expect(prompt).not.toContain('hey hey');
  });

  it('names the consuming handler in the bootstrap and summary handoff', () => {
    const dflt = buildProjectAssistantPrompt(makePayload());
    expect(dflt).toContain('consuming handler "coding_agent"');
    expect(dflt).toMatch(/50–100 word handoff to the "coding_agent" handler/i);

    const custom = buildProjectAssistantPrompt(makePayload(), {}, { handoffTo: 'planning_agent' });
    expect(custom).toContain('consuming handler "planning_agent"');
    expect(custom).toMatch(/50–100 word handoff to the "planning_agent" handler/i);
    expect(custom).not.toContain('"coding_agent"');
  });

  it('gives a key-concepts → traverse → search method scoped by the entity and ask', () => {
    const prompt = buildPrompt();
    expect(prompt).toMatch(/Extract the key concepts/i);
    expect(prompt).toMatch(/Traverse the graph from the focal entity outward/i);
    expect(prompt).toMatch(/Search on the same key concepts/i);
    expect(prompt).toMatch(/multiple hops/i);
  });

  it('points both research modes at the injected nearest parent feature', () => {
    const off = buildProjectAssistantPrompt(
      makePayload(),
      {},
      { parallelResearchSubagents: false },
    );
    const on = buildProjectAssistantPrompt(makePayload(), {}, { parallelResearchSubagents: true });
    expect(off).toMatch(
      /under "Nearest parent feature", its nearest parent feature in full; carry that feature's governing requirements and contracts into the frame/,
    );
    expect(on).toMatch(
      /Seed: carry the governing requirements and contracts of the nearest parent feature, given in full under "Nearest parent feature", into your analysis/,
    );
    expect(off).not.toContain('get_full_entity');
  });

  it('omits the parent feature wording when the focal entity has no parent feature', () => {
    const off = buildProjectAssistantPrompt(makePayload(), {}, { hasNearestParentFeature: false });
    const on = buildProjectAssistantPrompt(
      makePayload(),
      {},
      {
        parallelResearchSubagents: true,
        hasNearestParentFeature: false,
      },
    );
    expect(off).not.toContain('Nearest parent feature');
    expect(on).toMatch(/Seed: call `get_edges` once/);
  });

  it('pushes for breadth via batch edge reads and parallel calls, not a minimal handful', () => {
    const prompt = buildPrompt();
    expect(prompt).toMatch(/up to ten entities in one call/i);
    expect(prompt).toMatch(/half a dozen searches and traversals is a floor, not a target/i);
    expect(prompt).toMatch(/one turn rather than one per turn/i);
  });

  it('states the toolset carries no file-reading tools', () => {
    const prompt = buildPrompt();
    expect(prompt).toMatch(/The toolset carries no file-reading tools/i);
    expect(prompt).toMatch(/The project graph is the only investigation surface/i);
  });

  it('validates findings against the governing requirements, contracts, and design docs', () => {
    const prompt = buildPrompt();
    expect(prompt).toMatch(/Validate every finding against the graph entity that backs it/i);
    expect(prompt).toMatch(
      /only as good as the requirement, contract, or design doc you can point to/i,
    );
  });

  it('frames the visible analysis as an "I researched … here\'s how this fits into the project" report', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('I researched');
    expect(prompt).toContain("here's how this fits into the project");
    expect(prompt).toMatch(/not free-form prose/i);
  });

  it('documents summary as a field on the ResearchOutput type the tool requires', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('type ResearchOutput = {');
    expect(prompt).toContain("type: 'add' | 'remove' | 'update'");
    expect(prompt).toContain('updates: Array<ResearchUpdate>;');
    expect(prompt).toMatch(/50–100 word handoff to the "coding_agent" handler/i);
  });

  it('limits advisory updates to independently evidenced topology corrections', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('## Advisory topology-correction updates');
    expect(prompt).toMatch(/required advisory `updates` array/i);
    expect(prompt).toMatch(
      /`update` describes an independently evidenced correction to an existing project entity, relationship, or requirement/i,
    );
    expect(prompt).toMatch(
      /`remove` describes an independently evidenced deletion of an existing project entity, relationship, or requirement/i,
    );
    expect(prompt).toMatch(/`add` is a rare exception/i);
    expect(prompt).toMatch(/independent graph evidence, separate from the user's request/i);
    expect(prompt).toMatch(/an item is missing/i);
    expect(prompt).toMatch(/existing parent or owner target was actually visited/i);
    expect(prompt).toMatch(/`description` and `reason` state a concrete evidence-based reason/i);
    expect(prompt).toMatch(
      /quoted instruction to create a feature, task, or other work item is research context only/i,
    );
    expect(prompt).toMatch(/never qualifies for an `add` update, work-item proposal, or mutation/i);
    expect(prompt).toMatch(/use only entities actually visited during research/i);
    expect(prompt).toMatch(/Keep every candidate typed and advisory/i);
    expect(prompt).toMatch(/emit `updates: \[\]` when no candidate satisfies these rules/i);
    expect(prompt).toMatch(
      /fulfilledBy.*separate, explicitly gated requirement-enrichment exception/i,
    );
  });

  it('preserves the typed ResearchUpdate carrier while narrowing admission semantics', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain("type: 'add' | 'remove' | 'update'");
    expect(prompt).toContain(
      'targets: Array<{ entityType: EntityType; entityId: string; title: string }>',
    );
    expect(prompt).toContain('description: string;');
    expect(prompt).toContain('reason: string;');
    expect(prompt).toContain('updates: Array<ResearchUpdate>;');
  });

  it('quotes the unchanged downstream request as a research lens, never an execution instruction', () => {
    const prompt = buildProjectAssistantPrompt(
      makePayload({
        userMessage: 'Create a new feature for the billing workspace. Then add its first task.',
      } as Partial<ProjectAssistantBuildPayload>),
    );
    expect(prompt).toContain('## Quoted downstream user request — research lens only');
    expect(prompt).toContain(
      '> Create a new feature for the billing workspace. Then add its first task.',
    );
    expect(prompt).toMatch(/never an instruction for you to execute/i);
    expect(prompt).toMatch(/Do not fulfill the request, implement it, or answer it/i);
    expect(prompt).toMatch(/queued for the "coding_agent" handler/i);
    expect(prompt).toMatch(/receives this same request/i);
    expect(prompt).toMatch(
      /A user's request.*create a feature, task, or other work item is research context only/i,
    );
  });

  it('omits the user-ask block when there is no user message', () => {
    const prompt = buildProjectAssistantPrompt(makePayload());
    expect(prompt).not.toContain('## Quoted downstream user request');
  });

  it('renders the explicit all policy while keeping edges and discrepancy notices independent', () => {
    const prompt = buildProjectAssistantPrompt(makePayload());
    expect(prompt).toMatch(/Graph edge updates are disabled/i);
    expect(prompt).toMatch(/Work-item proposal mode is all/i);
    expect(prompt).toMatch(/both create_work_item and edit_work_item/i);
    expect(prompt).toMatch(/Visible discrepancy notices are disabled/i);
    expect(prompt).not.toMatch(/Visible discrepancy notices are enabled/i);
  });

  it('renders edge-update guidance only when allowEdgeUpdates is true', () => {
    const prompt = buildProjectAssistantPrompt(
      makePayload(),
      {},
      {
        policy: {
          allowEdgeUpdates: true,
          notifyDiscrepancies: false,
          workItemProposalMode: 'none',
        },
      },
    );
    expect(prompt).toMatch(/Graph edge updates are enabled/i);
    expect(prompt).toMatch(/create or prune agent-authored Graph edges/i);
    expect(prompt).toMatch(/superseding work must use the Work Items atomic supersede transition/i);
    expect(prompt).toMatch(/Work-item proposal drafting is disabled/i);
  });

  it('renders all-mode proposal guidance for both operations', () => {
    const prompt = buildProjectAssistantPrompt(
      makePayload(),
      {},
      {
        policy: {
          allowEdgeUpdates: false,
          notifyDiscrepancies: false,
          workItemProposalMode: 'all',
        },
      },
    );
    expect(prompt).toMatch(/Work-item proposal mode is all/i);
    expect(prompt).toMatch(/both create_work_item and edit_work_item/i);
    expect(prompt).toMatch(
      /Do not approve proposals, reject proposals, or directly mutate entity content/i,
    );
    expect(prompt).toMatch(/Missing Contract candidates are always part of the bootstrap handoff/i);
    expect(prompt).toMatch(/frame, analysis, and summary/i);
    expect(prompt).toMatch(/draft the CONTRACT work item in the same agent turn/i);
    expect(prompt).toMatch(/Do not create a detached Contract proposal/i);
    expect(prompt).toMatch(/Graph edge updates are disabled/i);
  });

  it('renders distinct create, edit, and none proposal postures', () => {
    const render = (workItemProposalMode: ProjectAssistantPolicy['workItemProposalMode']) =>
      buildProjectAssistantPrompt(
        makePayload(),
        {},
        {
          policy: {
            allowEdgeUpdates: false,
            notifyDiscrepancies: false,
            workItemProposalMode,
          },
        },
      );

    const create = render('create');
    expect(create).toMatch(/proposal mode is create/i);
    expect(create).toContain('create_work_item');
    expect(create).toMatch(/edit_work_item is forbidden/i);

    const edit = render('edit');
    expect(edit).toMatch(/proposal mode is edit/i);
    expect(edit).toContain('edit_work_item');
    expect(edit).toMatch(/create_work_item is forbidden/i);

    const none = render('none');
    expect(none).toMatch(/proposal drafting is disabled/i);
    expect(none).toMatch(/Do not call create_work_item or edit_work_item/i);
  });

  it('renders the bounded Features fulfilledBy suggestion path for standard task context', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('## Bounded fulfilledBy suggestion case');
    expect(prompt).toContain(
      '@[feature:db52951d-ba40-4a87-aa6c-e17f98e792b5|Features] requirements',
    );
    expect(prompt).toContain('sections[requirements]');
    expect(prompt).toContain('content.sections["requirements"]');
    expect(prompt).toContain('ordered `records`');
    expect(prompt).toContain('stored durable `id`');
    expect(prompt).not.toContain('requirementsStructured');
    expect(prompt).toContain('fulfilledBy.add');
    expect(prompt).toContain('entityType: "TASK"');
    expect(prompt).toContain('exactly one');
    expect(prompt).toContain('high-confidence semantic match');
    expect(prompt).toContain('@[feature:6851536e-519e-4c06-86a1-4bdbcff192a7|Features Backend]');
    expect(prompt).toContain('@[feature:b98f60b9-2185-4926-a91a-d8e9991fbdd8|Features Page]');
    expect(prompt).toContain('Do not rewrite the raw requirements section');
  });

  it('does not render the actionable fulfilledBy proposal path when proposal drafting is disabled', () => {
    const prompt = buildProjectAssistantPrompt(
      makePayload(),
      {},
      {
        policy: {
          allowEdgeUpdates: false,
          notifyDiscrepancies: false,
          workItemProposalMode: 'none',
        },
      },
    );
    expect(prompt).toMatch(/Work-item proposal drafting is disabled/i);
    expect(prompt).toContain('This Run is not eligible for the fulfilledBy suggestion path');
    expect(prompt).toContain('disabled edit authority');
    expect(prompt).not.toContain('fulfilledBy.add');
    expect(prompt).toMatch(/Missing Contract candidates are always part of the bootstrap handoff/i);
    expect(prompt).toMatch(/do not draft the Contract or any companion mutation/i);
    expect(prompt).toMatch(/carry the candidate forward for the downstream agent/i);
    expect(prompt).toMatch(/required even when visible discrepancy notices are disabled/i);
  });

  it('does not render the actionable fulfilledBy proposal path for non-task focal context', () => {
    const prompt = buildPrompt(
      makePayload({
        entity: {
          entityType: RunEntityReferenceEntityTypeEnum.DesignDoc,
          entityId: 'plan-1',
        },
        startupInput: {
          task: {
            id: 'task-1',
            title: 'Wire research mode',
            taskType: LocalPromptTaskType.Standard,
            description: 'Do work.',
          },
          focalEntity: {
            entityType: RunEntityReferenceEntityTypeEnum.DesignDoc,

            entityId: 'plan-1',
          },
          adjacentScopeTasks: [],
          evidenceItems: [],
        },
      }),
    );
    expect(prompt).toContain('This Run is not eligible for the fulfilledBy suggestion path');
    expect(prompt).toContain('Non-task focal context');
    expect(prompt).not.toContain('fulfilledBy.add');
  });

  it('researches originating conversations for non-task focal context', () => {
    const prompt = buildPrompt(
      makePayload({
        entity: {
          entityType: RunEntityReferenceEntityTypeEnum.DesignDoc,
          entityId: 'plan-1',
        },
        startupInput: {
          task: {
            id: 'task-1',
            title: 'Wire research mode',
            taskType: LocalPromptTaskType.Standard,
            description: 'Do work.',
          },
          focalEntity: {
            entityType: RunEntityReferenceEntityTypeEnum.DesignDoc,
            entityId: 'plan-1',
          },
          adjacentScopeTasks: [],
          evidenceItems: [],
        },
      }),
    );

    expect(prompt).toContain('## Source-conversation continuity');
    expect(prompt).toMatch(/proposal lineage as a research input for every focal entity type/i);
    expect(prompt).toMatch(/resolve the Agent Session that owns that conversation/i);
    expect(prompt).toMatch(/call `get_agent_session`/i);
    expect(prompt).toMatch(/newest-first page of Conversation messages/i);
    expect(prompt).toMatch(/pass it back as `cursor` to continue toward older messages/i);
    expect(prompt).toMatch(/Do not substitute `get_agent_sessions`/i);
    expect(prompt).toMatch(/Conversations `since` cursor/i);
    expect(prompt).toMatch(/inspect at least the latest relevant messages/i);
    expect(prompt).toMatch(/Do not assume the focal entity's title, summary, description/i);
    expect(prompt).toMatch(/settled reasoning, decisions, debugging conclusions, design choices/i);
    expect(prompt).toMatch(/downstream `frame`, `analysis`, and `summary`/i);
    expect(prompt).toMatch(/later corrections/i);
    expect(prompt).toMatch(/independent of recent Project Assistant report reuse/i);
    expect(prompt).toMatch(/do not change report selection, age or staleness caveats/i);
  });

  it('does not render the actionable fulfilledBy proposal path for non-standard tasks', () => {
    const prompt = buildProjectAssistantPrompt(
      makePayload(),
      {},
      { focalTaskType: LocalPromptTaskType.Feature },
    );
    expect(prompt).toContain('This Run is not eligible for the fulfilledBy suggestion path');
    expect(prompt).toContain('the task type is STANDARD');
    expect(prompt).not.toContain('fulfilledBy.add');
  });

  it('treats ambiguous matches as no-proposal cases in the bounded suggestion guidance', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('multiple requirements plausibly match');
    expect(prompt).toContain('the best match is ambiguous');
    expect(prompt).toContain('make no fulfilledBy proposal');
  });

  it('renders discrepancy-notice guidance only when notifyDiscrepancies is true', () => {
    const prompt = buildProjectAssistantPrompt(
      makePayload(),
      {},
      {
        policy: {
          allowEdgeUpdates: false,
          notifyDiscrepancies: true,
          workItemProposalMode: 'none',
        },
      },
    );
    expect(prompt).toMatch(/Visible discrepancy notices are enabled/i);
    expect(prompt).toMatch(
      /stale requirements, missing links, contradictions, or likely update targets/i,
    );
    expect(prompt).toMatch(/Graph edge updates are disabled/i);
    expect(prompt).toMatch(/Work-item proposal drafting is disabled/i);
  });

  it('discovers only owned or Feature-applicable MODE bundles and deduplicates selective reads', () => {
    const prompt = buildPrompt();

    expect(prompt).toContain('## Project MODE freshness (bounded Feature-neighborhood extension)');
    expect(prompt).toMatch(/Do not scan or enumerate the project-wide MODE catalog/i);
    expect(prompt).toMatch(/Structural ownership[\s\S]{0,500}globally runnable mode/i);
    expect(prompt).toMatch(
      /outbound MODE-to-Feature `DEPENDS_ON`[\s\S]{0,300}visited Feature or one of its ancestors/i,
    );
    expect(prompt).toMatch(/Structural parentage and `RELATED_TO` are non-filtering/i);
    expect(prompt).toMatch(/Exclude MODE work items that match neither ownership nor outbound/i);
    expect(prompt).toMatch(/Deduplicate candidates by MODE identity/i);
    expect(prompt).toMatch(/Hydrate only the deduplicated MODE bundles needed/i);
    expect(prompt).toMatch(/never directly mutate MODE instructions or supporting files/i);
  });

  it('keeps stale MODE findings inside the configured discrepancy and edit-proposal ceiling', () => {
    const disabled = buildProjectAssistantPrompt(
      makePayload(),
      {},
      {
        policy: {
          allowEdgeUpdates: false,
          notifyDiscrepancies: false,
          workItemProposalMode: 'none',
        },
      },
    );
    const createOnly = buildProjectAssistantPrompt(
      makePayload(),
      {},
      {
        policy: {
          allowEdgeUpdates: false,
          notifyDiscrepancies: true,
          workItemProposalMode: 'create',
        },
      },
    );
    const editEnabled = buildProjectAssistantPrompt(
      makePayload(),
      {},
      {
        policy: {
          allowEdgeUpdates: false,
          notifyDiscrepancies: true,
          workItemProposalMode: 'edit',
        },
      },
    );

    expect(disabled).toMatch(
      /advisory update candidate only when this Run enables discrepancy notices/i,
    );
    expect(disabled).toMatch(/`none` and `create` cannot propose MODE content edits/i);
    expect(createOnly).toMatch(/Work-item proposal mode is create/i);
    expect(createOnly).toMatch(/edit_work_item is forbidden/i);
    expect(editEnabled).toMatch(/Work-item proposal mode is edit/i);
    expect(editEnabled).toMatch(
      /Draft a targeted MODE edit proposal only when edit proposal authority is enabled/i,
    );
    expect(editEnabled).toMatch(/do not directly mutate or approve MODE content/i);
  });

  it('waits for subagents, combines their slice handoffs, and reads only for gaps or contradictions', () => {
    const prompt = buildProjectAssistantPrompt(
      makePayload(),
      {},
      { parallelResearchSubagents: true },
    );
    expect(prompt).toContain('Your main job is combining their handoffs, not researching.');
    expect(prompt).toContain('make no further research reads until `run_subagents` returns');
    expect(prompt).toContain('Merge them into your single `ResearchOutput`');
    expect(prompt).toContain('treat failed, cancelled, or interrupted children as gaps');
    expect(prompt).toContain('or to settle a point where two children disagree');
    expect(prompt).not.toContain("check each child's findings against the graph");
  });

  describe('with research subagents on', () => {
    const CHECK_HEADINGS = [
      '## On-demand maintenance guidance',
      '## Source-conversation continuity',
      '## Implementation-readiness evidence',
      '## Contract discovery through Diagrams',
      '## Advisory topology-correction updates',
      '## Bounded fulfilledBy suggestion case',
      '## What "relevant surrounding graph" means',
      '## Project MODE freshness',
    ];
    const renderOn = (policy: ProjectAssistantPolicy = ALL_POLICY): string =>
      buildProjectAssistantPrompt(makePayload(), {}, { policy, parallelResearchSubagents: true });

    it('leaves every research check to the children', () => {
      const prompt = renderOn();
      for (const heading of CHECK_HEADINGS) expect(prompt).not.toContain(heading);
      expect(prompt).not.toContain('`## Advisory topology-correction updates`');
    });

    it('keeps the gates, the subagent steps, the output contract and the posture', () => {
      const prompt = renderOn();
      for (const heading of [
        '## Parallel research subagents',
        '## Capability gates',
        '## What you produce',
        '## Content-rewrite license',
        '## Posture',
      ]) {
        expect(prompt).toContain(heading);
      }
      expect(prompt).toMatch(
        /Draft a targeted MODE edit proposal only when edit proposal authority/i,
      );
      expect(prompt).toContain('update candidates the children report');
    });

    it('gives the originating proposal lineage to exactly one child', () => {
      expect(renderOn()).toContain(
        "Assign the focal entity's originating proposal and its source conversation to exactly one group",
      );
    });

    it('names unverified checks for failed children rather than reporting a clean result', () => {
      expect(renderOn()).toContain(
        'name in your analysis each research check that went unverified',
      );
    });

    it('drafts gated proposals from child candidates, with the fulfilledBy cite only when eligible', () => {
      const all = renderOn();
      expect(all).toContain('children never draft');
      expect(all).toContain('fulfilledBy.add');

      const none = renderOn({ ...ALL_POLICY, workItemProposalMode: 'none' });
      expect(none).toMatch(/Work-item proposal drafting is disabled/i);
      expect(none).not.toContain('fulfilledBy.add');
    });
  });

  it('omits the parallel research section when subagents are disabled', () => {
    const prompt = buildProjectAssistantPrompt(
      makePayload(),
      {},
      { parallelResearchSubagents: false },
    );
    expect(prompt).not.toContain('## Parallel research subagents');
    expect(prompt).not.toContain('run_subagents');
  });

  it('ends with the submission-tool termination suffix rather than a hardcoded tool name', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('mcp__heyhey-submission-tools__');
    expect(prompt).not.toContain('create_coding_research');
  });

  it('names the submission tools the way the Run provider exposes them', () => {
    const options = { policy: ALL_POLICY };
    const codexPrompt = buildProjectAssistantPrompt(
      makePayload(),
      {},
      { ...options, provider: 'codex' },
    );
    const claudePrompt = buildProjectAssistantPrompt(
      makePayload(),
      {},
      { ...options, provider: 'claude' },
    );

    expect(codexPrompt).toContain('mcp__heyhey_submission_tools__<name>');
    expect(codexPrompt).not.toContain('mcp__heyhey-submission-tools__');
    expect(claudePrompt).toContain('mcp__heyhey-submission-tools__<name>');
    expect(claudePrompt).not.toContain('mcp__heyhey_submission_tools__');
  });

  it('requires canonical report schema lookup and explains the submission wrapper projection', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('get_report_schema({ reportType: "CODING_RESEARCH" })');
    expect(prompt).toContain('submission wrapper owns `reportType`');
    expect(prompt).toContain(
      'both `discoveryCalls` and `edgesTraversed` belong inside `provenance`',
    );
  });

  it('uses the canonical focal projection before conditional graph reads', () => {
    const prompt = buildPrompt();
    expect(prompt).toContain('You already have its canonical focal projection');
    expect(prompt).toContain('Do not reload that same focal entity by default');
    expect(prompt).toContain('different referenced entity');
    expect(prompt).toContain('supplied neighborhood is insufficient');
    expect(prompt).not.toContain('entityId: "task-1"');
  });
});
