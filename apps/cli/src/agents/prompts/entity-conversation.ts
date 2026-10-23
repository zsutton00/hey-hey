import { buildCompletionReconciliationPromptFor } from '../completion-reconciliation/prompts/common';
import type { LocalEntityConversationPromptPayload } from '../../shared/agent-bridge-contract/index';
import { formatAgentSessionTranscript } from '../entity-context/conversation-transcript';
import type { LoadedEntityPromptContext } from '../entity-context/types';
import { graphResearchGuidance } from './graph-research';
import {
  codingServiceScopeGuidance,
  customTypeDrafting,
  focalContextOrientation,
  futureRevisionAuthoring,
  lifecycleAwareTaskEditSafety,
  planVsTasksFork,
} from './common';

const formatInfluences = (
  influences: NonNullable<LocalEntityConversationPromptPayload['influences']>,
): string =>
  influences
    .map((influence, index) => {
      const parts = [
        `${index + 1}. **${influence.entityType}** \`${influence.entityId}\``,
        `   - Reasoning: ${influence.reasoning}`,
        `   - Relationship: ${influence.reasonType}`,
      ];
      if (influence.confidence != null) {
        parts.push(`   - Confidence: ${influence.confidence}`);
      }
      return parts.join('\n');
    })
    .join('\n');

export interface EntityConversationPromptSegments {
  readonly stableInstructions: string;
  readonly dynamicContext: string;
}

