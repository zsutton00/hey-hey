import { planShapingFeatureSyncAnalyzeHandler } from '../plan-shaping-feature-sync/analyze.handler';
import { planShapingFeatureSyncIterateHandler } from '../plan-shaping-feature-sync/iterate.handler';
import { planShapingFeatureSyncDiscussHandler } from '../plan-shaping-feature-sync/discuss.handler';
import { describe, expect, it } from 'vitest';
import { PlanShapingValidationMode } from '../../shared/agent-bridge-contract/generated/api';
import {
  CODING_MCP_TOOLS,
  resolveMcpToolNames,
  GENERAL_MCP_TOOLS,
  PLANNING_MCP_TOOLS,
  RESEARCH_MCP_TOOLS,
} from '../mcp-server-config';
import { CODING_PLAN_SUBAGENT_MCP_ALLOWED_TOOLS } from '../coding-plan/coding-plan.handler';
import { buildAnalyzePrompt } from '../feature-sync/prompts';
import { buildFeatureTreeConversationPrompt } from '../feature-tree-conversation/feature-tree-conversation-prompt';
import { buildProposedStagesPrompt, buildRefineStagePrompt } from '../plan-shaping/prompts';
import { PLAN_SHAPING_ALLOWED_TOOLS } from '../plan-shaping/proposed-stages.handler';
import { planShapingRefineStageHandler } from '../plan-shaping/refine-stage.handler';
import { ENTITY_CONVERSATION_ALLOWED_TOOLS } from '../entity-conversation/entity-conversation.handler';
import { featureTreeConversationHandler } from '../feature-tree-conversation/feature-tree-conversation.handler';
import { featureSyncAnalyzeHandler } from '../feature-sync/analyze.handler';
import { planShapingVisualPreviewHandler } from '../plan-shaping/visual-preview.handler';
import { buildVisualPreviewPrompt } from '../plan-shaping/visual-preview.prompt';
import { futureRevisionAuthoring } from './common';
import { buildEntityConversationPrompt } from './entity-conversation';

describe('future-revision tool scoping', () => {
  it('keeps shared implementation and general surfaces read-only for futures', () => {
    for (const tools of [CODING_MCP_TOOLS, GENERAL_MCP_TOOLS]) {
      expect(tools).toContain('get_future_revision');
      expect(tools).not.toContain('propose_future_revision');
    }
  });

  it('gives the read-only planner the explicit read but not authoring', () => {
    expect(CODING_PLAN_SUBAGENT_MCP_ALLOWED_TOOLS).toContain('get_future_revision');
    expect(CODING_PLAN_SUBAGENT_MCP_ALLOWED_TOOLS).not.toContain('propose_future_revision');
    expect(PLANNING_MCP_TOOLS).not.toContain('propose_future_revision');
    expect(RESEARCH_MCP_TOOLS).not.toContain('propose_future_revision');
  });
});

