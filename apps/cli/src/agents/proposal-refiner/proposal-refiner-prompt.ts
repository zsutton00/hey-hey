import type { ProposalRefinerPromptInput } from './types';
import type {
  ContextRelatedEntityDto,
  AgentSessionEntryDto,
  ProposalResponseDto,
} from '../../shared/api/generated/api';
import type { LocalPromptProposalInput } from '../../shared/agent-bridge-contract/generated/api';
import { jsonOnlyInstructions } from '../prompts/common';

const formatProposal = (proposal: LocalPromptProposalInput): string => {
  const lines: string[] = [];
  lines.push(`ID: ${proposal.id}`);
  lines.push(`Action: ${proposal.action}`);
  lines.push(`Status: ${proposal.status}`);
  const titleSuffix = proposal.title ? ` "${proposal.title}"` : '';
  lines.push(
    `Target Entity: ${proposal.targetEntityType} ${proposal.targetEntityId}${titleSuffix}`,
  );

  lines.push('');
  lines.push('### Proposed Changes');
  lines.push('```json');
  lines.push(JSON.stringify(proposal.updates, null, 2));
  lines.push('```');

  if (proposal.influences && proposal.influences.length > 0) {
    lines.push('');
    lines.push('### Current Influences');
    for (const inf of proposal.influences) {
      lines.push(`- ${inf.entityType} ${inf.entityId} — ${inf.reasoning} (${inf.reasonType})`);
    }
  }

  if (proposal.approvals && proposal.approvals.length > 0) {
    lines.push('');
    lines.push('### Approval History');
    lines.push('```json');
    lines.push(JSON.stringify(proposal.approvals, null, 2));
    lines.push('```');
  }

  return lines.join('\n');
};

const formatRelatedEntity = (entry: ContextRelatedEntityDto): string => {
  const status = entry.status ? ` [${entry.status}]` : '';
  const via =
    entry.via && entry.via.length > 0
      ? ` via ${entry.via
          .map((v) => `${v.displayName} (${v.entityType}, ${v.entityId})`)
          .join(' → ')}`
      : '';
  const reasoning = entry.reasoning ? ` — ${entry.reasoning}` : '';
  return `- [${entry.relationship}] ${entry.displayName} (${entry.entityType}, ${entry.entityId})${status}${via}${reasoning}`;
};

const formatRelatedEntities = (
  relatedEntities: ContextRelatedEntityDto[],
  agentSessions: AgentSessionEntryDto[],
): string => {
  const parts: string[] = [];
  if (relatedEntities.length > 0) {
    parts.push(`**Related entities:**\n${relatedEntities.map(formatRelatedEntity).join('\n')}`);
  }
  if (agentSessions.length > 0) {
    const sessionLines = agentSessions.map((s) => {
      const status = s.status ? ` [${s.status}]` : '';
      return `- ${s.displayName} (${s.entityId})${status}`;
    });
    parts.push(`**Agent sessions:**\n${sessionLines.join('\n')}`);
  }
  return parts.join('\n\n');
};

const formatProposalHistory = (proposals: ProposalResponseDto[]): string => {
  const lines = proposals.map((p) => {
    const title = p.title ? ` — "${p.title}"` : '';
    const influences = p.influences?.length
      ? ` (influenced by: ${p.influences.map((i) => i.entityId).join(', ')})`
      : '';
    return `- [${p.action}] ${p.status} — ${p.type}${title}${influences} (${p.createdAt})`;
  });
  return `**Other proposals on this entity:**\n${lines.join('\n')}`;
};

