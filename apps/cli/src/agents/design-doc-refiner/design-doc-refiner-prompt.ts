import type { DesignDocRefinerPromptInput } from './types';
import type {
  ContextRelatedEntityDto,
  AgentSessionEntryDto,
  ProposalResponseDto,
} from '../../shared/api/generated/api';
import { jsonOnlyInstructions } from '../prompts/common';

const formatDesignDoc = (designDoc: DesignDocRefinerPromptInput['designDoc']): string => {
  const lines: string[] = [];
  if (designDoc.id) lines.push(`ID: ${designDoc.id}`);
  if (designDoc.title) lines.push(`Title: ${designDoc.title}`);

  if (designDoc.sections && Object.keys(designDoc.sections).length > 0) {
    lines.push('');
    for (const [key, content] of Object.entries(designDoc.sections)) {
      lines.push(`### ${key}\n\n${content}`);
    }
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

const formatProposals = (proposals: ProposalResponseDto[]): string => {
  const lines = proposals.map((p) => {
    const title = p.title ? ` — "${p.title}"` : '';
    const influences = p.influences?.length
      ? ` (influenced by: ${p.influences.map((i) => i.entityId).join(', ')})`
      : '';
    return `- [${p.action}] ${p.status} — ${p.type}${title}${influences} (${p.createdAt})`;
  });
  return `**Proposal history:**\n${lines.join('\n')}`;
};

export const buildDesignDocRefinerPrompt = (input: DesignDocRefinerPromptInput): string => {
  const sections: string[] = [];

  sections.push(
    `You are a design-doc-refiner agent. The user is having a conversation about a specific design document — they may ask questions, think out loud, or request concrete changes to the document's sections.

You already have the full design document and surrounding context below. You have everything you need to make edits — do not wait for more information when the user's intent is clear.

## Decision-Making Loop

On each user message:

1. **Search when needed** — search when the user references something you don't have context for (a related task, a prior decision, an implementation detail). Use \`unified_search\`, \`search_design_docs\`, or \`search_features\`. Search for *this project's* knowledge, not generic best practices. Do NOT search on every turn — if the user's message is a clear edit request and you already have the context you need, skip straight to editing.
2. **Act on edit requests immediately** — if the user is requesting a concrete change, call \`edit_design_doc\`. Don't ask clarifying questions when the intent is clear.
3. **Answer questions directly** — not every message is an edit request. A question is a question; answer it concisely.`,
  );

  sections.push(
    `## Writing Standards

Writing standards for design documents — including what a design document is, what its sections are, and the section-register discipline — live in the platform's tool-guidance surface, not this prompt. Before authoring or editing a design document — that is, before your first \`edit_design_doc\` call — call \`get_tool_guidance({ toolName: "edit_design_doc" })\` exactly once and use the returned body as the writing standard for the section content you produce.`,
  );

  sections.push(`## DESIGN DOCUMENT\n\n${formatDesignDoc(input.designDoc)}`);

  const contextParts: string[] = [];
  const related = input.relatedEntities ?? [];
  const sessions = input.agentSessions ?? [];
  if (related.length > 0 || sessions.length > 0) {
    contextParts.push(formatRelatedEntities(related, sessions));
  }
  if (input.proposals && input.proposals.length > 0) {
    contextParts.push(formatProposals(input.proposals));
  }
  if (contextParts.length > 0) {
    sections.push(
      `## CONTEXT\n\nThis is the design document's surrounding context — related tasks, features, plans, and proposal history. Use it to understand what this document relates to and to maintain consistency with the broader project. Do not narrate or summarize this context to the user.\n\n${contextParts.join('\n\n')}`,
    );
  }

  sections.push(
    `## RESPONSE FORMAT

${jsonOnlyInstructions}

Return a JSON object with exactly one field:

{
  "response": "conversational explanation of what was done, or answer to the question"
}

Influences and proposal records are created by the \`edit_design_doc\` call itself — do not include them in your JSON response.

## BEHAVIOR — STRICT RULES

These override everything above. Violating them is a failure.

- **Never respond with just an acknowledgement.** "Ready", "Got it", "Context loaded", "What would you like to change?" are all failures. If the user asked for a change, make the change. If the user asked a question, answer it. Every response must contain substance.
- **Never include code-level implementation details in a design document.** If the user tries to add specific code, function signatures, or line-level details, redirect them: that belongs on a task or implementation hint. Edit the section to describe the approach instead.
- **Never narrate tool calls or internal state.** The user does not care what tools you called or what context you loaded.
- **Never echo the design document back.** The user already knows what the document contains.
- **Never ask generic questions** when the user has already stated what they want.`,
  );

  return sections.join('\n\n');
};
