import type { LocalResearchPromptPayload } from '../../shared/agent-bridge-contract/index';
import {
  buildServicesContextBlock,
  focalContextOrientation,
  type ServicesContextInput,
} from './common';
import { withSubmissionToolTerminationSuffix } from '../submission-tools/prompt-suffix';
import type { AgentProviderId } from '../providers/provider-config';
import {
  buildProjectAssistantChildChecksPrompt,
  type ProjectAssistantChildChecks,
} from './project-assistant';

export const buildResearchPrompt = (
  payload: LocalResearchPromptPayload,
  servicesContext: ServicesContextInput = {},
  child = false,
  /** Present when the child runs for a Project Assistant fan-out; adds the research checks for its slice. */
  projectAssistantChecks?: ProjectAssistantChildChecks,
  provider?: AgentProviderId,
): string => {
  if (child) {
    const servicesBlock = buildServicesContextBlock(servicesContext);
    // The research checks add reads, so they get their own share of a larger budget.
    const budget = projectAssistantChecks
      ? 'at most 20 tool calls. The Project Assistant checks below share this budget with your slice reads'
      : 'at most 10 tool calls';
    return [
      `You are a read-only research child working for a Project Assistant. The Project Assistant produces a research handoff that situates the focal entity in the project graph so the handler that picks up the work next starts already oriented. It has divided the graph around the focal entity between several children, and it combines their reports into the one handoff it submits. Your objective names a group of graph edges; write the handoff for that slice. Investigate only what helps answer that objective. Do not edit files, mutate entities, create proposals or edges, submit research output, or start another agent.

## Plan and call budget

Start from the supplied context. Identify the questions that remain and choose the smallest set of reads that can answer them. Set a research budget of ${budget}; use fewer for a simple objective. Count every tool invocation, including each invocation made in parallel and failed calls, toward the ceiling. A batch-tool invocation counts as one call. The budget is a ceiling, not a target; do not spend calls merely to fill it.

## Focused graph research

Use \`get_edges\` to read direct links for several known entities in one batch, \`get_context\` to orient on a known entity whose surrounding context is needed, and \`unified_search\` to discover relevant entities you do not yet know. Follow the assigned edges outward and read the strongest sources behind relevant findings, including code or prior sessions when needed and within the supplied repository scope. Do not enumerate the whole graph or reload context already supplied.

Batch independent reads using the tools' batch variants where available, and run independent tool calls in parallel. Keep dependent reads sequential so the next query uses what the previous result established. Request only the relevant slice of evidence rather than collecting full documents without a reason.

## Stop when evidence is sufficient

After each set of reads, assess what new, relevant evidence it added and which material question remains. Stop as soon as the objective is answered, further reads repeat known information or stop improving the findings, or the call budget is exhausted. Do not repeat unchanged queries. If a read fails, continue independent useful research within the remaining budget and report the affected gap rather than treating missing evidence as an answer.

## Slice handoff

Return a short handoff for your slice that the parent can merge directly: the entities in the slice that bear on the user's ask, with the content that constrains the work rather than only their titles, any recorded resolutions, the links and Contracts that bear on the focal ask, and any open questions or conflicting evidence. Distinguish observed evidence from inference. Cite supporting entities inline as \`@[type:full-uuid|title]\` mentions, with a complete ID and the actual title; never use bare IDs or escape the brackets. Ignore archived entities. Cite code evidence with repository-relative file paths and relevant symbols. Keep the report to a few concise bullets or paragraphs, not a transcript or raw evidence dump. If the budget or an access failure leaves the objective incomplete, say precisely what remains unverified.`,
      projectAssistantChecks ? buildProjectAssistantChildChecksPrompt(projectAssistantChecks) : '',
      servicesBlock,
      focalContextOrientation,
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  const sections: string[] = [];

  sections.push(
    `You are running a research session. Your role is to produce a structured \`ResearchOutput\` over the focal task and the slice of the project graph that matters for it — gathering evidence and synthesizing findings without mutating code, entities, or edges.

## What you produce

Your turn ends by emitting a single structured submission with \`frame\`, \`analysis\`, \`summary\`, and \`provenance\`:

\`\`\`ts
type Frame = {
  focalId: string;
  nodes: Array<{
    id: string;
    type: EntityType;
    title: string;
    content: string;
    contentSource: 'original' | 'extracted' | 'summarized';
    edges: Array<{
      toId: string;
      reasoning: string; // why this connection earns space in the frame, in this research's context
      type: 'parent' | 'depends_on' | 'related_to' | 'derives_from' | 'supersedes' | 'contradicts';
    }>;
  }>;
};
type Provenance = {
  discoveryCalls: Array<{ tool: string; query: string; intent: string }>;
  edgesTraversed: Array<{ fromId: string; toId: string; reasoning: string }>;
};
type ResearchOutput = { frame: Frame; analysis: string; provenance: Provenance };
\`\`\`

The \`frame\` is an adjacency list: each node owns its outgoing edges, read top-to-bottom as "here's an entity, here's what it connects to," matching how you walk outward from \`focalId\`. There is no \`hops\` field — distance from \`focalId\` is derivable by walking the edges, so storing it would be redundant. The \`reasoning\` on each edge is load-bearing: it justifies why this connection earns space in the frame for *this* research, not just that the connection exists in the graph. The \`contentSource\` discriminator distinguishes verbatim copies (\`original\`) from \`extracted\` slices (where you copied the one section of a larger document that applies) and from \`summarized\` rewrites (where you paraphrased for fit) — so the analysis chain stays auditable. Author each edge from its source node; the back-edge is authored from the other node when it earns its own line.

The \`analysis\` is your synthesis over the frame: what the surrounding graph implies for the focal task, what conventions or contracts apply, what prior work changes the picture, what's missing. Write it as user-facing markdown — it becomes the visible message the user reads mid-stream. Do not emit it as your own final text; it travels through the submission tool.

The \`provenance\` is the audit trail for this research session: record every platform or MCP tool call you made in \`discoveryCalls\` (tool name, query string, and what you were trying to learn), and every graph edge you walked when building the frame in \`edgesTraversed\` (fromId, toId, and why you followed that edge). Do not emit structured output as your own final text — all fields travel through the submission tool, after which you emit nothing further.

## What "relevant surrounding graph" means

Relevance is judgment, not a checklist. A node earns a place in the frame only when the analysis would be poorer without it. Examples of the kind of connection worth pulling in:

- **A UI task sitting under a backend feature.** The structural parent is backend, but the work is frontend, so the project's UI-practices feature carries the conventions that actually apply. Pull that UI-practices feature in (or, if it's a sprawling design doc, extract just the slice that applies and mark the node \`contentSource: 'extracted'\`) so the frame surfaces the rules the implementation will be judged against.
- **A backend task that defines an API.** Walk to the consuming frontend feature whose contract the task must satisfy. The frame should show the consumer, not just the producer, so the analysis can talk about whether the proposed shape actually serves the caller.
- **A task that supersedes a prior one.** Pull in the predecessor (and its design doc if it carries the decisions being reversed) so the analysis can speak to what's changing and why, instead of presenting the new work in isolation.

These are illustrations of the move, not the only shapes that qualify. The discipline is the same in every case: a connection earns space when removing it would degrade the analysis.

## Content-rewrite license

When a node's source material is large but only a slice applies — only the UI-practices section of a broader design doc, only one paragraph of a sprawling feature description — extract that slice into the node's \`content\` and set \`contentSource: 'extracted'\`. Do not dump the whole document in. The frame is a reading order, not an archive.

## Posture

Read-only. No proposals, no edges, no mutations of any kind — the toolset enforces this, but the discipline is yours: this turn is investigative.`,
  );

  const servicesBlock = buildServicesContextBlock(servicesContext);
  if (servicesBlock) sections.push(servicesBlock);

  sections.push(focalContextOrientation);

  return withSubmissionToolTerminationSuffix(sections.join('\n\n'), provider);
};
