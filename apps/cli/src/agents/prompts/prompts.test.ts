import { describe, expect, it } from 'vitest';
import { buildActivityResponsibilities } from './knowledge-responsibilities';
import type {
  LocalChildTaskUpdatesPromptPayload,
  LocalEntityConversationPromptPayload,
  LocalFinalAssessmentPromptPayload,
  LocalFreeFormPromptPayload,
  LocalGoalPmPromptPayload,
  LocalPromptStartupInput,
  LocalSetSplittingPromptPayload,
  LocalStartupSessionPromptPayload,
  LocalVerificationPlanPromptPayload,
} from '../../shared/agent-bridge-contract/index';
import type { LocalEntityConversationEntityEntityTypeEnum } from '../../shared/agent-bridge-contract/generated/api';
import type { ImplementationReadinessSourceSnapshot } from '../../shared/api/generated/api';
import { buildChildTaskUpdatesPrompt } from './child-task-updates';
import {
  buildPlatformSystemPrompt,
  buildServicesContextBlock,
  consultGraphBeforeAsking,
  intentFirstGuidance,
  takingShapeGuidance,
  hintReadingGuidance,
  hintWritingGuidance,
  focalContextOrientation,
  planVsTasksFork,
} from './common';
import { ProjectMaturity } from '../../shared/api/index';
import type { WorkItemTypeDefinitionDto } from './render-type-ontology';
import { buildCodingConversationPrompt } from './coding-conversation';
import { buildCompletionReconciliationPromptFor } from '../completion-reconciliation/prompts/common';
import { buildEntityConversationPrompt } from './entity-conversation';
import { buildFeatureTreeConversationPrompt } from '../feature-tree-conversation/feature-tree-conversation-prompt';
import { buildFinalAssessmentPrompt } from './final-assessment';
import { buildReviewPrompt } from './review';
import { buildSetSplittingPrompt } from './set-splitting';
import { buildCodingPlanPrompt } from './coding-plan';
import { buildVerificationPlanPrompt } from './verification-plan';
import { buildGoalPmPrompt } from './goal-pm';
import { buildHtmlCssMockupRevisionPrompt } from './html-css-mockup-revision';

const makeStartupInput = (overrides: Record<string, unknown> = {}): LocalPromptStartupInput =>
  ({
    task: {
      id: 'task-1',
      title: 'Test task',
      description: 'Implement feature X',
      acceptanceCriteria: 'Feature X works',
      taskType: 'FEATURE',
      ...overrides,
    },
    evidenceItems: [],
    adjacentScopeTasks: [],
  }) as unknown as LocalPromptStartupInput;

const makeContext = (): LocalFinalAssessmentPromptPayload['context'] =>
  ({
    organizationId: 'org-1',
    projectId: 'proj-1',
    taskId: 'task-1',
  }) as unknown as LocalFinalAssessmentPromptPayload['context'];

const emptyNeighborhood = (): LocalFinalAssessmentPromptPayload['taskNeighborhood'] => ({
  parentTasks: [],
  childTasks: [],
});

const sampleDefs = [
  {
    key: 'FEATURE',
    name: 'Feature',
  },
  {
    key: 'GOAL',
    name: 'Goal',
    allowedParentTypes: [],
  },
  {
    key: 'CONTRACT',
    name: 'Contract',
    description:
      'A user-authored, first-class marker that a narrowly stated durable agreement exists at a concrete boundary. A durable authoritative producer interface may qualify before a consumer exists.',
    edgeTargets: [{ edgeType: 'RELATED_TO', targetTypeKeys: ['FEATURE'] }],
  },
] as unknown as WorkItemTypeDefinitionDto[];

describe('buildHtmlCssMockupRevisionPrompt', () => {
  it('snapshots the complete atomic revision instruction', () => {
    expect(
      buildHtmlCssMockupRevisionPrompt({
        taskId: '11111111-1111-4111-8111-111111111111',
        payload: {
          payloadVersion: 1,
          section: {
            key: 'mockup',
            html: '<main data-hh-id="root">Hello</main>',
            css: 'main { color: #777; }',
            sizeKey: 'desktop',
            renderedSize: { width: 1440, height: 900 },
            materializedProposalId: '22222222-2222-4222-8222-222222222222',
          },
          annotations: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              note: 'Increase contrast',
              category: 'issue',
              lifecycle: 'open',
              authoredProposalId: '22222222-2222-4222-8222-222222222222',
              authoredSizeKey: 'desktop',
              target: {
                type: 'element',
                nodeId: 'root',
                renderedContext: {
                  outerHtmlExcerpt: '<main data-hh-id="root">Hello</main>',
                  bounds: { x: 0, y: 0, width: 500, height: 300 },
                },
              },
            },
          ],
        },
      }),
    ).toMatchSnapshot();
  });
});

describe('buildServicesContextBlock', () => {
  const services = [
    { id: 'service-a', path: '/host/service-a' },
    { id: 'service-b', path: '/host/service-b' },
  ];

  it('projects every selected Service into its authoritative resolved worktree', () => {
    const result = buildServicesContextBlock({
      services,
      launchServiceId: 'service-b',
      worktreeState: {
        'service-a': {
          repoPath: '/host/service-a',
          worktreePath: '/worktrees/service-a',
          branch: 'feature/worktrees',
        },
        'service-b': {
          repoPath: '/host/service-b',
          worktreePath: '/worktrees/service-b',
          branch: 'feature/worktrees',
        },
      },
    });

    expect(result).toMatchSnapshot();
    expect(result).toContain('Launch service `service-b` at `/worktrees/service-b`');
    expect(result).toContain('`service-a` at `/worktrees/service-a`');
    expect(result).not.toContain('/host/service-a');
    expect(result).not.toContain('/host/service-b');
    expect(result).toContain("Host checkouts are outside this session's working context");
    expect(result).toContain('Mentions of a Service or repository');
    expect(result).toContain('do not authorize inspection, edits, commits, or mutating commands');
    expect(result).toContain('explicit corresponding worktree path');
    expect(result).toContain('never infer a worktree path');
  });

  it('retains checkout paths and omits worktree guidance without complete resolved state', () => {
    const result = buildServicesContextBlock({
      services,
      launchServiceId: 'service-a',
    });

    expect(result).toMatchSnapshot();
    expect(result).toContain('Launch service `service-a` at `/host/service-a`');
    expect(result).toContain('`service-b` at `/host/service-b`');
    expect(result).not.toContain('worktree-backed session');
    expect(result).not.toContain('Host checkouts are outside');
    expect(result).toContain('Mentions of a Service or repository');
  });

  it('fails closed instead of exposing host checkouts for a partial worktree projection', () => {
    expect(() =>
      buildServicesContextBlock({
        services,
        launchServiceId: 'service-a',
        worktreeState: {
          'service-a': {
            repoPath: '/host/service-a',
            worktreePath: '/worktrees/service-a',
            branch: 'feature/worktrees',
          },
        },
      }),
    ).toThrow(
      'Worktree-backed Services context is incomplete; every in-scope Service requires an explicit worktree path.',
    );
  });
});

describe('focalContextOrientation', () => {
  it('accepts canonical startup context and limits additional reads to conditional cases', () => {
    expect(focalContextOrientation).toContain('initial orientation');
    expect(focalContextOrientation).toContain('Do not reload that same focal entity by default');
    expect(focalContextOrientation).toContain('user requests fresh state');
    expect(focalContextOrientation).toContain('different referenced entity');
    expect(focalContextOrientation).toContain('supplied neighborhood is insufficient');
    expect(focalContextOrientation).not.toContain('entityId:');
  });
});

