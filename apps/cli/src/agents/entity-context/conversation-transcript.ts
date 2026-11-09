import type {
  MessageResponseDto,
  SystemMessageData,
  UserMessageData,
} from '@hey-hey/contracts/api/models';
import type { AgentSessionTranscriptEntry } from './types';

const isAgentUncertaintyMessage = (
  data: SystemMessageData,
): data is SystemMessageData & {
  type: 'AGENT_UNCERTAINTY';
  severity: 'low' | 'medium' | 'high';
  category: 'lack_of_evidence' | 'conflict' | 'ambiguity' | 'not_implemented' | 'question';
  statement: string;
} =>
  data.type === 'AGENT_UNCERTAINTY' &&
  (data.severity === 'low' || data.severity === 'medium' || data.severity === 'high') &&
  (data.category === 'lack_of_evidence' ||
    data.category === 'conflict' ||
    data.category === 'ambiguity' ||
    data.category === 'not_implemented' ||
    data.category === 'question') &&
  typeof data.statement === 'string' &&
  data.statement.trim().length > 0;

const compareCanonicalMessageOrder = (
  left: MessageResponseDto,
  right: MessageResponseDto,
): number => {
  const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
  return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
};

const readUserMessageContent = (data: UserMessageData): string => {
  const candidates = [
    data.agentInput?.userMessage,
    data['message'],
    data.comment,
    data['feedback'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const content = candidate.trim();
    if (content.length > 0) return content;
  }

  return '';
};

const hasUiElement = (data: SystemMessageData, type: string): boolean =>
  data.uiElements?.some((element) => element.type === type) ?? false;

const readAssistantMessageContent = (data: SystemMessageData): string => {
  if (data.type === 'CARRIER') return '';
  if (data.type !== 'AGENT') return '';
  if (data.triggersAgent) return '';
  if (hasUiElement(data, 'interstitial') || hasUiElement(data, 'agent_hidden')) return '';
  if (typeof data.response !== 'string') return '';
  return data.response.trim();
};

export function projectAgentSessionTranscript(
  messages: readonly MessageResponseDto[],
): readonly AgentSessionTranscriptEntry[] {
  let turn = 0;
  const entries: AgentSessionTranscriptEntry[] = [];

  for (const message of [...messages].sort(compareCanonicalMessageOrder)) {
    if (message.type === 'USER') {
      const content = readUserMessageContent(message.data);
      if (content.length === 0) continue;
      turn += 1;
      entries.push({ role: 'user', turn, content });
      continue;
    }

    if (isAgentUncertaintyMessage(message.data)) {
      turn += 1;
      entries.push({
        role: 'uncertainty',
        turn,
        uncertainty: {
          severity: message.data.severity,
          category: message.data.category,
          statement: message.data.statement,
        },
      });
      continue;
    }

    const content = readAssistantMessageContent(message.data);
    if (content.length === 0) continue;
    entries.push({ role: 'assistant', turn: Math.max(turn, 1), content });
  }

  return entries;
}

export function formatAgentSessionTranscript(
  entries: readonly AgentSessionTranscriptEntry[],
): string {
  return entries
    .map((entry) => {
      if (entry.role === 'uncertainty' && entry.uncertainty) {
        return `### Turn ${entry.turn} — Agent uncertainty\n${JSON.stringify(entry.uncertainty)}`;
      }
      return `### Turn ${entry.turn} — ${entry.role === 'user' ? 'User' : 'Assistant'}\n${entry.content ?? ''}`;
    })
    .join('\n\n');
}
