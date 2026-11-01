import { MessageReadMode } from '../shared/api/generated/api';
import type { AgenticSession } from '../session/types';
import type { PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { GetMessages200Response, ProposalReviewNoteRecord } from '../shared/api/generated/api';

/** Passive annotations are read when a user comments; they never launch work themselves. */
export async function loadScreenReviewContext(
  run: AgenticSession,
  deps: PromptTypeHandlerDeps,
): Promise<string> {
  const { organizationId, projectId } = run.contextMetadata ?? {};
  if (!organizationId || !projectId || !run.conversationId) {
    return '';
  }
  const accessToken = await deps.auth.getAccessToken();
  const notes: Array<{ authorId: string; annotation: ProposalReviewNoteRecord }> = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({
      conversationId: run.conversationId,
      mode: MessageReadMode.ReverseHistory,
      limit: '100',
      includeProposals: 'false',
      includeReports: 'false',
    });
    if (cursor) {
      query.set('historyCursor', cursor);
    }
    const response = await deps.fetchImpl(
      `${deps.apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/messages?${query}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) {
      throw new Error('Could not read session screen annotations before continuing.');
    }
    const body: GetMessages200Response = await response.json();
    if (!body.data) {
      throw new Error('Session message history is unavailable.');
    }
    const messages = Array.isArray(body.data) ? body.data : body.data.messages;
    for (const message of messages) {
      if (message.type === 'USER' && message.data.proposalReviewNote) {
        notes.push({ authorId: message.userId ?? '', annotation: message.data.proposalReviewNote });
      }
    }
    cursor = Array.isArray(body.data) ? undefined : body.data.nextCursor;
  } while (cursor);
  if (notes.length === 0) {
    return '';
  }
  notes.sort((a, b) => a.annotation.review.noteId.localeCompare(b.annotation.review.noteId));
  return `Session screen annotations (context for the user's comment, not separate execution requests). Preserve their proposal, reviewed revision, section, target and author attribution:\n${JSON.stringify(notes)}\n`;
}