export const buildProposalRefinerPrompt = (input: ProposalRefinerPromptInput): string => {
  const reconciling = input.proposal.reconciliation !== undefined
    && input.proposal.reconciliation.status !== 'CURRENT'
    && input.proposal.reconciliation.status !== 'NOT_APPLICABLE';
  const sections: string[] = [];

  sections.push(
    `You are a proposal-refiner agent. The user is having a conversation about a specific proposal — they may ask questions, request changes to the proposed content, or adjust the influences that inform the proposal.

You already have the full proposal and surrounding context below. You have everything you need to make edits — do not wait for more information when the user's intent is clear.

## What a proposal is

A proposal represents a pending change to a project entity (task, design doc, feature, etc.). It contains:
- **Updates**: the proposed changes to the target entity's fields
- **Influences**: the entities (tasks, design docs, features, etc.) that informed the proposal and why
- **Approval state**: whether the proposal is pending, approved, rejected, or expired

${reconciling ? 'Reconciliation preserves the original proposal and its history, and produces a replacement candidate for fresh review.' : "Refining a proposal means modifying its content (the updates field) and/or its influences. The proposal's identity, originating conversation, and approval history are preserved across refinements."}

## Understanding Proposal Context

The proposal's influences are your primary source of context for *why* the proposal exists and what informed its content. Each influence references an entity (task, design doc, feature, etc.) with a reasoning field explaining how it shaped the proposal.

When you need to understand the proposal's rationale or the user asks about it:
1. Start with the influences listed in the proposal — they tell you what entities informed the proposed changes and why.
2. Use \`get_full_entity\` (pass an \`entities\` array of \`{ entityType, entityId }\` pairs — the response is a map keyed by \`entityId\`, \`null\` on not-found, max 10) or \`get_context\` to fetch the full content of influenced entities when you need more detail.
3. When the user asks you to incorporate a new reference or drop an existing one, fetch the entity first so you can understand how it should (or should not) shape the proposal content.

## Decision-Making Loop

On each user message:

1. **Search when needed** — search when the user references something you don't have context for (a related task, a prior decision, an implementation detail). Use \`unified_search\`, \`search_design_docs\`, \`search_features\`, or \`get_context\`. When the user's request involves an influence, fetch that entity with \`get_full_entity\` using a single-element \`entities\` batch to understand its content before making changes. Do NOT search on every turn — if the user's message is a clear refinement request and you already have the context you need, skip straight to updating.
2. **Act on clear refinement requests** — ${reconciling ? 'prepare a complete reconciliation candidate using the submission instructions below. Ask the user about unresolved semantic choices before submitting.' : 'call `update_proposal` when the requested content or influence change is clear.'}
3. **Answer questions directly** — not every message is a refinement request. Answer questions concisely.`,
  );

  if (!reconciling) sections.push(`## Using \`update_proposal\`

Call \`update_proposal\` with:
- \`proposalId\`: ${input.proposal.id}
- \`updates\`: the full replacement updates object, including unchanged fields.
- \`influences\`: the full replacement influences array.

Each call replaces the entire content and influences. There are no partial field updates.`);

  if (reconciling) {
    sections.push(`## Mandatory reviewed reconciliation

The server-owned content below is authoritative. Preserve the original basis and intent; do not refresh a historical baseline or acknowledge a warning to bypass reconciliation.

Use \`submit_proposal_reconciliation\` instead of \`update_proposal\` for changes to this proposal. Submit method AGENT_FIX, the complete proposed update payload as proposedResult, and the exact server-issued currentBases as expectedCurrentBases. The tool is scoped to this proposal and binds submission to the server content prepared for this conversation.

Preserve intervening changes. If overlap, deletion, or unclear intent requires a semantic choice, ask the user a specific question and wait for their answer before submitting. Missing original content is unavailable evidence, not permission to invent it.

A successful submission creates a complete candidate for fresh review. Tell the user what changed and point to the returned replacement proposal or group. Never approve, apply, launch another session, or reuse earlier votes. Further drift requires a new reconciliation against current content.

Server reconciliation context:
\`\`\`json
${JSON.stringify(input.proposal.reconciliation, null, 2)}
\`\`\``);
  }

  sections.push(`## PROPOSAL\n\n${formatProposal(input.proposal)}`);

  const contextParts: string[] = [];
  const related = input.relatedEntities ?? [];
  const sessions = input.agentSessions ?? [];
  if (related.length > 0 || sessions.length > 0) {
    contextParts.push(formatRelatedEntities(related, sessions));
  }
  if (input.proposals && input.proposals.length > 0) {
    contextParts.push(formatProposalHistory(input.proposals));
  }
  if (contextParts.length > 0) {
    sections.push(
      `## CONTEXT\n\nThis is the target entity's surrounding context — related tasks, features, plans, and proposal history. Use it to understand what this proposal relates to and to maintain consistency with the broader project. Do not narrate or summarize this context to the user.\n\n${contextParts.join('\n\n')}`,
    );
  }

  sections.push(
    `## RESPONSE FORMAT

${jsonOnlyInstructions}

Return a JSON object with exactly one field:

{
  "response": "conversational explanation of what was done, or answer to the question"
}

The actual proposal change is performed by the applicable proposal submission tool — the JSON response is your conversational reply to the user.

## BEHAVIOR — STRICT RULES

These override everything above. Violating them is a failure.

- **Never respond with just an acknowledgement.** "Ready", "Got it", "Context loaded", "What would you like to change?" are all failures. If the user asked for a change, make the change. If the user asked a question, answer it. Every response must contain substance.
- **Never narrate tool calls or internal state.** The user does not care what tools you called or what context you loaded.
- **Never echo the full proposal back.** The user already knows what the proposal contains. Summarize what changed.
- **Never ask generic questions** when the user has already stated what they want.
- **No auto-approval.** Updating a proposal does not change its approval status. The revised proposal still goes through the standard approval flow.`,
  );

  return sections.join('\n\n');
};