describe('buildPlatformSystemPrompt', () => {
  it('adds hint guidance only for sessions with hint tools, after implementation hints', () => {
    const options = (hints: 'write' | 'read' | 'none') =>
      buildPlatformSystemPrompt(sampleDefs, undefined, {
        intentFirst: false,
        maturity: ProjectMaturity.Established,
        hints,
      });
    const omitted = buildPlatformSystemPrompt(sampleDefs);

    expect(options('none')).toBe(omitted);
    expect(options('write')).toContain(hintWritingGuidance);
    expect(options('write')).not.toContain(hintReadingGuidance);
    expect(options('read')).toContain(hintReadingGuidance);
    expect(options('read')).not.toContain(hintWritingGuidance);
    expect(options('write').indexOf(hintWritingGuidance)).toBeGreaterThan(
      options('write').indexOf('## Implementation hints'),
    );
  });

  it('words hint writing neutrally and records the direction, not the mood', () => {
    expect(hintWritingGuidance).toContain('emphatic about a correction or repeats it');
    expect(hintWritingGuidance).toContain('never how it was said');
    expect(hintWritingGuidance).not.toMatch(/angry|annoyed|forceful|frustrat/i);
    expect(hintReadingGuidance).toContain('Never write hints.');
    for (const guidance of [hintWritingGuidance, hintReadingGuidance]) {
      expect(guidance).toContain('separate from implementation hints');
    }
  });
  it('adds the Taking shape guidance only for that stage, right after the graph-before-asking section', () => {
    const taking = buildPlatformSystemPrompt(sampleDefs, undefined, {
      intentFirst: false,
      maturity: ProjectMaturity.TakingShape,
      hints: 'none',
    });
    const established = buildPlatformSystemPrompt(sampleDefs, undefined, {
      intentFirst: false,
      maturity: ProjectMaturity.Established,
      hints: 'none',
    });
    const omitted = buildPlatformSystemPrompt(sampleDefs);

    expect(established).toBe(omitted);
    expect(established).not.toContain('still taking shape');
    expect(taking).toContain(`${consultGraphBeforeAsking}\n\n${takingShapeGuidance}\n\n`);
    expect(taking.replace(`${takingShapeGuidance}\n\n`, '')).toBe(omitted);
  });

  it('tells Taking shape agents what to weight, distinguish, suggest and offer to record', () => {
    expect(takingShapeGuidance).toContain(
      "much of this project's intent exists only in conversations",
    );
    expect(takingShapeGuidance).toContain('primary source of project context');
    expect(takingShapeGuidance).toContain('consulted early, not only to fill gaps');
    expect(takingShapeGuidance).toContain('Recorded requirements stay authoritative');
    expect(takingShapeGuidance).toContain('settled direction from exploration');
    expect(takingShapeGuidance).toContain('never present an abandoned idea as current');
    expect(takingShapeGuidance).toContain('suggest a concrete next step');
    expect(takingShapeGuidance).toContain(
      'natural breaks in the conversation (not after every message)',
    );
    expect(takingShapeGuidance).toContain('not on how often it was said');
    expect(takingShapeGuidance).toContain('work items, design docs or Decisions through proposals');
    expect(takingShapeGuidance).not.toMatch(/hint/i);
    expect(takingShapeGuidance).not.toMatch(/ask(ing)? the user/i);
  });

  it('adds the approved Intent first guidance only when the choice is on', () => {
    const on = buildPlatformSystemPrompt(sampleDefs, undefined, {
      intentFirst: true,
      maturity: ProjectMaturity.Established,
      hints: 'none',
    });
    const off = buildPlatformSystemPrompt(sampleDefs, undefined, {
      intentFirst: false,
      maturity: ProjectMaturity.Established,
      hints: 'none',
    });
    const omitted = buildPlatformSystemPrompt(sampleDefs);

    expect(on).toContain(intentFirstGuidance);
    expect(on.endsWith(intentFirstGuidance)).toBe(true);
    for (const pair of [
      'Bad: "Apply the shared knowledge-use obligation through four reusable responsibilities: research discovers and carries evidence; reconciliation resolves inconsistencies through review."\nGood: "When an agent plans, builds or checks work, it follows the reviewed Mockups and requirements that govern it, or stops and says where they conflict."',
      'Bad: "Should the relaunch path call the existing launcher or reuse the open connection?"\nGood: "When a closed browser is needed again, should it reopen on its own?"',
      'Bad: "Moved the settings store to atomic temp-file-and-rename writes with a strict schema."\nGood: "Turning Shared Browser off now stays off after you restart the CLI."',
    ]) {
      expect(on).toContain(pair);
    }
    expect(off).not.toContain('## Intent first');
    expect(omitted).not.toContain('## Intent first');
    expect(off).toBe(omitted);
    expect(on).toBe(`${omitted}\n\n${intentFirstGuidance}`);
  });

  it('renders shared knowledge once with project-defined types and excludes it from per-agent prompts', () => {
    const customType = {
      ...sampleDefs[0]!,
      key: 'project_evidence',
      name: 'Project Evidence',
      description: 'Project-specific evidence.',
      role: 'project-info',
    } satisfies WorkItemTypeDefinitionDto;
    const prompt = buildPlatformSystemPrompt([...sampleDefs, customType]);
    const paragraph =
      '**Other work items carry the project too.** Features are the backbone, but every work-item type fills a role in the project topology — a Mockup shows how an interface should look and behave, a Diagram shows how the parts of a system relate, and every other type fills the role its description defines. Its contextual type guidance and maintenance guidance explain how it fits. Applicable items matter at every stage — research, planning, implementation, and verification: read their content, honor what they establish, and surface conflicts instead of routing around them.';
    const definition =
      'The project\'s configurable item types, Features included; "work item" in this prompt means any of them.';
    const blocks = [paragraph, '**Work-item types.**', definition];
    for (const block of blocks) expect(prompt.split(block)).toHaveLength(2);
    const [fixed, configurable] = prompt.split('**Work-item types.**');
    expect(fixed).toContain('**Project** (`PROJECT`)');
    expect(fixed).not.toContain('**Feature** (`FEATURE`)');
    expect(configurable).toContain('**Feature** (`FEATURE`)');
    expect(configurable).toContain('**Project Evidence** (`project_evidence`)');
    expect(configurable).not.toContain('**Project** (`PROJECT`)');
    expect(prompt).toContain('purpose: "maintenance"');
    expect(prompt.indexOf('**Links as connective tissue.**')).toBeLessThan(
      prompt.indexOf(paragraph),
    );
    expect(prompt.indexOf(paragraph)).toBeLessThan(
      prompt.indexOf('**Search as the default discovery move.**'),
    );
    for (const agentPrompt of [
      buildCodingConversationPrompt(
        { userMessage: 'review knowledge' },
        { kind: 'follow_up', awaitingUserReview: false, taskId: null },
      ),
      buildFeatureTreeConversationPrompt({ skeleton: [] }),
    ]) {
      for (const block of blocks) {
        expect(agentPrompt).not.toContain(block);
        expect(`${prompt}\n${agentPrompt}`.split(block)).toHaveLength(2);
      }
    }
  });
  it('composes exactly one selected calibration block for conversational sessions', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs, {
      provider: 'codex',
      model: 'gpt-5.6-luna',
      epistemicCalibration: true,
    });

    expect(prompt.match(/### Working with an informed user/gu)).toHaveLength(1);
    expect(prompt).toContain('correct prior overconfidence plainly');
  });

  it('keeps graph-research guidance out of the platform system prompt', () => {
    const projectAssistant = buildPlatformSystemPrompt(sampleDefs, {
      provider: 'codex',
      model: 'gpt-5.6-luna',
    });
    const entityConversation = buildPlatformSystemPrompt(sampleDefs, {
      provider: 'codex',
      model: 'gpt-5.6-luna',
      epistemicCalibration: true,
    });
    expect(projectAssistant).not.toContain('## Widening graph research');
    expect(entityConversation).not.toContain('## Widening graph research');
  });

  it('keeps conversation and message identities distinct in the platform ontology', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);

    expect(prompt).toContain(
      '**Conversation** (`CONVERSATION`) — A durable dialogue thread or container scoped to an entity or session. A conversation contains messages and has its own identity.',
    );
    expect(prompt).toContain(
      '**Message** (`MESSAGE`) — One persisted system, user, or agent record within a conversation.',
    );
    expect(prompt).toContain(
      'A message identifier is a MESSAGE identity and cannot be used as a CONVERSATION identifier.',
    );
    expect(prompt).not.toContain('**Message / Conversation**');
  });

  it('routes bounded contextual type guidance exactly once from the compact catalog', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);

    expect(prompt.match(/\*\*Contextual type guidance is read on demand\.\*\*/gu)).toHaveLength(1);
    expect(prompt).toContain('when a type is unfamiliar or project-defined');
    expect(prompt).toContain("when a related item's type may affect the current work");
    expect(prompt).toContain(
      'when a consequential interaction between the requested type and the focal type could change your interpretation',
    );
    expect(prompt).toContain('Use `typeKeys: [key]` for one type');
    expect(prompt).toContain(
      'include `focalTypeKey` only for semantic reads where contextual interpretation matters',
    );
    expect(prompt).toContain('Never speculate across or fan out over the catalog.');
    expect(prompt).toContain('administrative `get_work_item_type` read');
    expect(prompt).toContain('`get_tool_guidance` read for authoring standards');
    expect(prompt).not.toContain('Use for implementation work.');
    expect(prompt).not.toContain('Cite the owning feature.');
  });

  it('directs agents to reference the entity an approved CREATE proposal materialized', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);

    expect(prompt.match(/## Stale Entity References/gu)).toHaveLength(1);
    expect(prompt).toContain('check it with `get_proposal`');
    expect(prompt).toContain("An approved CREATE's `targetEntityId` is the entity it created");
    expect(prompt).toContain('Reference the proposal only while it is pending');
    expect(prompt).toContain('when it is itself the subject');
  });

  it('leaves Diagram reads and authoring to the API-owned Diagram guidance', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);
    expect(prompt).not.toContain('## Native diagrams');
    expect(prompt).not.toContain('For Diagram aggregate reads');
  });

  it('frames top-level features as user-facing product concepts with the product tag default', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'Top-level features are product concepts',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`Account Management`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`Team Collaboration`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`Notifications`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`Reporting`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`Billing`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      '`product` is the default for a top-level feature',
    );
  });

  it('flags architectural slices at the top level as a structural smell with a generic example', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('not architectural slices');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`Web UI`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`Core Backend`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'sub-features beneath the product concept',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('a `Reporting` product concept');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'a `Reporting Page` frontend sub-feature',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'a `Reporting Service` backend sub-feature',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('propose a re-parent');
  });

  it('applies the what-not-how test to feature names with paired mechanism and capability examples', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);
    expect(prompt).toContain('Feature names describe delivered capabilities');
    expect(prompt).toContain('primarily answers “how is this built?”');
    expect(prompt).toContain('`Send Updates over WebSockets`');
    expect(prompt).toContain('`Live Updates`');
    expect(prompt).toContain('`Build SearchIndexService`');
    expect(prompt).toContain('`Feature Search`');
    expect(prompt).toContain('`Normalize Events before Indexing`');
    expect(prompt).toContain('`Searchable Activity`');
    expect(prompt).toContain('`Event Delivery`');
    expect(prompt).toContain('not a closed vocabulary');
    expect(prompt).toContain('tags and placement support the judgment');
  });

  it('introduces the feature-tag set as routing/disambiguation with product as the default', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'Feature tags as routing/disambiguation',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`product`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`frontend`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`backend`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`infra`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`design`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'Treat `product` as the default expectation for a top-level feature',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'Tags do not replace structural placement',
    );
  });

  it('keeps Feature hierarchy, Explorer visibility, and structural parentage independent', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);

    expect(prompt).toContain(
      'Product Feature hierarchy, Explorer visibility, and structural parentage are independent',
    );
    expect(prompt).toContain(
      'Only the platform-owned `FEATURE` type participates in the product Feature hierarchy and feature-sync projections',
    );
    expect(prompt).toContain('Explorer root visibility is a separate presentation choice');
    expect(prompt).toContain('A custom type may be root-visible and self-nesting');
    expect(prompt).toContain('do not infer any one of these concepts from another');
  });

  it('recites the AI tag with its gloss in the tag set', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('`AI`');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('AI/agent-shaped delivery');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('rather than ordinary backend code');
  });

  it('reads feature lifecycle state from edges and tasks, not a stored status field', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('Feature state is read, not stored');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('has no status field');
    expect(buildPlatformSystemPrompt(sampleDefs)).toMatch(/attached plan[\s\S]*?planned/);
    expect(buildPlatformSystemPrompt(sampleDefs)).toMatch(
      /active or in-progress descendant tasks[\s\S]*?in development/,
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toMatch(/SUPERSEDES[\s\S]*?deprecated/);
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'the normal state of a roadmap, not an anomaly to flag',
    );
  });

  it('frames a plan as a single artifact for a feature, not an assembled collection of tasks', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('authored as a single artifact');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'not assembled from pre-existing tasks',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('sequence of work for a feature');
    expect(buildPlatformSystemPrompt(sampleDefs)).not.toContain(
      'ordered collection of tasks and design docs',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).not.toContain('`create_plan`');
  });

  it('preserves the existing situational-awareness, links, search, and propose-edit-ask paragraphs', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'Situational awareness (passive reflex, not a fan-out)',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('notice what I already see');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('src/agents/feature-sync/prompts.ts');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('Links as connective tissue');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('Search as the default discovery move');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('unified_search');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('Propose vs. edit vs. ask');
  });

  it('asserts that topology maintenance carries the same weight as writing code', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);
    expect(prompt).toContain('## Topology is implementation work');
    expect(prompt).toContain('same weight as writing code');
    expect(prompt).toContain('missing requirement');
    expect(prompt).toContain('ambient contract');
    expect(prompt).toContain('design doc or other work item the code now contradicts');
    expect(prompt).toContain('not a courtesy after it');
    expect(prompt).toContain('material divergence is recorded through the same mechanisms');
    expect(prompt).toContain('see Link Discovery');
    expect(prompt).toContain('Do not trade graph work for implementation expediency');
    expect(prompt).toContain('surface the conflict and let the user adjudicate');
    expect(prompt).toContain('unreconciled is incomplete');
  });

  it('names the requirements-cite-fulfillment rule as a fact about feature-body shape', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('Requirements cite their fulfillment');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'cites the entity that fulfills it by mention',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'at higher altitudes usually a sub-feature',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'the implementation side cannot follow it back',
    );
  });

  it('drops the standalone Mention discipline pointer from the primer guidance — mentionFormat is the canonical home', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).not.toContain('**Mention discipline.**');
  });

  it('renames the implementation-hints heading away from the user-level "Memory" name', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('## Implementation hints');
    expect(buildPlatformSystemPrompt(sampleDefs)).not.toContain('## Memory (Implementation hints)');
  });

  it('bundles the ambient platform-context block', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('## Platform Context');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'Situating Yourself with `get_context`',
    );
  });

  it('bundles the mention-format block', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('## Entity References (HARD STOP)');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('@[type:id|title]');
  });

  it('bundles the cross-feature reference instruction', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('## Reference Features That Apply');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('@[feature:id|name]');
  });

  it('injects the registry-backed Contract description into the system prompt', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);
    expect(prompt).toContain(
      'A user-authored, first-class marker that a narrowly stated durable agreement exists at a concrete boundary.',
    );
    expect(prompt).toContain(
      'A durable authoritative producer interface may qualify before a consumer exists.',
    );
  });

  it('bundles the link-discovery-and-pruning instruction', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('## Link Discovery and Pruning');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('create_edge');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('delete_edge');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('SUPERSEDES');
  });

  it('keeps detailed topology mutation rules behind the authoring-guidance read', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);
    expect(prompt).toContain('## Topology authoring');
    expect(prompt).toContain('call get_authoring_guidance() once before the mutation');
    expect(prompt).toContain('authoringRootProof');
    expect(prompt).toContain('returned scoped guidanceToken');
    expect(prompt).toContain('## Contract Discovery and Enforcement');
    expect(prompt).toContain('Recognize a Contract candidate from a concrete boundary');
    expect(prompt).toContain("relevant element's inputs, outputs, and responsibility");
    expect(prompt).toContain('outside a Diagram');
    expect(prompt).toContain('A durable authoritative producer interface may qualify');
    expect(prompt).toContain(
      'Only after confirming provider intent, ask whether the provider could make the proposed change while still honoring the declared promise',
    );
    expect(prompt).toContain('root authoring guide and the Contract-specific guide');
    expect(prompt).not.toContain('Attach every step that the evidence shows');
    expect(prompt).not.toContain('## Grouped Proposal Authoring');
    expect(prompt).not.toContain('## Workflow Links');
    expect(prompt).not.toContain('## Workflow-First Feature Modeling');
  });

  it('directs successor proposals to declare SUPERSEDES for approval-time materialization', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);
    expect(prompt).toContain("In the successor's create or edit proposal");
    expect(prompt).toContain('successor-authored `SUPERSEDES` relationship');
    expect(prompt).toContain('structured proposal `edges`, targeting the predecessor');
    expect(prompt).toContain('approval performs the atomic transition');
    expect(prompt).toContain("predecessor's status to `SUPERSEDED`");
    expect(prompt).toContain('persists the successor-to-predecessor lineage together');
    expect(prompt).toContain('including `COMPLETED`');
  });

  it('prohibits direct supersede writes and preserves the EVOLVES distinction', () => {
    const prompt = buildPlatformSystemPrompt(sampleDefs);
    expect(prompt).toContain('Do not hand-create a raw `SUPERSEDES` edge');
    expect(prompt).toContain('`create_edge` or `update_edge`');
    expect(prompt).toContain('do not set `SUPERSEDED` through a direct status edit');
    expect(prompt).toContain('approval-time atomic transition is the single write path');
    expect(prompt).toContain('refined, extended, or iterated');
    expect(prompt).toContain('remains canonical and requires `EVOLVES` instead');
  });

  it('bundles the implementation-hints section instructing agents to query implementation hints', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('## Implementation hints');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('search_implementation_hints');
  });

  it('tells the agent to filter implementation-hint search by the session serviceId', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('serviceId');
    expect(buildPlatformSystemPrompt(sampleDefs)).toMatch(
      /filter[^.]*serviceId|serviceId[^.]*filter/i,
    );
  });

  it('frames implementation hints as weakly-held context, not documentation', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('not documentation');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('weakly-held');
  });

  it('bundles the consult-the-graph-before-asking snippet', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('## Consult the graph before asking');
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(
      'The entity graph is your answer source',
    );
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain('treat it as decided');
  });

  it('renders the GOAL custom-type entry with its top-level constraint', () => {
    const result = buildPlatformSystemPrompt(sampleDefs);
    expect(result).toContain('`GOAL`');
    expect(result).toContain('Top-level only');
  });

  it('renders the CONTRACT custom-type entry', () => {
    const result = buildPlatformSystemPrompt(sampleDefs);
    expect(result).toContain('`CONTRACT`');
    expect(result).toContain(
      'A user-authored, first-class marker that a narrowly stated durable agreement exists at a concrete boundary.',
    );
  });

  it('appends the FeatureTag-derived tag line with AI/agent-shaped delivery', () => {
    const result = buildPlatformSystemPrompt(sampleDefs);
    expect(result).toContain('Each feature carries a tag from the set');
    expect(result).toContain('AI/agent-shaped delivery');
  });

  it('does not embed the generic task description bullet', () => {
    const result = buildPlatformSystemPrompt(sampleDefs);
    expect(result).not.toContain('a unit of implementation work under a feature');
    expect(result).not.toContain('Tasks describe *how*');
  });
});