describe('futureRevisionAuthoring', () => {
  it('teaches when to propose a future, its standalone shape, proof, and the explicit read', () => {
    expect(futureRevisionAuthoring).toContain('instead of a live edit');
    expect(futureRevisionAuthoring).toContain('completion dependencies');
    expect(futureRevisionAuthoring).toContain('`authoringRootProof`');
    expect(futureRevisionAuthoring).toContain('The future stands alone');
    expect(futureRevisionAuthoring).not.toMatch(/proposal[- ]group|groupContext/i);
    expect(futureRevisionAuthoring).toContain('`get_future_revision` and its `futureId`');
    expect(futureRevisionAuthoring).toContain('never describe or edit an unselected future');
  });

  it('names every eligible knowledge type and keeps immediate changes ordinary', () => {
    expect(futureRevisionAuthoring).toContain(
      'Feature, Contract, Diagram, Mockup, or Design Doc describes the outcome of implementation work',
    );
    expect(futureRevisionAuthoring).not.toMatch(/task or design[- ]doc/i);
    expect(futureRevisionAuthoring).toContain("implementation task's own instructions");
    expect(futureRevisionAuthoring).toContain('editorial corrections');
    expect(futureRevisionAuthoring).toContain('guidance meant to govern work now');
    expect(futureRevisionAuthoring).toContain('never replaces declaring it as a dependency');
  });

  it('appears in every authoring entry point', () => {
    const prompts = [
      buildEntityConversationPrompt({
        entity: { entityId: 'task-1', entityType: 'TASK', title: 'T' },
        userMessage: 'hey',
      }),
      buildFeatureTreeConversationPrompt({ skeleton: [] }),
      buildAnalyzePrompt({ taskId: 'task-1' }),
      buildAnalyzePrompt({
        taskId: 'task-1',
        launchPlanId: 'plan-1',
        launchStepId: 'step-1',
        launchStageId: 'stage-1',
      }),
      buildAnalyzePrompt({ taskId: 'feature-1', featureSeed: true }),
      buildProposedStagesPrompt({ designDocId: 'dd-1', planId: 'plan-1' }),
      buildRefineStagePrompt({
        planId: 'plan-1',
        stageId: 'stage-1',
        validation: PlanShapingValidationMode.On,
      }),
    ];
    const tools = [
      resolveMcpToolNames({
        useCase: 'general',
        additionalTools: ENTITY_CONVERSATION_ALLOWED_TOOLS,
      }),
      resolveMcpToolNames({
        useCase: 'general',
        additionalTools: featureTreeConversationHandler.additionalAllowedTools ?? [],
      }),
      ...Array.from({ length: 3 }, () =>
        resolveMcpToolNames({
          additionalTools: featureSyncAnalyzeHandler.additionalAllowedTools ?? [],
        }),
      ),
      ...[
        PLAN_SHAPING_ALLOWED_TOOLS,
        planShapingRefineStageHandler.additionalAllowedTools ?? [],
      ].map((additionalTools) => resolveMcpToolNames({ useCase: 'plan_shaping', additionalTools })),
    ];
    prompts.push(
      buildVisualPreviewPrompt({
        designDocId: 'dd-1',
        planId: 'plan-1',
        featureId: 'feature-1',
        refinementRound: 0,
        entries: [],
        acceptedProposalIds: [],
      }),
    );
    tools.push(
      resolveMcpToolNames({
        useCase: 'plan_shaping',
        additionalTools: planShapingVisualPreviewHandler.additionalAllowedTools ?? [],
      }),
    );
    expect(prompts).toHaveLength(tools.length);
    expect(prompts.filter((prompt) => prompt.includes(futureRevisionAuthoring))).toHaveLength(7);
    for (const [index, prompt] of prompts.entries()) {
      expect(tools[index]).toContain('get_future_revision');
      expect(tools[index]?.includes('propose_future_revision')).toBe(
        prompt.includes(futureRevisionAuthoring),
      );
    }
  });
});

describe('plan-shaping review future authoring parity', () => {
  const seed = {
    planId: 'canonical-plan',
    designDocId: 'seed-doc',
    userMessage: '',
    discrepancies: [],
    decisions: [],
  };
  for (const handler of [
    planShapingFeatureSyncAnalyzeHandler,
    planShapingFeatureSyncIterateHandler,
    planShapingFeatureSyncDiscussHandler,
  ]) {
    it(`${handler.id} composes guided authoring with canonical context`, () => {
      const prompt = handler.buildPrompt(seed);
      const tools = resolveMcpToolNames({
        useCase: 'plan_shaping',
        additionalTools: handler.additionalAllowedTools ?? [],
      });
      expect(prompt).toMatchSnapshot();
      expect(prompt).toContain(futureRevisionAuthoring);
      expect(prompt).toContain('Current plan id: canonical-plan');
      expect(prompt).toContain('explicit completion dependency');
      expect(prompt).toContain('same futureId');
      expect(prompt).toContain('Unqualified reads remain live');
      expect(prompt).toContain('planning does not wait for implementation or Apply');
      expect(prompt).toContain('remain ordinary proposals');
      expect(tools).toContain('get_proposal');
      expect(tools).toContain('propose_future_revision');
      expect(tools).toContain('get_future_revision');
    });
  }
  it('keeps exact remediation identity available on revision without a new schema', () => {
    const proposal = 'Refine @[proposal:11111111-1111-4111-8111-111111111111|Upcoming capability]';
    const prompt = planShapingFeatureSyncIterateHandler.buildPrompt({
      ...seed,
      discrepancies: [
        { id: 'fs-1', summary: 'Upcoming capability', rationale: 'Not delivered', proposal },
      ],
    });
    expect(prompt).toContain(proposal);
    expect(planShapingFeatureSyncDiscussHandler.submissionTools).toEqual([]);
  });
});