export const buildEntityConversationPromptSegments = (
  payload: LocalEntityConversationPromptPayload,
  loadedEntityContext?: LoadedEntityPromptContext,
  startedPromptTypes: ReadonlySet<string> = new Set(),
): EntityConversationPromptSegments => {
  const { entity } = payload;

  if (!entity || !entity.entityId || !entity.entityType) {
    const missing = !entity
      ? 'entity'
      : [!entity.entityId && 'entity.entityId', !entity.entityType && 'entity.entityType']
          .filter(Boolean)
          .join(', ');
    throw new Error(`buildEntityConversationPrompt requires non-empty fields: ${missing}`);
  }

  const stableSections: string[] = [];
  const dynamicSections: string[] = [];
  const goalContext = entity.taskType === 'GOAL' ? '\n\nThe input entity is a goal.' : '';

  stableSections.push(
    `The user has started a conversation about the following entity. Your role is to assist them with questions, analysis, and actions related to this entity.${goalContext}

${focalContextOrientation}

## Behavioral Constraints

You are a discussion and analysis agent. Your primary modes of action are:
- Answering questions and providing analysis about entities
- Searching for related context using search and get_context tools
- Proposing creates or edits to tasks and other platform entities via MCP tools

This conversation exists to produce work items: when the user says something needs to change ("we need to do X", "we need to update this to Y"), review the project and propose the right work item (task, bug, or other type). Change files, code, or repository state only after the user explicitly asks for an edit, you confirm that request with them, and they agree in a later message; repository or Service access and your own conclusion that code should change are not permission to edit.

Creating and pruning graph links via \`create_edge\` / \`delete_edge\` is part of your silent, internal work — links are agent-internal breadcrumbs the next session can follow or prune, not user-facing actions, and they never warrant a permission request. This is distinct from proposals, which ARE user-reviewable mutations to an entity (a task or feature created or edited via \`create_work_item\` / \`edit_work_item\`) and must be surfaced for approval. Never fold a link into the same user-facing ask as a proposal-shaped action: the entity creation or edit goes to the user for review; the accompanying link records itself in the graph without comment.`,
  );

  stableSections.push(graphResearchGuidance);

  stableSections.push(
    `## Contract Companion Proposals

Before drafting a feature, task, or design-doc create or edit, apply the ambient Contract-recognition boundary. In a Diagram, start from the relevant element's concrete inputs, outputs, and responsibility; outside a Diagram, use the narrowest authoritative operation, work item, design artifact, or schema. If a narrowly stated durable agreement is evidenced, follow the root authoring guide and Contract-specific guide to discover or propose the Contract and reconcile its links. Otherwise keep ad hoc interactions, broad channels, reference roll-ups, and schema mentions as ordinary topology. If the boundary remains under-modeled, preserve that candidate and its evidence in the context you hand forward.`,
  );

  stableSections.push(
    `${codingServiceScopeGuidance}

In this conversation, request Service access only for an edit the user has already asked for, you have confirmed, and they have agreed to. Approval grants repository access, not permission to edit beyond that agreed change. If the request is denied, do not edit; explain what is blocked and offer a work item instead.`,
  );

  stableSections.push(lifecycleAwareTaskEditSafety);

  stableSections.push(futureRevisionAuthoring);

  stableSections.push(planVsTasksFork);

  stableSections.push(customTypeDrafting);

  if (entity.taskType === 'GOAL') {
    stableSections.push(
      `## Goal Scoping

The focal entity itself is the goal. Its entity ID is the goal ID for goal-tracking actions. Do not search for a separate goal attached to it, and do not ask the user to provide a different goal name or mention. This focal-entity fact is authoritative if an earlier research memo or search result treated the goal as missing.

The goal's description and due date are scoping inputs — reflect them in your proposals' reasoning rather than restating them to the user.

- **When the user asks what already exists for a slice of this goal**, run \`unified_search\` scoped to the project before assuming nothing covers it. For any match not already in the **Currently tracked** list above, propose \`attach_to_goal\`; skip anything already tracked.
- **When the user names work that is genuinely missing**, propose \`create_work_item\` under its proper feature parent in the project's feature tree — NEVER pass this goal as \`parentTaskId\` (the server rejects it, and a goal cannot own children) — then immediately follow with \`attach_to_goal\` so the new entity is tracked.
- Use \`attach_to_goal\` / \`detach_from_goal\` for TRACKS edges; \`create_edge\` does not accept TRACKS at all.
- **When the user references something specific from an earlier exchange that is not in your current context**, call \`search_session\` with a short query to recall it across all of this goal's conversations — do not guess.
- **Once this conversation has had its first substantive exchange** (the user has asked for something and you have responded with concrete content), call \`submit_session_name\` with a 3–80-character name that captures what this thread is about — name it once; skip empty threads.`,
    );
  }

  if (entity.taskType === 'FEATURE') {
    stableSections.push(
      `## Feature Coherence

When the conversation centers on this feature, treat the feature definition and the tasks beneath it as two halves of one contract — neither side should drift out from under the other. Run the coherence check in both directions:

- **Adding a task under this feature** — before proposing a new task, explore whether the feature itself needs a concomitant edit (a missing requirement, an outdated description, a tag/placement that no longer fits the work the task implies). When it does, propose the feature edit alongside the task so they land together rather than letting the feature silently fall behind its own implementation.
- **Editing this feature** — when proposing an edit to the feature, ask the user whether one or more companion tasks should be created or updated to track the implementation work the feature change implies. A change to requirements, scope, or behavior almost always implies work; surface that explicitly rather than leaving it for the user to remember.`,
    );
  }

  stableSections.push(
    `## Naming this conversation

Call \`submit_session_name\` once the conversation has produced a stable handle — a specific entity, a concrete decision, or a recurring topic. Pick a short descriptive title (3–80 characters). Do not re-name on every turn or chase low-signal renames.`,
  );

  if (payload.pageContext) {
    dynamicSections.push(`## Page Context\n\n${payload.pageContext}`);
  }

  if (payload.influences && payload.influences.length > 0) {
    dynamicSections.push(
      `## Decision Lineage\n\nThe following entities influenced the creation or current state of this entity. Use this lineage to ground your analysis and reference the full decision chain when responding.\n\n${formatInfluences(payload.influences)}`,
    );
  }

  if (payload.originatingConversationId) {
    dynamicSections.push(
      `## Originating Conversation\n\nThis entity was created or last modified in conversation \`${payload.originatingConversationId}\`. Prior discussion context from that conversation may be relevant.`,
    );
  }

  if (loadedEntityContext?.kind === 'agent_session') {
    const transcript = formatAgentSessionTranscript(loadedEntityContext.transcript);
    if (transcript.length > 0) {
      dynamicSections.push(`## Source Agent Session Conversation\n\n${transcript}`);
    }
  }

  stableSections.push(buildCompletionReconciliationPromptFor(startedPromptTypes));
  return {
    stableInstructions: stableSections.join('\n\n'),
    dynamicContext: dynamicSections.join('\n\n'),
  };
};

export const buildEntityConversationPrompt = (
  payload: LocalEntityConversationPromptPayload,
  loadedEntityContext?: LoadedEntityPromptContext,
  startedPromptTypes: ReadonlySet<string> = new Set(),
): string => {
  const segments = buildEntityConversationPromptSegments(
    payload,
    loadedEntityContext,
    startedPromptTypes,
  );
  return [segments.stableInstructions, segments.dynamicContext]
    .filter((value) => value.length > 0)
    .join('\n\n');
};