describe('planVsTasksFork', () => {
  it('carries the Plan vs. tasks heading and the PLAN-work-item / standalone-tasks fork', () => {
    expect(planVsTasksFork).toContain('## Plan vs. tasks');
    expect(planVsTasksFork).toContain('plan via `create_plan`');
    expect(planVsTasksFork).toContain('standalone tasks');
    expect(planVsTasksFork).toContain('let the user pick before you create anything');
  });

  it('uses a cohesive delivery and durable design doc as the plan-versus-tasks test', () => {
    expect(planVsTasksFork).toContain(
      'use this test: would those tasks form a cohesive delivery that benefits from a durable design doc?',
    );
    expect(planVsTasksFork).toContain(
      'If so, do not immediately create the tasks — surface the choice first',
    );
  });

  it('is not bundled into the platform system prompt', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).not.toContain('## Plan vs. tasks');
  });

  it('remains present in the existing coding and feature-tree prompt builders', () => {
    expect(
      buildCodingConversationPrompt(
        { userMessage: 'add a few related tasks' },
        { kind: 'follow_up', awaitingUserReview: false, taskId: null },
      ),
    ).toContain(planVsTasksFork);
    expect(buildFeatureTreeConversationPrompt({ skeleton: [] })).toContain(planVsTasksFork);
  });
});

describe('consultGraphBeforeAsking', () => {
  it('carries the heading and the graph-is-the-answer-source invariant', () => {
    expect(consultGraphBeforeAsking).toContain('## Consult the graph before asking');
    expect(consultGraphBeforeAsking).toContain('The entity graph is your answer source');
    expect(consultGraphBeforeAsking).toContain('parent feature');
    expect(consultGraphBeforeAsking).toContain('get_context');
  });

  it('tells the agent to act on a recorded answer instead of asking', () => {
    expect(consultGraphBeforeAsking).toContain('treat it as decided');
    expect(consultGraphBeforeAsking).toMatch(/instead of asking/i);
  });

  it('uses session evidence while preserving authored requirements as authoritative', () => {
    expect(consultGraphBeforeAsking).toContain(
      'Relevant sessions are also graph evidence: use them to clarify gaps in recorded intent or progress, while treating authored requirements as authoritative.',
    );
  });

  it('is delivered universally via the platform system prompt', () => {
    expect(buildPlatformSystemPrompt(sampleDefs)).toContain(consultGraphBeforeAsking);
  });
});

