import type {
  MessageResponseDto,
  SystemMessageData,
  UserMessageData,
} from '../../shared/api/generated/api';
import type { AgentSessionTranscriptEntry } from './types';

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
    .map(
      (entry) =>
        `### Turn ${entry.turn} — ${entry.role === 'user' ? 'User' : 'Assistant'}\n${entry.content}`,
    )
    .join('\n\n');
}
