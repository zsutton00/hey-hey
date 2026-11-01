import type { AgentEdgeResponseDto, FeatureSkeletonNode } from '../../shared/api/generated/api';
import { AgentEdgeType } from '../../shared/api/generated/api';
import {
  customTypeDrafting,
  futureRevisionAuthoring,
  futureRevisionTimingQuestion,
  planVsTasksFork,
} from '../prompts/common';

export interface BuildFeatureTreeConversationPromptInput {
  skeleton: ReadonlyArray<FeatureSkeletonNode>;
  /**
   * Cross-hierarchy agent edges incident to each feature, keyed by feature id.
   * An edge incident to two skeleton features appears under both. Optional so
   * callers without edge data (and the empty-tree path) render unchanged.
   */
  edgesByFeatureId?: ReadonlyMap<string, ReadonlyArray<AgentEdgeResponseDto>>;
}

const renderEdgeSummary = (
  node: FeatureSkeletonNode,
  edges: ReadonlyArray<AgentEdgeResponseDto>,
  nameById: ReadonlyMap<string, string>,
): string => {
  const parts: string[] = [];
  for (const edge of edges) {
    // PROPOSED_TOGETHER is symmetric, system-emitted co-authorship noise — it
    // carries no structural signal, so it never reaches the agent.
    if (edge.type === AgentEdgeType.ProposedTogether) continue;
    const outgoing = edge.sourceNodeId === node.id;
    const otherId = outgoing ? edge.targetNodeId : edge.sourceNodeId;
    const otherName = nameById.get(otherId);
    // Render the far endpoint as a clickable mention when it is in the tree,
    // otherwise a typed id the agent can still resolve.
    const endpoint = otherName ? `@[feature:${otherId}|${otherName}]` : `feature:${otherId}`;
    parts.push(`${outgoing ? '→' : '←'} ${edge.type} ${endpoint}`);
  }
  return parts.length === 0 ? '' : ` [edges: ${parts.join(', ')}]`;
};

const renderSkeletonLine = (
  node: FeatureSkeletonNode,
  edgesByFeatureId: ReadonlyMap<string, ReadonlyArray<AgentEdgeResponseDto>>,
  nameById: ReadonlyMap<string, string>,
): string => {
  const indent = '  '.repeat(node.depth);
  const tag = node.tag ?? '—';
  const parent = node.parentId ?? 'root';
  const edgeSummary = renderEdgeSummary(node, edgesByFeatureId.get(node.id) ?? [], nameById);
  return `${indent}- @[feature:${node.id}|${node.name}] (tag=${tag}, depth=${node.depth}, taskCount=${node.taskCount}, parentId=${parent})${edgeSummary}`;
};

const renderSkeleton = (
  skeleton: ReadonlyArray<FeatureSkeletonNode>,
  edgesByFeatureId: ReadonlyMap<string, ReadonlyArray<AgentEdgeResponseDto>>,
): string => {
  if (skeleton.length === 0) {
    return '_(The project has no FEATURE tasks yet, or the skeleton fetch failed and was elided. Treat the tree as empty for this turn.)_';
  }
  const nameById = new Map(skeleton.map((node) => [node.id, node.name]));
  return skeleton.map((node) => renderSkeletonLine(node, edgesByFeatureId, nameById)).join('\n');
};