describe('buildCodingPlanPrompt', () => {
  it('matches the full evidence-gated primary-implementation contract', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);

    expect(result).toMatchSnapshot();
    expect(result).toContain('primaryImplementations must contain at least one item');
    expect(result).toContain('complete proposed code, database definition, or prose block');
    expect(result).toContain('graphEdge.FULFILLED_BY');
    expect(result).toContain('resolved non-archived Contract');
    expect(result).toContain('Omit the connections property entirely');
    expect(result).toContain('Do not emit difficulty');
    expect(result).toContain('requiredServiceIds');
    expect(result).toContain('approval-time scope declaration only');
    expect(result).toContain('it is not a ceiling on what the plan may require');
    expect(result).toContain(
      'Do not omit, defer, or split out required work merely because its Service is not currently selected',
    );
    expect(result).toContain('call `list_services` to resolve its full project Service ID');
  });

  it('uses entity-independent conditional orientation for the active task', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload, [], { focalEntityId: 'task-1' });
    expect(result).toContain('get_context');
    expect(result).not.toContain('entityId: "task-1"');
    expect(result).toContain('Do not reload that same focal entity by default');
    expect(result).toContain('proposal or topology details are absent or insufficient');
    expect(result).toContain('active task');
  });

  it('leaves focal task metadata to the canonical provider projection', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).not.toContain('"id": "task-1"');
    expect(result).not.toContain('"title": "Test task"');
    expect(result).toContain('canonical focal entity projection');
  });

  it('does not copy task description or acceptance criteria into the workflow prompt', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).not.toContain('Implement feature X');
    expect(result).not.toContain('Feature X works');
  });

  it('instructs the agent to enumerate proposal influences and edges', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).toContain('Proposal influences and edges');
    expect(result).toContain('most recent APPROVED proposal');
    expect(result).toContain('DRAFT');
    expect(result).toContain('influences[]');
    expect(result).toContain('DEPENDS_ON');
    expect(result).toContain('DERIVES_FROM');
    expect(result).toContain('SUPERSEDES');
    expect(result).toContain('CONTRADICTS');
    expect(result).toContain('RELATED_TO');
    expect(result).toContain('HAS_AGENT_SESSION');
  });

  describe('future-revision approval rule', () => {
    const result = buildCodingPlanPrompt({ startupInput: makeStartupInput() });

    it('asks before planning a pending future, including multi-approval requirements', () => {
      expect(result).toContain('futureProposalDependencies');
      expect(result).toContain('If its `status` is `unavailable`');
      expect(result).toContain('approval state could not be read');
      expect(result).toContain('If its `status` is `loaded`, inspect every `proposals` row');
      expect(result).toContain('For an `unresolved` row, ask for clarification');
      expect(result).toContain('leave its dependent change out of the plan');
      expect(result).toContain('For a `future` row not `APPROVED`, ask whether to proceed');
      expect(result).toContain('include `approvalsRecorded` against numeric `requiredApprovals`');
      expect(result).toContain('leave only the affected change out of the execution plan');
      expect(result).toContain(
        'never by task status, proposal edges, or a dismissed feature-sync finding',
      );
      expect(result).toContain('@[proposal:<proposalId>|<proposalTitle or proposalId>]');
      expect(result).not.toContain('startup projection lacks them');
      expect(result).not.toContain('missing or empty field proves nothing');
      expect(result).not.toContain('not set yet');
    });

    it('targets the approved future even when unapplied', () => {
      expect(result).toContain('call `get_future_revision` with its `futureId`');
      expect(result).toContain('whether or not it is applied');
    });

    it('carries an explicit user override through the clarification answer without counting it as approval', () => {
      expect(result).toContain("If the user's answer explicitly says to proceed");
      expect(result).toContain('builds on an unapproved direction');
      expect(result).toContain('the override is not an approval');
    });
  });

  it('describes the two-tier read strategy', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).toContain('Two-tier read strategy');
    expect(result).toContain('get_full_entity');
    expect(result).toContain("the target's title to decide which targets govern the plan");
    expect(result).toContain('call this for every target that governs the plan');
    expect(result).toContain(
      'A reviewed design doc or work item that conflicts with code reality is a discrepancy',
    );
  });

  it('requires a clarification question when influence targets imply uncovered behavior', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).toContain('clarificationQuestion');
    expect(result).toContain('different flow');
    expect(result).toContain('out of scope');
  });

  it('keeps proposal and research provenance out of structured implementation output', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload, [], {
      researchMemo:
        'Research traced the task to an approved proposal and found no applicable edge.',
    });

    expect(result).toContain('reason internally');
    expect(result).toContain('Do not emit that inventory or reasoning as companion prose');
    expect(result).toContain('Project only the resulting concrete implementation consequence');
    expect(result).toContain('Proposal influences, proposal lineage, proposal edges');
    expect(result).toContain('Project Assistant research, and graph state are planning inputs');
    expect(result).toContain('finding that no applicable connection exists');
    expect(result).toContain('Execution-plan entries contain only concrete implementation');
  });

  it('includes the 7caa9b4f worked example', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).toContain('7caa9b4f');
    expect(result).toContain('InviteToOrganizationDto');
  });

  it('keeps workflow actions out of the PLAN payload', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload, [
      { messageId: 'u1', text: 'please add a step', createdAt: '2026-04-21T10:00:00Z' },
    ]);
    expect(result).not.toContain('nextAction');
    expect(result).not.toContain('startup_plan_v1');
    expect(result).toContain('reportType');
    expect(result).toContain('APPROVED');
    expect(result).toContain('REVISED');
  });

  it('names the concrete approval phrases the agent must classify as APPROVED when user replies are present', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload, [
      { messageId: 'u1', text: 'looks good', createdAt: '2026-04-21T10:00:00Z' },
    ]);
    expect(result).toMatch(/looks good/i);
    expect(result).toMatch(/lgtm/i);
    expect(result).toMatch(/go ahead|go for it/i);
    expect(result).toMatch(/approved/i);
  });

  it('defaults ambiguous replies to REVISED when user replies are present', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload, [
      { messageId: 'u1', text: 'ok', createdAt: '2026-04-21T10:00:00Z' },
    ]);
    expect(result).toMatch(/ambiguous/i);
    expect(result).toMatch(/REVISED/);
  });

  it('forbids a silent unchanged re-emit on REVISED, requiring a material edit or a written no-op explanation', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload, [
      { messageId: 'u1', text: 'ok', createdAt: '2026-04-21T10:00:00Z' },
    ]);
    // The old escape hatch ("re-emit the plan unchanged") is gone.
    expect(result).not.toContain('re-emit the plan unchanged');
    expect(result).toMatch(/may not silently re-emit/i);
    // The no-op must be explained on the discrepancies channel.
    expect(result).toContain('discrepancies');
    expect(result).toMatch(/material edit to the plan[\s\S]*?or a written explanation/i);
  });

  it('rejects a zero-step executionPlan via the rules', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).toMatch(/executionPlan must contain at least one step/i);
    expect(result).toMatch(/empty executionPlan is invalid/i);
  });

  it('tells the agent to persist the initial report without a completion action', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload, []);
    expect(result).toMatch(/no new user reply/i);
    expect(result).toMatch(/persist[\s\S]{0,100}PLAN report/i);
    expect(result).toMatch(/do not call[\s\S]{0,80}submit_approved/i);
  });

  it('defines low severity as an expected design-consistent dependency worth recording', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).toContain('low');
    expect(result).toContain('expected, design-consistent dependency worth recording');
    expect(result).toContain(
      'routine implementation work performed by this session is not a discrepancy',
    );
  });

  it('defines medium severity as a material non-contradictory scope or ownership concern', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).toContain('medium');
    expect(result).toContain('material, non-contradictory scope or ownership concern');
    expect(result).toContain('requires a decision or an additional owner');
    expect(result).toContain('scope call');
  });

  it('defines high severity as an authoritative conflict that invalidates the plan premise', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).toContain('high');
    expect(result).toContain('authoritative design or Contract is specifically incompatible');
    expect(result).toContain('plan invalid until that premise is revisited');
  });

  it('keeps implementation, OpenAPI synchronization, generation, and tests in executionPlan', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).toMatch(/regenerating/i);
    expect(result).toContain('codegen');
    expect(result).toContain('normal codebase operation');
    expect(result).toContain('updating an OpenAPI description and regenerating generated DTOs');
    expect(result).toContain('Classify the observed relationship, not the effort');
    expect(result).toContain('Capture that work in executionPlan, not discrepancies');
  });

  it('no longer carries the standalone cross-repo "keep severity low" override', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).not.toContain('keep severity low unless it directly blocks');
  });

  it('names the approval tool and no planner-emitted refine tool', () => {
    const payload: LocalStartupSessionPromptPayload = {
      startupInput: makeStartupInput(),
    };
    const result = buildCodingPlanPrompt(payload);
    expect(result).toContain('submit_approved');
    expect(result).not.toContain('submit_revised');
  });

  describe('planned-task missed-step branch', () => {
    it('appends the planned-task block when launchPlanId, launchStepId, and launchStageId are all present', () => {
      const payload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      };
      const result = buildCodingPlanPrompt(payload);
      expect(result).toContain('Planned-task missed-step pass');
      // The catch-up read uses canonical TASK hierarchy reads: the active task
      // is oriented first, then its PLAN parent is read in full.
      expect(result).toMatch(/get_context[\s\S]{0,100}entity id `step-xyz`/);
      expect(result).toContain('PLAN TASK id `plan-abc`');
      expect(result).toContain('TASK of type PLAN_STAGE');
      expect(result).not.toContain('get_plan_stage');
      // launchPlanId still appears (used for get_full_entity on the
      // surrounding plan); launchStepId appears as the active-step marker.
      expect(result).toContain('plan-abc');
      expect(result).toContain('step-xyz');
      expect(result).toContain('missedSteps');
      expect(result).toContain('insert_step');
      expect(result).toContain('amend_stage');
      expect(result).toContain('missingPrecondition');
      expect(result).toContain('referencedArtifact');
      expect(result).toContain('byte-identical');
    });

    it('is surface-only: the missed-step pass no longer authors create_step or update_stage proposals', () => {
      const payload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      };
      const result = buildCodingPlanPrompt(payload);
      // The planner surfaces gaps; it does not propose. Authoring tools and
      // the proposal ID coupling within this pass stay in the analyze step.
      expect(result).not.toContain('create_step');
      expect(result).not.toContain('update_stage');
      expect(result).toContain('surface-only');
      const missedStepPassStart = result.indexOf('## Planned-task missed-step pass');
      expect(missedStepPassStart).toBeGreaterThanOrEqual(0);
      expect(result.slice(missedStepPassStart)).not.toContain('proposalId');
    });

    it('produces output byte-identical to the free path when launchPlanId is absent', () => {
      const basePayload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
      };
      const partialPayload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      };
      const result = buildCodingPlanPrompt(partialPayload);
      const baseline = buildCodingPlanPrompt(basePayload);
      expect(result).toBe(baseline);
      expect(result).not.toContain('Planned-task missed-step pass');
    });

    it('produces output byte-identical to the free path when launchStepId is absent', () => {
      const basePayload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
      };
      const partialPayload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
        launchPlanId: 'plan-abc',
        launchStageId: 'stage-uvw',
      };
      const result = buildCodingPlanPrompt(partialPayload);
      const baseline = buildCodingPlanPrompt(basePayload);
      expect(result).toBe(baseline);
      expect(result).not.toContain('Planned-task missed-step pass');
    });

    it('produces output byte-identical to the free path when launchStageId is absent', () => {
      const basePayload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
      };
      const partialPayload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
      };
      const result = buildCodingPlanPrompt(partialPayload);
      const baseline = buildCodingPlanPrompt(basePayload);
      expect(result).toBe(baseline);
      expect(result).not.toContain('Planned-task missed-step pass');
    });

    it('rejects an empty-string launchPlanId via the typed gate', () => {
      const payload = {
        startupInput: makeStartupInput(),
        launchPlanId: '',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      } as unknown as LocalStartupSessionPromptPayload;
      expect(() => buildCodingPlanPrompt(payload)).toThrow(/launchPlanId/);
    });

    it('rejects an empty-string launchStageId via the typed gate', () => {
      const payload = {
        startupInput: makeStartupInput(),
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: '',
      } as unknown as LocalStartupSessionPromptPayload;
      expect(() => buildCodingPlanPrompt(payload)).toThrow(/launchStageId/);
    });

    it('renders the explicitly supplied plan design doc as reference-only material outside Inputs', () => {
      const payload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      };
      const result = buildCodingPlanPrompt(payload, [], {
        planDesignDocReference: {
          id: 'design-doc-1',
          title: 'Plan Context Design',
          sections: {
            intent: 'Use plan language consistently.',
            scope: 'Do not broaden the selected task.',
          },
        },
      });
      const inputsBlock = result.slice(
        result.indexOf('Inputs:'),
        result.indexOf('## Plan JSON shape'),
      );

      expect(result).toContain('## Plan design document (reference only)');
      expect(result).toContain('Title: Plan Context Design');
      expect(result).toContain('Use it only to guide implementation choices');
      expect(result).toContain('selected task or plan step remains the strict scope');
      expect(result).toContain('### intent');
      expect(result).toContain('Use plan language consistently.');
      expect(inputsBlock).not.toContain('"designDoc"');
    });

    it('renders an explicitly enriched plan design doc when startupInput has no designDoc', () => {
      const payload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
        launchPlanId: 'plan-abc',
        launchStepId: 'step-xyz',
        launchStageId: 'stage-uvw',
      };
      const result = buildCodingPlanPrompt(payload, [], {
        planDesignDocReference: {
          id: 'design-doc-1',
          title: 'Fetched Design',
          sections: {
            summary: 'Fetched plan design context.',
          },
        },
      });

      expect(result).toContain('## Plan design document (reference only)');
      expect(result).toContain('Title: Fetched Design');
      expect(result).toContain('Fetched plan design context.');
    });

    it('ignores a design document carried inside deprecated startupInput', () => {
      const withDesignDoc: LocalStartupSessionPromptPayload = {
        startupInput: {
          ...makeStartupInput(),
          designDoc: {
            id: 'design-doc-1',
            title: 'Task Design',
            sections: {
              context: 'Task-scoped design context.',
            },
          },
        },
      };
      const result = buildCodingPlanPrompt(withDesignDoc);

      expect(result).not.toContain('Plan design document (reference only)');
      expect(result).not.toContain('## Supplemental design doc');
      expect(result).not.toContain('Task-scoped design context.');
    });
  });

  describe('project_assistant research memo branch', () => {
    const RESEARCH_MEMO =
      '## Research frame\n```json\n{"focus":"task-1"}\n```\n\nThe research surfaced feature F and contradiction C.';

    it('renders the memo and defers graph orientation when a research memo is present', () => {
      const payload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
      };
      const result = buildCodingPlanPrompt(payload, [], { researchMemo: RESEARCH_MEMO });
      // The memo content is rendered into the prompt — subagent flows don't get
      // the resolver's `## Context from prior phases` prepend, so the prompt
      // must carry it itself.
      expect(result).toContain('Context from prior phases');
      expect(result).toContain('feature F and contradiction C');
      // The from-scratch graph sweep sentence is replaced by the defer
      // instruction; the original sweep wording is gone.
      expect(result).toMatch(
        /Use the Project Assistant findings above to know which work items and design docs govern this plan/,
      );
      expect(result).not.toContain(
        'Discover the work items and design docs that govern this task from the codebase',
      );
      // The proposal-influences pass stays live, while a same-focal read is
      // conditional on missing proposal or topology detail.
      expect(result).toContain('canonical startup projection first');
      expect(result).toContain('proposal or topology details are absent or insufficient');
      expect(result).not.toContain(
        'call get_context to retrieve the latest information about the active task',
      );
      expect(result).toContain('Proposal influences and edges');
    });

    it('produces output byte-identical to today when no research memo is present', () => {
      const payload: LocalStartupSessionPromptPayload = {
        startupInput: makeStartupInput(),
      };
      const baseline = buildCodingPlanPrompt(payload);
      const withEmptyOptions = buildCodingPlanPrompt(payload, [], {});
      const withUndefinedMemo = buildCodingPlanPrompt(payload, [], { researchMemo: undefined });
      const withBlankMemo = buildCodingPlanPrompt(payload, [], { researchMemo: '   ' });
      expect(withEmptyOptions).toBe(baseline);
      expect(withUndefinedMemo).toBe(baseline);
      expect(withBlankMemo).toBe(baseline);
      // The original graph-sweep sentence is intact and the memo block is absent.
      expect(baseline).toContain(
        'Discover the work items and design docs that govern this task from the codebase',
      );
      expect(baseline).not.toContain('Context from prior phases');
    });
  });
});

