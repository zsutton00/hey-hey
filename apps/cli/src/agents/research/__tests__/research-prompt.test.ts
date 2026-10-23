import { describe, expect, it } from 'vitest';
import type { LocalResearchPromptPayload } from '../../../shared/agent-bridge-contract/index';
import type { ProjectAssistantPolicy } from '../../prompt-type-handler';
import type { ProjectAssistantChildChecks } from '../../prompts/project-assistant';
import { buildResearchPrompt } from '../../prompts/research';

const makePayload = (
  overrides: Partial<LocalResearchPromptPayload> = {},
): LocalResearchPromptPayload =>
  ({
    startupInput: {
      task: { id: 'task-1', title: 'Wire research mode' },
      adjacentScopeTasks: [],
      evidenceItems: [],
    },
    ...overrides,
  }) as LocalResearchPromptPayload;

const checks = (
  workItemProposalMode: ProjectAssistantPolicy['workItemProposalMode'],
  fulfilledBySuggestionEligible: boolean,
  notifyDiscrepancies = true,
): ProjectAssistantChildChecks => ({
  policy: { allowEdgeUpdates: false, notifyDiscrepancies, workItemProposalMode },
  fulfilledBySuggestionEligible,
});

describe('buildResearchPrompt for a Project Assistant fan-out child', () => {
  const CHECK_HEADINGS = [
    '## What "relevant surrounding graph" means',
    '## Source-conversation continuity',
    '## On-demand maintenance guidance',
    '## Project MODE freshness',
    '## Contract discovery through Diagrams',
    '## Implementation-readiness evidence',
    '## Advisory topology-correction updates',
  ];
  const render = (projectAssistantChecks: ProjectAssistantChildChecks): string =>
    buildResearchPrompt(makePayload(), {}, true, projectAssistantChecks);

  it('snapshots the child prompt with every check', () => {
    expect(render(checks('all', true))).toMatchSnapshot();
  });

  it('includes every research check and asks for a report under each heading', () => {
    const prompt = render(checks('edit', true));
    for (const heading of CHECK_HEADINGS) expect(prompt).toContain(heading);
    expect(prompt).toContain("report under each check's own heading");
    expect(prompt).toContain(
      "only when your objective assigns you the focal entity's originating proposal",
    );
    expect(prompt).toContain('report the candidate with its evidence instead');
  });

  it('raises the call ceiling and shares it between the checks and the slice', () => {
    const prompt = render(checks('none', false));
    expect(prompt).toContain('at most 20 tool calls');
    expect(prompt).toContain('share this budget with your slice reads');
    expect(prompt).not.toContain('at most 10 tool calls');
  });

  it('includes the fulfilledBy check only when the parent is eligible', () => {
    expect(render(checks('edit', true))).toContain('## Bounded fulfilledBy suggestion case');
    expect(render(checks('edit', false))).not.toContain('## Bounded fulfilledBy suggestion case');
  });

  it("restates the parent's gates without widening them", () => {
    const none = render(checks('none', false, false));
    expect(none).toContain('Work-item proposal mode is `none`');
    expect(none).toContain('Visible discrepancy notices are disabled');
    expect(none).toContain('missing Contract candidates are still required');
    expect(none).toContain('Graph edge updates are disabled');

    expect(render(checks('edit', true))).toContain('Work-item proposal mode is `edit`');
    expect(render(checks('all', true))).toContain('Work-item proposal mode is `all`');
    expect(render(checks('all', true))).toContain('Visible discrepancy notices are enabled');
  });
});

