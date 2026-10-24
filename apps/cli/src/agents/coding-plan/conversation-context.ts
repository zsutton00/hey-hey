import { z } from 'zod';
import {
  CodingPlanVersionSchema,
  CodingPlanDiscrepancySchema,
} from '../../generated/coding-plan.schemas';
import type { AgenticSession } from '../../session/types';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';

// Decode the message envelope once; domain payloads use OpenAPI-generated validators.
const messageSchema = z
  .object({
    id: z.string(),
    createdAt: z.string().optional(),
    parentMessageId: z.string().nullable().optional(),
    type: z.string(),
    data: z
      .object({
        comment: z.string().optional(),
        response: z.string().optional(),
        agentInput: z.object({ userMessage: z.string().optional() }).passthrough().optional(),
        uiElements: z
          .array(z.object({ type: z.string(), payload: z.unknown().optional() }).passthrough())
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type PlanningConversationMessage = z.infer<typeof messageSchema>;

export async function fetchCodingPlanConversation(
  run: AgenticSession,
  deps: PromptTypeHandlerDeps,
): Promise<PlanningConversationMessage[]> {
  const { organizationId, projectId } = run.contextMetadata;
  if (!organizationId || !projectId || !run.conversationId) return [];
  const token = await deps.auth.getAccessToken();
  const query = new URLSearchParams({ projectId, conversationId: run.conversationId });
  const res = await deps.fetchImpl(
    `${deps.apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/messages?${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Planning conversation could not be loaded (${res.status}).`);
  const body = z.object({ data: z.array(z.unknown()) }).parse(await res.json());
  const messages: PlanningConversationMessage[] = [];
  const collect = (rows: unknown[]): void => {
    for (const row of rows) {
      const parsed = messageSchema.safeParse(row);
      if (parsed.success) messages.push(parsed.data);
      const children = z.object({ responses: z.array(z.unknown()) }).safeParse(row);
      if (children.success) collect(children.data.responses);
    }
  };
  collect(body.data);
  return [...new Map(messages.map((message) => [message.id, message])).values()].sort(
    (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id),
  );
}

export function latestCodingPlanVersion(messages: readonly PlanningConversationMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.type !== 'SYSTEM') continue;
    for (const element of message.data.uiElements ?? []) {
      if (element.type === 'coding_plan_version') {
        return { messageId: message.id, context: CodingPlanVersionSchema.parse(element.payload) };
      }
    }
  }
  return null;
}

export function renderCodingPlanConversation(
  messages: readonly PlanningConversationMessage[],
): string {
  const latest = latestCodingPlanVersion(messages);
  const discussion = messages.flatMap((message) => {
    if (message.type === 'USER') {
      const text =
        message.data.agentInput?.userMessage ?? message.data.comment ?? message.data.response;
      return text
        ? [
            `User (${message.id}${message.parentMessageId ? `, reply to ${message.parentMessageId}` : ''}): ${text}`,
          ]
        : [];
    }
    if (message.type !== 'SYSTEM') return [];
    return [
      ...(message.data.response ? [`Planner (${message.id}): ${message.data.response}`] : []),
      ...(message.data.uiElements ?? []).flatMap((element) => {
        if (element.type === 'coding_plan_version') {
          const version = CodingPlanVersionSchema.safeParse(element.payload);
          return version.success ? [`Plan (${message.id}): ${version.data.markdown}`] : [];
        }
        if (element.type !== 'coding_plan_discrepancy') return [];
        const issue = CodingPlanDiscrepancySchema.safeParse(element.payload);
        return [
          issue.success
            ? `Issue (${message.id}): ${JSON.stringify(issue.data)}`
            : `Issue (${message.id}) is unavailable because its persisted evidence is invalid.`,
        ];
      }),
    ];
  });
  return [latest ? `## Current complete plan\n${latest.context.markdown}` : '', ...discussion]
    .filter(Boolean)
    .join('\n\n');
}