describe('buildFinalAssessmentPrompt', () => {
  it('matches the full Contract-aware assessment prompt', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary:
        'Implemented a cross-feature handoff whose payload and acknowledgement timing are now shared.',
      taskNeighborhood: emptyNeighborhood(),
    };

    const prompt = buildFinalAssessmentPrompt(payload);
    expect(prompt).toMatch(/Contract reconciliation at completion/i);
    expect(prompt).toMatch(
      /create_work_item[\s\S]{0,120}type: "CONTRACT"[\s\S]{0,160}same agent turn/i,
    );
    expect(prompt).toMatchSnapshot();
  });

  it('applies lifecycle safety to one-shot neighborhood updates', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Implemented the auth middleware.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('## Work-item section edit safety');
    expect(result).toContain('Before each neighborhood section edit');
    expect(result).toContain('skip the section edit and report that direction is required');
  });

  it('builds a prompt with context and execution summary', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Implemented the auth middleware.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('final_assessment_v2');
    expect(result).toContain('Implemented the auth middleware.');
    expect(result).toContain('org-1');
  });

  it('includes task neighborhood when provided', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: {
        parentTasks: [{ id: 'parent-1', title: 'Parent', description: 'Parent task' }],
        childTasks: [],
      } as unknown as LocalFinalAssessmentPromptPayload['taskNeighborhood'],
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('parent-1');
  });

  it('uses empty arrays for task neighborhood when provided empty', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('parentTasks');
    expect(result).toContain('childTasks');
  });

  it('includes discrepancy context when provided', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
      startupDiscrepancyContext: [
        {
          sourceRef: { sourceType: 'task', sourceId: 'task-1' },
          discrepancyText: 'API mismatch',
          reasoning: 'Resolved during session',
          severity: 'low',
        },
      ] as NonNullable<LocalFinalAssessmentPromptPayload['startupDiscrepancyContext']>,
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('API mismatch');
  });

  it('includes implementation hint maintenance guidance', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('Implementation hints');
    expect(result).toContain('lightweight search pointers');
  });

  it('evaluates description and requirements as independent feature sections', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('A feature has two distinct sections');
    expect(result).toContain('**description** (narrative prose');
    expect(result).toContain(
      '**requirements** (a list of hard, inviolable, declarative statements',
    );
    expect(result).toContain('evaluate **each section independently**');
    expect(result).toContain('For `description` (narrative prose)');
    expect(result).toContain('For `requirements` (declarative invariants)');
  });

  it('defines per-section drift and enrichment for requirements', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('requirements bullet that the implementation violates');
    expect(result).toContain('factually incorrect');
    expect(result).toContain('new hard, user-observable invariant');
    expect(result).toContain('Do not propose narrative prose here — that belongs in `description`');
  });

  it('requires section-scoped edit_work_item calls (one per section, never merged)', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('Section-scoped proposals (mandatory)');
    expect(result).toContain('separate `edit_work_item` call per section');
    expect(result).toContain('sections: [{ key: "description", content: "..." }]');
    expect(result).toContain('sections: [{ key: "requirements", content: "..." }]');
    expect(result).toContain('Never bundle both sections into a single `edit_work_item` payload');
  });

  it('requires one hierarchyWalk entry per feature section and carries a section field', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('Emit one entry per section evaluated');
    expect(result).toContain('`section` (feature entries only)');
    expect(result).toContain('`"description"` or `"requirements"`');
    expect(result).toContain('Omit on the distance-0 task entry');
    expect(result).toContain('"section": "description|requirements');
  });

  it('preserves bottom-up framing grounded in what the session implemented', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('the walk works from implementation upward');
    expect(result).toContain('Work bottom-up. Start from what was implemented');
    expect(result).toContain('Work bottom-up from what was implemented');
  });

  it('includes topology context', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('Entity topology');
    expect(result).toContain('unified_search');
  });

  it('extends dependentTaskWalk to proposal-influence targets', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('Proposal influences');
    expect(result).toContain('topology_edge');
    expect(result).toContain('proposal_influence');
    expect(result).toContain('explicit_mention');
    expect(result).toContain('implied');
    expect(result).toContain('derived');
  });

  it('instructs the agent to update neighborhood tasks via edit_work_item tool calls', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('After assessment: update neighborhood tasks');
    expect(result).toContain('edit_work_item');
    expect(result).toContain('edit_tasks');
    expect(result).toContain('Task neighborhood context');
  });

  it('states that neighborhood edits do not alter the final_assessment_v2 response', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('does NOT alter the `final_assessment_v2` response JSON');
    expect(result).toContain('do not appear as a separate `responseType`');
  });

  it('includes child-task stub detection rules', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('often stubs');
    expect(result).toContain('Empty or whitespace-only');
    expect(result).toContain('A single sentence');
    expect(result).toContain('Fewer than two paragraphs');
    expect(result).toContain('Type Definition block');
  });

  it('includes parent-task surgical-edit rule and materiality gate', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('surgical edits only');
    expect(result).toContain('smallest possible change');
    expect(result).toContain('Materiality gate');
    expect(result).toContain('definition of done');
  });

  it('forbids solo status-only edit_work_item calls on neighborhood tasks', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain(
      'Never call `edit_work_item` on a neighbor solely to change its `status` field',
    );
    expect(result).toContain('status-only edit on a neighbor is never correct');
  });

  it('tells the agent to skip or omit when context is insufficient', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain(
      'omit that field from the `edit_work_item` arguments rather than invent content',
    );
    expect(result).toContain('skip the `edit_work_item` call for that neighbor entirely');
  });

  it('renders a Type Definition block with the caption above a yaml-labeled fence', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain(
      'Type Definition (fields introduced/changed by this task only):\n```yaml',
    );
    expect(result).toContain('fieldName:');
    expect(result).toContain('type: string');
  });

  it('runs a structural-soundness pass on each ancestor feature with the four patterns named', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('Structural soundness pass (per ancestor feature)');
    expect(result).toContain('Architectural-slice top-level');
    expect(result).toContain('Mechanism-shaped name');
    expect(result).toContain('Redundant nesting');
    expect(result).toContain('Tag/position inconsistency');
    expect(result).toContain('`Web UI`');
    expect(result).toContain('`Core Backend`');
    expect(result).toContain('re-parent');
    expect(result).toContain('merge');
    expect(result).toContain('tag correction');
    expect(result).toContain('edit_work_item');
    expect(result).toContain('`Send Updates over WebSockets` becomes `Live Updates`');
    expect(result).toContain('properly nested `Event Delivery` remains unchanged');
  });

  it('keeps the surface light and defers to feature-sync as the primary structural-feedback surface', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('src/agents/feature-sync/prompts.ts');
    expect(result).toContain('primary');
    expect(result).toContain(
      'do not let a structurally mis-parented or mis-tagged ancestor feature land at session-close',
    );
    expect(result).toContain('Keep the surface light');
    expect(result).toContain('defer to feature-sync');
  });

  it('routes structural findings through the existing per-section rationale rather than a new top-level field', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('Capture each structural finding in the **rationale**');
    expect(result).toContain('include it in the description entry by default');
    expect(result).toContain('Do not invent a new top-level JSON field');
    expect(result).toContain('When the structural finding warrants an `edit_work_item` proposal');
    expect(result).toContain('"proposed_update"');
  });

  it('directs the hierarchy walk to call get_feature_sync_context for authoritative feature text', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('get_feature_sync_context');
    expect(result).toContain('description');
    expect(result).toContain('requirements');
  });

  it('reframes speculation as touching surfaces the session did not exercise', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('What "speculation" means here');
    expect(result).toContain('Speculation is proposing on a surface');
    expect(result).toContain('the session did not touch');
    expect(result).toContain('is enrichment, not speculation');
  });

  it('treats missing fine-grained details as a reason to propose a lower-fidelity update, not skip', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('Missing fine-grained interaction details');
    expect(result).toContain('lower-fidelity proposal');
  });

  it('exempts feature description updates from the untouched-surface scope rule', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain(
      'if the session changed a user-facing capability that an ancestor feature describes',
    );
    expect(result).toContain('must not block it');
    expect(result).toContain('does not apply to feature descriptions');
  });

  it('declares the agent strictly one-shot with no mid-turn user interaction', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toMatch(/strictly one-shot/i);
    expect(result).toMatch(/never interact with the user mid-turn/i);
    expect(result).not.toMatch(/ask the user/i);
  });

  it('directs the agent to ground itself via repo search before declaring a block', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toMatch(/Read,\s*Grep,\s*Glob/);
    expect(result).toMatch(/MCP search/i);
  });

  it('carries over the neighborhood writing standards including both list examples', () => {
    const payload: LocalFinalAssessmentPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Done.',
      taskNeighborhood: emptyNeighborhood(),
    };
    const result = buildFinalAssessmentPrompt(payload);
    expect(result).toContain('Writing standards for neighborhood edits');
    expect(result).toContain('Two paragraphs');
    expect(result).toContain('What you get');
    expect(result).toContain("What you don't get");
    expect(result).toContain('Users can filter tasks by status');
    expect(result).toContain('Bulk status changes across multiple tasks');
    expect(result).toContain('No weasel words');
    expect(result).toContain('No performance thresholds');
    expect(result).toContain('No process claims');
  });
});