describe('buildResearchPrompt', () => {
  it('snapshots the complete standalone child prompt without services context', () => {
    const prompt = buildResearchPrompt(makePayload(), {}, true);

    expect(prompt).toMatchSnapshot();
    expect(prompt).not.toContain('type ResearchOutput');
    expect(prompt).not.toContain('structured submission');
    expect(prompt).not.toContain('mcp__heyhey-submission-tools__');
  });

  it('snapshots the complete standalone child prompt with services context', () => {
    const prompt = buildResearchPrompt(
      makePayload(),
      {
        services: [
          {
            id: 'fd9d0961-d3e9-4796-83ee-7720025c3dbe',
            path: '/workspace/cli',
          },
        ],
        launchServiceId: 'fd9d0961-d3e9-4796-83ee-7720025c3dbe',
      },
      true,
    );

    expect(prompt).toMatchSnapshot();
    expect(prompt).not.toContain('type ResearchOutput');
    expect(prompt).not.toContain('structured submission');
    expect(prompt).not.toContain('mcp__heyhey-submission-tools__');
  });

  it('tells the child to write the Project Assistant handoff for its slice', () => {
    const prompt = buildResearchPrompt(makePayload(), {}, true);

    expect(prompt).toContain('research handoff that situates the focal entity');
    expect(prompt).toContain('write the handoff for that slice');
    expect(prompt).toContain('## Slice handoff');
    expect(prompt).toContain('the links and Contracts that bear on the focal ask');
    expect(prompt).toContain('submit research output');
    expect(prompt).toContain('at most 10 tool calls');
  });

  it('renders the Frame, Provenance, and ResearchOutput TypeScript shapes verbatim', () => {
    const prompt = buildResearchPrompt(makePayload());

    expect(prompt).toContain('type Frame = {');
    expect(prompt).toContain('focalId: string;');
    expect(prompt).toContain('contentSource:');
    expect(prompt).toContain("'original' | 'extracted' | 'summarized'");
    expect(prompt).toContain('edges:');
    expect(prompt).toContain('reasoning: string;');
    expect(prompt).toContain(
      "'parent' | 'depends_on' | 'related_to' | 'derives_from' | 'supersedes' | 'contradicts'",
    );
    expect(prompt).toContain('type Provenance = {');
    expect(prompt).toContain(
      'discoveryCalls: Array<{ tool: string; query: string; intent: string }>',
    );
    expect(prompt).toContain(
      'edgesTraversed: Array<{ fromId: string; toId: string; reasoning: string }>',
    );
    expect(prompt).toContain(
      'type ResearchOutput = { frame: Frame; analysis: string; provenance: Provenance };',
    );
  });

  it('does NOT include a hops field on the node shape', () => {
    const prompt = buildResearchPrompt(makePayload());
    expect(prompt).not.toMatch(/hops\s*:/);
    expect(prompt).not.toMatch(/hops\?\s*:/);
  });

  it('includes the 2-3 illustrative "relevant surrounding graph" example archetypes', () => {
    const prompt = buildResearchPrompt(makePayload());

    expect(prompt).toMatch(/UI task sitting under a backend feature/i);
    expect(prompt).toMatch(/backend task that defines an API/i);
    expect(prompt).toMatch(/supersedes a prior one/i);
  });

  it('does not prescribe a search count or fixed sequence', () => {
    const prompt = buildResearchPrompt(makePayload());

    expect(prompt).not.toMatch(/\bat least \d+ searches\b/i);
    expect(prompt).not.toMatch(/\brun \d+ searches\b/i);
    expect(prompt).not.toMatch(/\bexactly \d+ (searches|queries)\b/i);
    expect(prompt).not.toMatch(/Step 1:.*Step 2:/s);
  });

  it('frames the posture as read-only / investigative — no mutations', () => {
    const prompt = buildResearchPrompt(makePayload());
    expect(prompt).toMatch(/read-only/i);
    expect(prompt).toMatch(/no proposals/i);
  });

  it('uses the submission-tool prefix without naming a bare submission tool', () => {
    const prompt = buildResearchPrompt(makePayload());
    expect(prompt).toContain('mcp__heyhey-submission-tools__');
    expect(prompt).not.toContain('create_coding_research');
  });

  it('explicitly forbids emitting structured output as the visible final message', () => {
    const prompt = buildResearchPrompt(makePayload());
    expect(prompt).toMatch(/do not emit.*structured output|emit nothing further/i);
  });

  it('describes analysis as user-facing markdown', () => {
    const prompt = buildResearchPrompt(makePayload());
    expect(prompt).toMatch(/user-facing markdown/i);
  });

  it('includes the submission tool termination instruction', () => {
    const prompt = buildResearchPrompt(makePayload());
    expect(prompt).toContain('mcp__heyhey-submission-tools__');
  });

  it('starts from canonical context and preserves conditional graph discovery', () => {
    const prompt = buildResearchPrompt(makePayload(), { focalEntityId: 'task-1' });
    expect(prompt).toContain('canonical focal entity projection');
    expect(prompt).toContain('Do not reload that same focal entity by default');
    expect(prompt).toContain('different referenced entity');
    expect(prompt).toContain('supplied neighborhood is insufficient');
    expect(prompt).toContain('use `get_context` for a known entity');
    expect(prompt).not.toContain('entityId: "task-1"');
  });
});