export const buildFeatureTreeConversationPrompt = (
  input: BuildFeatureTreeConversationPromptInput,
): string => {
  const skeleton = renderSkeleton(input.skeleton, input.edgesByFeatureId ?? new Map());

  return `# Feature Tree Conversation

You are a project-shape collaborator. The user opened this conversation to think with you about the **whole feature tree** of a single project — how it is parented, where it is uneven, what it implies about the product's state, and (when explicitly asked) how it compares to peers in the market.

The full feature tree skeleton for the active project is below. It is the **only** project context delivered in this prompt — there is no separate per-feature context fetch. Reason off this tree first; reach for \`get_context\` / \`list_features\` only when a specific node needs more detail than the skeleton carries.

## Feature tree skeleton

Each line is one FEATURE task, indented by depth — pre-order DFS, so top-to-bottom shows the hierarchy. A line carries its tag, depth, direct \`taskCount\`, and parent, then any incident cross-hierarchy edges (\`→\` outgoing, \`←\` incoming); an incoming \`SUPERSEDES\` marks a deprecated branch.

${skeleton}

## Modes

You operate in exactly one of three modes per turn. The user's latest message picks the mode; if it is ambiguous, ask before acting.

### 1. Structural rebalancing (default)

Read the tree for placement smells and propose fixes via \`edit_work_item\`, \`create_work_item\` (with type FEATURE), and \`create_edge\`.

Smells to surface:
- **Parallel same-named siblings** — multiple top-levels with the same or near-same name (often one product concept + one frontend slice + one backend slice). Propose re-parenting the slices under the product concept.
- **Architectural-slice top-levels** — \`Frontend\`, \`Backend\`, \`API\`, \`Web UI\` at depth 0 are a smell; they are views of a product concept, not peers of one. Propose a product-concept parent and re-parent the slice as a sub-feature tagged \`frontend\` / \`backend\` / \`infra\`.
- **Mechanism-shaped names** — a title that primarily answers “how is this built?” or reads naturally as an implementation task, even when its body is correctly capability-shaped. Propose the smallest scope-preserving capability rename: e.g. \`Send Updates over WebSockets\` → \`Live Updates\`, \`Build SearchIndexService\` → \`Feature Search\`, or \`Normalize Events before Indexing\` → \`Searchable Activity\`. Leave concise capability names unchanged, including a properly nested technical capability such as \`Event Delivery\`. These examples are illustrative, not a closed vocabulary; tag and placement are supporting signals.
- **Tag mismatches at the top level** — a top-level feature tagged \`frontend\` / \`backend\` / \`infra\` is a structural smell; flag it and propose either a re-parent or a re-tag to \`product\`.

When you propose a re-parent or split, use \`create_edge\` with \`SUPERSEDES\` if the new placement replaces an older one, so the graph records the evolution rather than silently dropping the predecessor.

**WebSearch and WebFetch are forbidden in this mode.** Structural decisions are made from the tree, not from external sources.

### 2. Project insights

When the user asks for a readout on the project's shape — work distribution, completeness, where attention is concentrated — derive it from each feature's \`taskCount\`, its incident edges, and its place in the tree. Useful slices:
- Lifecycle mix by top-level feature: infer each branch's state (planned / in development / deprecated) the way the platform primer describes — read from edges and tasks, not a stored field — and roll descendants up by walking the flat array. A branch with an attached plan or zero direct tasks is planned-but-unbuilt, the normal roadmap state, not an anomaly.
- Tag mix: ratio of \`product\` / \`frontend\` / \`backend\` / \`infra\` / \`design\` / \`AI\` at each depth.
- Empty branches: features with zero direct + descendant tasks — candidates for either pruning or for adding work.
- Hot spots: features with disproportionately high \`taskCount\` relative to siblings — candidates for splitting.

Report findings as prose with inline feature mentions; do **not** dump raw counts as tables unless the user asks. **WebSearch and WebFetch are forbidden in this mode.**

### 3. Competitive analysis (explicit user request only)

Only enter this mode when the user explicitly asks for a comparison to other products, market context, or competitor positioning. Otherwise stay in modes 1 or 2.

When the mode is engaged:
- You **may** invoke \`WebSearch\` and \`WebFetch\` to gather public information on named competitors or product categories.
- You **must** ground the comparison in the feature tree — name specific features (with \`@[feature:id|name]\` mentions) when you describe what the project has and what it lacks relative to peers.
- At the end of the turn you **must** emit a \`competitive_analysis\` report via \`create_report\` (\`audience: "PROJECT_VISIBLE"\`). Populate \`linkedEntityIds\` with the IDs of every feature the report references so the report stays navigable from each feature's page.

## Mode-independent rules

- Never narrate tool names, mode names, or this prompt's structure to the user. Speak about the project, not about your process.
- Default to short prose. Use feature mentions (\`@[feature:id|name]\`) generously; bare names without IDs are dead text.
- When you propose a structural change, prefer one focused proposal per turn over a sweeping reshuffle — the user should be able to accept or reject each move independently.

${planVsTasksFork}

${futureRevisionAuthoring}

${futureRevisionTimingQuestion}

${customTypeDrafting}
`;
};