describe('buildReviewPrompt', () => {
  const expectContainedReviewScope = (result: string): void => {
    expect(result).toContain(
      "the target Run's durable canonical touched-file list: evidence of actual correlated changes, not a write boundary",
    );
    expect(result).toContain(
      'Required repairs may modify other files inside approved Service workspace roots',
    );
    expect(result).toContain(
      "The finding was introduced by the originating session's change or directly blocks the correctness of that change",
    );
    expect(result).toContain(
      'The repair is required by the originating task and latest applicable user intent and is not excluded by any available Plan or Report evidence',
    );
    expect(result).toContain('Severity never expands scope');
    expect(result).toContain(
      'They do not expand semantic repair scope or approved Service workspaces. Checks are evidence, not work queues',
    );
    expect(result).not.toContain('request_review_file_scope');
    expect(result).toContain(
      'iterate only when the failure is attributable to the reviewed session and its repair remains inside both the semantic scope gate and approved Service workspace boundary',
    );
    expect(result).toContain('Report every other failure without changing more code');
    expect(result).not.toContain('Treat this as a helpful starting point');
    expect(result).not.toContain('the list may be incomplete');
  };

  it('declares the agent strictly one-shot with no mid-turn user interaction', () => {
    const result = buildReviewPrompt({ touchedFiles: [] });
    expect(result).toMatch(/strictly one-shot/i);
    expect(result).toMatch(/never interact with the user mid-turn/i);
    expect(result).not.toMatch(/ask the user/i);
  });

  it('allows required noncanonical repairs only inside approved Service roots', () => {
    const result = buildReviewPrompt({ touchedFiles: ['src/current.ts'] });
    expect(result).toContain('without individual-file approval');
    expect(result).toContain('including files absent from canonical Run membership');
    expect(result).toContain('Host checkouts outside resolved worktree roots remain unauthorized');
    expect(result).toContain('Another Service requires the existing Service authorization process');
    expect(result).toContain('Authorization never establishes changed-file membership');
    expect(result).not.toContain('request_review_file_scope');
    expect(result).toMatchSnapshot();
  });

  it('directs the reviewer to ground itself via repo search before declaring a block', () => {
    const result = buildReviewPrompt({ touchedFiles: [] });
    expect(result).toMatch(/Read,\s*Grep,\s*Glob/);
    expect(result).toMatch(/MCP search/i);
  });

  it('renders the single review contract with an optional focus message', () => {
    const result = buildReviewPrompt({
      touchedFiles: ['src/review.ts'],
      recentUserReplies: [
        {
          messageId: 'message-1',
          text: 'Keep the compact layout requested after implementation.',
          createdAt: '2026-09-16T05:00:00.000Z',
        },
      ],
      userMessage: 'Concentrate on error handling.',
      integrationContext: {
        trigger: 'cross_service_dependency',
        selectedServiceIds: ['service-a'],
        originatingTaskId: 'task-a',
        originatingTaskServiceIds: ['service-a'],
        dependencyTaskIds: ['task-b'],
        dependencyServiceIds: ['service-b'],
      },
    });

    expectContainedReviewScope(result);
    expect(result).toContain('## Cross-Service Integration Verification');
    expect(result).toContain('request paths and data flows');
    expect(result).toContain('shared events or payloads');
    expect(result).toContain('Contract, design doc, or feature description');
    expect(result).toContain('`needs documentation`');
    expect(result).toContain('without blocking Review');
    expect(result).toMatchSnapshot();
  });

  it('renders one JSON-safe post-implementation request before focus and prior reports', () => {
    const result = buildReviewPrompt({
      touchedFiles: ['src/review.ts'],
      recentUserReplies: [
        {
          messageId: 'message-1',
          text: 'Keep the user\'s "compact" layout.\nDo not revert it.',
          createdAt: '2026-09-16T05:00:00.000Z',
        },
      ],
      userMessage: 'Concentrate on regressions.',
    });

    expect(result).toContain(
      'Request 1: "Keep the user\'s \\"compact\\" layout.\\nDo not revert it."',
    );
    expect(result).not.toContain('message-1');
    expect(result).not.toContain('2026-09-16T05:00:00.000Z');
    expect(result.indexOf('## User Requests After Implementation')).toBeLessThan(
      result.indexOf('## User Focus'),
    );
    expect(result.indexOf('## User Requests After Implementation')).toBeLessThan(
      result.indexOf('## Prior Reports'),
    );
  });

  it('orders multiple requests and preserves requested behavior as intentional', () => {
    const result = buildReviewPrompt({
      touchedFiles: ['src/review.ts'],
      recentUserReplies: [
        {
          messageId: 'message-2',
          text: 'Keep the requested behavior; it is intentional.',
          createdAt: '2026-09-16T05:10:00.000Z',
        },
        {
          messageId: 'message-1',
          text: 'Change the behavior from the original task.',
          createdAt: '2026-09-16T05:00:00.000Z',
        },
      ],
    });

    expect(result.indexOf('Change the behavior from the original task.')).toBeLessThan(
      result.indexOf('Keep the requested behavior; it is intentional.'),
    );
    expect(result).toContain('honor the latest applicable request');
    expect(result).toContain(
      'Do not treat behavior explicitly requested here as a revert candidate',
    );
    expect(result).toContain('does not authorize unrelated work');
    expect(result).toContain('approved Service scope');
    expect(result).toContain('Service scope');
  });

  it('preserves the existing prompt when the request window is empty', () => {
    expect(buildReviewPrompt({ touchedFiles: ['src/review.ts'], recentUserReplies: [] })).toBe(
      buildReviewPrompt({ touchedFiles: ['src/review.ts'] }),
    );
  });

  it('omits integration guidance from ordinary same-Service Review', () => {
    const result = buildReviewPrompt({ touchedFiles: ['src/review.ts'] });

    expectContainedReviewScope(result);
    expect(result).not.toContain('Cross-Service Integration Verification');
    expect(result).not.toContain('needs documentation');
  });

  it('allows Review without focus or prior Report prerequisites', () => {
    const result = buildReviewPrompt({ touchedFiles: ['src/review.ts'], userMessage: '' });
    expectContainedReviewScope(result);
    expect(result).toContain('Their absence never blocks Review');
    expect(result).not.toContain('Terminal Policy Context');
    expect(result).not.toContain('Durable Review Outcome');
  });
});

describe('buildVerificationPlanPrompt', () => {
  it('builds a prompt with verification structure', () => {
    const payload: LocalVerificationPlanPromptPayload = {
      context: makeContext(),
      startupInput: makeStartupInput(),
      executionSummary: 'Added login endpoint.',
    };
    const result = buildVerificationPlanPrompt(payload);
    expect(result).toContain('verification_plan_v1');
    expect(result).toContain('product_walkthrough');
    expect(result).toContain('Added login endpoint.');
  });
});

describe('buildChildTaskUpdatesPrompt', () => {
  const basePayload: LocalChildTaskUpdatesPromptPayload = {
    completedTask: {
      id: 'parent-1',
      title: 'Parent task',
      description: 'Implemented auth',
    },
    finalAssessment: {
      taskAssessment: { verdict: 'completed' },
    } as unknown as LocalChildTaskUpdatesPromptPayload['finalAssessment'],
    childTasks: [
      {
        id: 'child-1',
        title: 'Child task',
        description: 'Extend auth to admin',
      },
    ] as unknown as LocalChildTaskUpdatesPromptPayload['childTasks'],
  };

  it('builds a prompt with parent and child context', () => {
    const result = buildChildTaskUpdatesPrompt(basePayload);
    expect(result).toContain('child_task_description_update_v1');
    expect(result).toContain('parent-1');
    expect(result).toContain('child-1');
  });

  it('throws when childTasks is empty', () => {
    expect(() => buildChildTaskUpdatesPrompt({ ...basePayload, childTasks: [] })).toThrow(
      'at least one child task',
    );
  });

  it('includes initiative context when provided', () => {
    const payload = {
      ...basePayload,
      initiative: { id: 'init-1', title: 'Q1 Goals' },
    } as unknown as LocalChildTaskUpdatesPromptPayload;
    const result = buildChildTaskUpdatesPrompt(payload);
    expect(result).toContain('Initiative');
    expect(result).toContain('Q1 Goals');
  });

  it('includes design doc context when provided', () => {
    const payload = {
      ...basePayload,
      designDoc: { id: 'dd-1', title: 'Auth Design' },
    } as unknown as LocalChildTaskUpdatesPromptPayload;
    const result = buildChildTaskUpdatesPrompt(payload);
    expect(result).toContain('Design doc');
    expect(result).toContain('Auth Design');
  });
});

describe('buildSetSplittingPrompt', () => {
  const makeSetSplittingPayload = (
    overrides: Partial<LocalSetSplittingPromptPayload> = {},
  ): LocalSetSplittingPromptPayload => ({
    startupInput: makeStartupInput(),
    splitMode: 'feature',
    userMessage: 'heya',
    ...overrides,
  });

  it('uses the canonical focal projection for parent task context', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload());
    expect(result).toContain('canonical focal entity projection');
    expect(result).not.toContain('Implement feature X');
    expect(result).toContain('get_context');
    expect(result).toMatchSnapshot();
  });

  it('does not add section edit policy to the create-only split flow', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload());
    expect(result).not.toContain('## Work-item section edit safety');
  });

  it('includes feature mode instructions', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload({ splitMode: 'feature' }));
    expect(result).toContain('Split mode: feature');
    expect(result).toContain('feature boundaries');
  });

  it('includes service mode instructions', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload({ splitMode: 'service' }));
    expect(result).toContain('Split mode: service');
    expect(result).toContain('one task per service');
  });

  it('includes user guidance when provided in feature mode', () => {
    const result = buildSetSplittingPrompt(
      makeSetSplittingPayload({
        splitMode: 'feature',
        userGuidance: 'Split by auth vs data layers',
      }),
    );
    expect(result).toContain('Split by auth vs data layers');
  });

  it('includes user guidance when provided in service mode', () => {
    const result = buildSetSplittingPrompt(
      makeSetSplittingPayload({
        splitMode: 'service',
        userGuidance: 'We have an API, a worker, and a gateway',
      }),
    );
    expect(result).toContain('We have an API, a worker, and a gateway');
  });

  it('instructs the agent to use create_work_item tool', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload());
    expect(result).toContain('create_work_item');
  });

  it('requires 2 or more sub-tasks', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload());
    expect(result).toContain('2 or more');
  });

  it('instructs agent to explain rationale in plain text', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload());
    expect(result).toContain('Do not output JSON');
  });

  it('lists explicit services when provided in service mode', () => {
    const result = buildSetSplittingPrompt(
      makeSetSplittingPayload({
        splitMode: 'service',
        services: [
          { id: 'svc-1', name: 'API Gateway' },
          { id: 'svc-2', name: 'Worker Service' },
        ],
      }),
    );
    expect(result).toContain('1. API Gateway (id: svc-1)');
    expect(result).toContain('2. Worker Service (id: svc-2)');
    expect(result).toContain('exactly one service from this list');
  });

  it('instructs agent to include service name in task title', () => {
    const result = buildSetSplittingPrompt(
      makeSetSplittingPayload({
        splitMode: 'service',
        services: [{ id: 'svc-1', name: 'API Gateway' }],
      }),
    );
    expect(result).toContain('service name in each task title');
  });

  it('includes user guidance alongside explicit services', () => {
    const result = buildSetSplittingPrompt(
      makeSetSplittingPayload({
        splitMode: 'service',
        services: [{ id: 'svc-1', name: 'API Gateway' }],
        userGuidance: 'Focus on API contracts',
      }),
    );
    expect(result).toContain('API Gateway (id: svc-1)');
    expect(result).toContain('Focus on API contracts');
  });

  it('falls back to discovery when no services provided in service mode', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload({ splitMode: 'service' }));
    expect(result).toContain('Identify every distinct service');
  });

  it('falls back to discovery when services is an empty array', () => {
    const result = buildSetSplittingPrompt(
      makeSetSplittingPayload({ splitMode: 'service', services: [] }),
    );
    expect(result).toContain('Identify every distinct service');
  });

  it('includes the four-step integration-surface analysis in service mode with explicit services', () => {
    const result = buildSetSplittingPrompt(
      makeSetSplittingPayload({
        splitMode: 'service',
        services: [
          { id: 'svc-1', name: 'API Gateway' },
          { id: 'svc-2', name: 'Worker Service' },
        ],
      }),
    );
    expect(result).toContain('Integration-surface analysis');
    expect(result).toContain('how the services work together');
    expect(result).toContain('shared events or payloads');
    expect(result).toContain('Search the feature tree');
    expect(result).toContain('single source of truth');
    expect(result).toContain('needs documentation');
  });

  it('includes the four-step integration-surface analysis in the service-discovery fallback path', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload({ splitMode: 'service' }));
    expect(result).toContain('Integration-surface analysis');
    expect(result).toContain('how the services work together');
    expect(result).toContain('shared events or payloads');
    expect(result).toContain('Search the feature tree');
    expect(result).toContain('single source of truth');
    expect(result).toContain('needs documentation');
  });

  it('phrases documentation as a nudge, never a hard requirement', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload({ splitMode: 'service' }));
    expect(result).toContain('consider suggesting');
    expect(result).toContain('must not block or gate the split');
    expect(result).not.toContain('MUST create a design doc');
  });

  it('tells each generated sub-task to reference an agreement or carry a needs-documentation note', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload({ splitMode: 'service' }));
    expect(result).toContain('Have each generated sub-task reference the agreement');
    expect(result).toContain('@[feature:id|name]');
    expect(result).toContain('needs documentation');
  });

  it('leaves feature mode free of the integration-surface analysis markers', () => {
    const result = buildSetSplittingPrompt(makeSetSplittingPayload({ splitMode: 'feature' }));
    expect(result).not.toContain('Integration-surface analysis');
    expect(result).not.toContain('needs documentation');
  });
});

describe('buildEntityConversationPrompt', () => {
  const makeEntityPayload = (
    overrides: Partial<LocalEntityConversationPromptPayload> = {},
  ): LocalEntityConversationPromptPayload => ({
    entity: {
      entityId: 'task-abc-123',
      entityType: 'TASK',
      title: 'Implement JWT rotation',
      description: 'Add refresh token rotation to auth middleware.',
      acceptanceCriteria: 'Tokens rotate on renewal.',
    },
    userMessage: 'hey',
    ...overrides,
  });

  it('matches the full Contract-aware entity conversation prompt', () => {
    const prompt = buildEntityConversationPrompt(makeEntityPayload());
    expect(prompt).toMatch(/Contract Companion Proposals/i);
    expect(prompt).toContain('ambient Contract-recognition boundary');
    expect(prompt).toContain("relevant element's concrete inputs, outputs, and responsibility");
    expect(prompt).toContain('outside a Diagram');
    expect(prompt).toContain('root authoring guide and Contract-specific guide');
    expect(prompt).toContain('reference roll-ups');
    expect(prompt).not.toContain('Attach every step evidenced as authoring');
    expect(prompt).toContain('boundary remains under-modeled');
    expect(prompt).toMatchSnapshot();
  });

  it('requires context-first lifecycle handling before task edits', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).toContain('When updating `sections` on an entity');
    expect(result).toContain('registry role `work-item`');
    expect(result).toContain('ACTIVE is ambiguous');
    expect(result).toContain('VERIFYING:** Ask before editing sections.');
    expect(result).toContain('COMPLETED:** Do not edit sections unless the user instructs you to.');
  });

  it('leaves focal entity identity and content to the canonical provider projection', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).toContain('canonical focal entity projection');
    expect(result).not.toContain('## Entity');
    expect(result).not.toContain('Implement JWT rotation');
    expect(result).toContain('Do not reload that same focal entity by default');
    expect(result).toContain('different referenced entity');
    expect(result).not.toContain('Before responding to the user, call get_context');
  });

  it('does not repeat focal entity description or acceptance criteria', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).not.toContain('Add refresh token rotation to auth middleware.');
    expect(result).not.toContain('Tokens rotate on renewal.');
  });

  it('includes the conversation role instruction', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).toContain('user has started a conversation');
  });

  it('composes graph research once in Entity Conversation instructions', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result.match(/## Widening graph research/gu)).toHaveLength(1);
    expect(result).toContain('no supplied Service association or session Service context');
  });

  it('includes page context when provided', () => {
    const result = buildEntityConversationPrompt(
      makeEntityPayload({
        pageContext: 'You are viewing the plan "Q4 Roadmap" (planId: plan-789)',
      }),
    );
    expect(result).toContain('Page Context');
    expect(result).toContain('Q4 Roadmap');
  });

  it('omits page context section when not provided', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).not.toContain('Page Context');
  });

  it('includes influences with lineage details', () => {
    const result = buildEntityConversationPrompt(
      makeEntityPayload({
        influences: [
          {
            entityId: 'dd-456',
            entityType: 'DESIGN_DOC',
            reasoning: 'Design doc specifies JWT rotation requirements.',
            reasonType: 'explicit_mention',
            confidence: 0.95,
          },
          {
            entityId: 'task-789',
            entityType: 'TASK',
            reasoning: 'Parent task defined the auth scope.',
            reasonType: 'derived',
          },
        ],
      }),
    );
    expect(result).toContain('Decision Lineage');
    expect(result).toContain('dd-456');
    expect(result).toContain('DESIGN_DOC');
    expect(result).toContain('Design doc specifies JWT rotation requirements.');
    expect(result).toContain('explicit_mention');
    expect(result).toContain('0.95');
    expect(result).toContain('task-789');
    expect(result).toContain('Parent task defined the auth scope.');
  });

  it('omits lineage section when influences array is empty', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload({ influences: [] }));
    expect(result).not.toContain('Decision Lineage');
  });

  it('omits lineage section when influences not provided', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).not.toContain('Decision Lineage');
  });

  it('includes originating conversation reference', () => {
    const result = buildEntityConversationPrompt(
      makeEntityPayload({
        originatingConversationId: 'conv-xyz-999',
      }),
    );
    expect(result).toContain('Originating Conversation');
    expect(result).toContain('conv-xyz-999');
  });

  it('omits originating conversation when not provided', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).not.toContain('Originating Conversation');
  });

  it('omits user request section', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).not.toContain("User's Request");
  });

  it('throws when entity is missing', () => {
    expect(() => buildEntityConversationPrompt({} as LocalEntityConversationPromptPayload)).toThrow(
      'buildEntityConversationPrompt requires non-empty fields: entity',
    );
  });

  it('throws when entityId is missing', () => {
    expect(() =>
      buildEntityConversationPrompt(
        makeEntityPayload({
          entity: { entityId: '', entityType: 'TASK' },
        }),
      ),
    ).toThrow('entity.entityId');
  });

  it('throws when entityType is missing', () => {
    expect(() =>
      buildEntityConversationPrompt(
        makeEntityPayload({
          entity: {
            entityId: 'task-1',
            entityType: '' as LocalEntityConversationEntityEntityTypeEnum,
          },
        }),
      ),
    ).toThrow('entity.entityType');
  });

  it('does not synthesize a focal display block when title is absent', () => {
    const result = buildEntityConversationPrompt(
      makeEntityPayload({
        entity: { entityId: 'task-no-title', entityType: 'TASK' },
      }),
    );
    expect(result).not.toContain('**TASK**: task-no-title');
  });

  it('does not repeat non-task entity content beside the canonical projection', () => {
    const result = buildEntityConversationPrompt(
      makeEntityPayload({
        entity: {
          entityId: 'dd-1',
          entityType: 'DESIGN_DOC',
          title: 'Auth Design',
          content: 'Full design document body text here.',
        },
      }),
    );
    expect(result).not.toContain('Full design document body text here.');
  });

  it('treats need-style statements as requests to propose work items', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).toContain(
      'This conversation exists to produce work items: when the user says something needs to change ("we need to do X", "we need to update this to Y"), review the project and propose the right work item (task, bug, or other type).',
    );
  });

  it('requires an explicit, confirmed edit request despite access or discussion conclusions', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).toContain(
      'Change files, code, or repository state only after the user explicitly asks for an edit, you confirm that request with them, and they agree in a later message;',
    );
    expect(result).toContain(
      'repository or Service access and your own conclusion that code should change are not permission to edit.',
    );
  });

  it('omits the structural-correction reflection rule', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).not.toContain('## Structural-Correction Reflection');
  });

  it('includes the plan-vs-tasks fork', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).toContain('## Plan vs. tasks');
  });

  it('includes custom-type mutation guidance across creation, project-owned editing, grounding, and user intent', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).toContain('## Drafting a custom work-item type');
    // Ground on how a core type is declared before composing.
    expect(result).toContain('get_tool_guidance');
    expect(result).toContain('ground on how a core type is declared');
    // Compose a complete definition spanning every axis.
    expect(result).toContain('compose a complete definition across every axis');
    // Submit through the allow-listed tool for review.
    expect(result).toContain('create_work_item_type');
    // Active project-owned definitions use the dedicated edit operation rather than creation.
    expect(result).toContain('edit_work_item_type');
    expect(result).toContain('active project-owned type definition');
    expect(result).toContain('CANONICAL_OVERRIDE');
    expect(result).toContain('PROJECT_CUSTOM');
    expect(result).toContain(
      'complete project override over the immutable global canonical definition',
    );
    expect(result).toContain('get_work_item_type({ typeKey })');
    expect(result).toContain('returned complete `definition`');
    expect(result).toContain('change only the fields the user requested');
    expect(result).toContain('preserve every other axis verbatim');
    expect(result).toContain('never reconstruct omitted axes from prompt history');
    expect(result).toContain('never edit the global seed directly');
    expect(result).toContain('recreate an existing type through `create_work_item_type`');
    // User-initiated only — flat rule, no escape hatch.
    expect(result).toContain('never propose one unsolicited');
  });

  it('omits the structural-correction reflection rule for non-FEATURE entities', () => {
    const result = buildEntityConversationPrompt(
      makeEntityPayload({
        entity: { entityId: 'task-1', entityType: 'TASK', title: 't' },
      }),
    );
    expect(result).not.toContain('## Structural-Correction Reflection');
  });

  it('includes feature coherence section naming both directions when the canonical TASK subtype is FEATURE', () => {
    const result = buildEntityConversationPrompt(
      makeEntityPayload({
        entity: {
          entityId: 'feature-1',
          entityType: 'TASK',
          taskType: 'FEATURE',
          title: 'Plans',
          description: 'Plans feature',
        },
      }),
    );
    expect(result).toContain('## Feature Coherence');
    expect(result).toContain('Adding a task under this feature');
    expect(result).toContain('concomitant edit');
    expect(result).toContain('Editing this feature');
    expect(result).toContain('companion tasks');
  });

  it('does not confuse a custom lowercase subtype with the platform FEATURE type', () => {
    const result = buildEntityConversationPrompt(
      makeEntityPayload({
        entity: {
          entityId: 'feature-1',
          entityType: 'TASK',
          taskType: 'feature',
          title: 'Plans',
        },
      }),
    );
    expect(result).not.toContain('## Feature Coherence');
  });

  it('omits the feature coherence section for non-feature entity types', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).not.toContain('## Feature Coherence');
  });

  it('renders the Naming this conversation section for a non-GOAL entity payload', () => {
    // Regression: the section is intentionally NOT gated on `taskType === 'GOAL'`,
    // so every entity-conversation surface advertises submit_session_name.
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).toContain('## Naming this conversation');
    expect(result).toContain('submit_session_name');
  });

  it('renders the Goal Scoping section, dueDate, and tracked-entities list for a GOAL payload', () => {
    const result = buildEntityConversationPrompt(
      makeEntityPayload({
        entity: {
          entityId: 'goal-1',
          entityType: 'TASK',
          taskType: 'GOAL',
          title: 'Ship Goal V2',
          description: 'Stand up the goal conversation surface.',
          dueDate: '2026-09-30',
          trackedEntities: [
            {
              targetEntityId: 'feature-77',
              targetEntityType: 'FEATURE',
              title: 'Goal Conversation Prompt',
            },
            {
              targetEntityId: 'task-88',
              targetEntityType: 'TASK',
              title: 'Wire trackedEntities into payload',
            },
          ],
        } as unknown as LocalEntityConversationPromptPayload['entity'],
      }),
    );
    expect(result).toContain('The input entity is a goal.');
    expect(result).toContain('## Goal Scoping');
    expect(result).toContain('The focal entity itself is the goal.');
    expect(result).toContain('Do not search for a separate goal attached to it');
    expect(result).toContain('authoritative if an earlier research memo');
    expect(result).toContain("The goal's description and due date are scoping inputs");
    expect(result).not.toContain('- Due: 2026-09-30');
    expect(result).not.toContain('### Currently tracked');
    expect(result).not.toContain('Goal Conversation Prompt (FEATURE, feature-77)');
    expect(result).not.toContain('Wire trackedEntities into payload (TASK, task-88)');
    expect(result).toContain('unified_search');
    expect(result).toContain('attach_to_goal');
    expect(result).toContain('create_work_item');
    expect(result).toContain('NEVER pass this goal as `parentTaskId`');
    expect(result).toContain('`create_edge` does not accept TRACKS');
    expect(result).toContain("recall it across all of this goal's conversations");
    expect(result).toContain('name it once; skip empty threads');
    expect(result).toMatchSnapshot();
  });

  it('renders Goal Scoping without repeating due date or tracked entities', () => {
    const result = buildEntityConversationPrompt(
      makeEntityPayload({
        entity: {
          entityId: 'goal-2',
          entityType: 'TASK',
          taskType: 'GOAL',
          title: 'Empty Goal',
          dueDate: '2026-12-01',
          trackedEntities: [],
        } as unknown as LocalEntityConversationPromptPayload['entity'],
      }),
    );
    expect(result).toContain('## Goal Scoping');
    expect(result).toContain("The goal's description and due date are scoping inputs");
    expect(result).not.toContain('- Due: 2026-12-01');
    expect(result).not.toContain('### Currently tracked');
    expect(result).not.toContain('_(none)_');
  });

  it('omits the Goal Scoping section, dueDate line, and tracked-entities list for non-GOAL tasks', () => {
    const result = buildEntityConversationPrompt(makeEntityPayload());
    expect(result).not.toContain('The input entity is a goal.');
    expect(result).not.toContain('## Goal Scoping');
    expect(result).not.toContain('- Due:');
    expect(result).not.toContain('### Currently tracked');
    expect(result).not.toContain("recall it across all of this goal's conversations");
    expect(result).not.toContain('name it once; skip empty threads');
  });
});

describe('buildCodingConversationPrompt launch mode', () => {
  const makeFreeFormPayload = (
    overrides: Partial<LocalFreeFormPromptPayload> = {},
  ): LocalFreeFormPromptPayload => ({
    startupInput: makeStartupInput(),
    userMessage: 'heya',
    ...overrides,
  });

  it('builds a prompt with conditional focal orientation', () => {
    const result = buildCodingConversationPrompt(makeFreeFormPayload(), { kind: 'launch' });
    expect(result).not.toContain('Implement feature X');
    expect(result).toContain('get_context');
    expect(result).toContain('Do not reload that same focal entity by default');
    expect(result).toContain('user requests fresh state');
  });

  it('instructs the agent to act on what is clear rather than open with questions', () => {
    const result = buildCodingConversationPrompt(makeFreeFormPayload(), { kind: 'launch' });
    expect(result).toContain('Act on what');
    expect(result).toContain('implement directly');
  });

  it('keeps routine discovery and conditional hazards out of readiness review', () => {
    const result = buildCodingConversationPrompt(makeFreeFormPayload(), { kind: 'launch' });

    expect(result).toMatch(
      /routine fault localization, service ownership tracing, code discovery/i,
    );
    expect(result).toMatch(/possible Temporal, migration, rollout, or cross-service consequence/i);
    expect(result).toContain(
      'The Clarify-routing behavior and workflow-aware routing are already recorded',
    );
    expect(result).toContain('Authoritative context leaves two or more valid lifecycle');
  });

  it('does not preclude planning when user requests it', () => {
    const result = buildCodingConversationPrompt(makeFreeFormPayload(), { kind: 'launch' });
    expect(result).toContain('user asks you to brainstorm or plan');
  });

  it('omits the Additional Instructions section', () => {
    const result = buildCodingConversationPrompt(makeFreeFormPayload(), { kind: 'launch' });
    expect(result).not.toContain('Additional Instructions');
  });

  it('snapshots the source-bound implementation-readiness preflight contract', () => {
    const sourceSnapshot: ImplementationReadinessSourceSnapshot = {
      runId: 'run-free-form-1',
      focalEntityId: 'task-1',
      focalEntityType: 'TASK',
      sourceRevision: 'sha256:readiness-source',
      capturedAt: '2026-09-17T19:00:00.000Z',
    };

    const prompt = buildCodingConversationPrompt(makeFreeFormPayload(), {
      kind: 'launch',
      implementationReadinessSourceSnapshot: sourceSnapshot,
    });

    expect(prompt).toMatchSnapshot();
  });
});

describe('buildCodingConversationPrompt', () => {
  it.each([
    { kind: 'launch' as const },
    { kind: 'follow_up' as const, awaitingUserReview: false, taskId: null },
  ])('composes the shared policy and ends with completion reconciliation in $kind mode', (mode) => {
    const result = buildCodingConversationPrompt({ userMessage: 'add a few related tasks' }, mode);
    expect(result).toContain('## Behavioral Guidelines');
    expect(result).toContain(buildActivityResponsibilities());
    expect(result.indexOf(buildActivityResponsibilities())).toBeGreaterThan(
      result.indexOf('## Behavioral Guidelines'),
    );
    expect(result).toContain('## Follow References');
    expect(result).toContain('## Plan vs. tasks');
    expect(result).toContain('## Additional Service scope');
    expect(result.endsWith(buildCompletionReconciliationPromptFor(new Set()))).toBe(true);
    expect(result).toMatchSnapshot();
  });

  it('tells a launch that a readiness response replaces the completion JSON', () => {
    const result = buildCodingConversationPrompt({ userMessage: 'go' }, { kind: 'launch' });
    expect(result).toContain('A readiness response replaces the completion JSON below');
    expect(result.indexOf('## Implementation-readiness preflight')).toBeLessThan(
      result.indexOf(buildCompletionReconciliationPromptFor(new Set())),
    );
  });

  it('keeps launch orientation and follow-up orientation separate', () => {
    const launch = buildCodingConversationPrompt({ userMessage: 'go' }, { kind: 'launch' });
    const followUp = buildCodingConversationPrompt(
      { userMessage: 'go' },
      { kind: 'follow_up', awaitingUserReview: false, taskId: null },
    );
    expect(launch).toContain('You are starting a free-form coding session');
    expect(launch).not.toContain('## Orientation');
    expect(followUp).toContain('## Orientation');
    expect(followUp).not.toContain('## Implementation-readiness preflight');
    expect(followUp).not.toContain('## Focal context orientation');
  });
});

describe('buildFeatureTreeConversationPrompt', () => {
  it('includes the plan-vs-tasks fork', () => {
    const result = buildFeatureTreeConversationPrompt({ skeleton: [] });
    expect(result).toContain('## Plan vs. tasks');
  });

  it('recites the AI tag in the tag-mix vocabulary', () => {
    const result = buildFeatureTreeConversationPrompt({ skeleton: [] });
    expect(result).toContain('`product` / `frontend` / `backend` / `infra` / `design` / `AI`');
  });

  it('derives insights from lifecycle inference, not a stored status field', () => {
    const result = buildFeatureTreeConversationPrompt({ skeleton: [] });
    // The status-distribution readout is gone — features carry no status field.
    expect(result).not.toContain('COMPLETED / IN_PROGRESS / TODO');
    expect(result).not.toContain('status=');
    // Project insights now reads lifecycle state from edges and tasks.
    expect(result).toContain('Lifecycle mix by top-level feature');
    expect(result).toContain('planned / in development / deprecated');
  });
});

describe('buildGoalPmPrompt', () => {
  const payload: LocalGoalPmPromptPayload = {
    entity: {
      entityType: 'TASK',
      entityId: '11111111-1111-4111-8111-111111111111',
      taskType: 'GOAL',
      title: 'Goal PM routing',
      description: 'Route goal requests to the right conversation or work item.',
      dueDate: '2026-12-01T00:00:00Z',
    },
    userMessage: 'Find the right destination.',
    activeConversationId: '22222222-2222-4222-8222-222222222222',
    conversationInventory: [
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        title: 'Delivery planning',
        owner: {
          entityType: 'TASK',
          entityId: '11111111-1111-4111-8111-111111111111',
          taskType: 'GOAL',
        },
        workflowName: 'entity-conversation',
      },
    ],
  };

  it('keeps the goal request bounded to discovery and routing', () => {
    const prompt = buildGoalPmPrompt(payload);

    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain('read-only graph session');
    expect(prompt).toContain('Search the MESSAGE history of these conversations');
    expect(prompt).toContain('one response with mutually exclusive option kinds');
    expect(prompt).toContain('Do not emit a bare conversationId');
    expect(prompt).toContain('"kind": "existingConversation"');
    expect(prompt).toContain('"kind": "startNewConversation"');
    expect(prompt).toContain('"kind": "refineSearch"');
    expect(prompt).toContain('"kind": "trackExistingWork"');
    expect(prompt).toContain('"kind": "createMissingWork"');
    expect(prompt).toContain('"kind": "proposal"');
    expect(prompt).toContain('"target": {');
    expect(prompt).toContain('Never put those target fields at the option root');
    expect(prompt).not.toContain(payload.userMessage);
  });
});
