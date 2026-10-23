import { describe, expect, it } from 'vitest';
import type { MessageResponseDto } from '../../shared/api/generated/api';
import {
  formatAgentSessionTranscript,
  projectAgentSessionTranscript,
} from './conversation-transcript';

const message = (value: object): MessageResponseDto => value as MessageResponseDto;

describe('Agent Session conversation transcript projection', () => {
  it('orders canonical messages, includes the launch USER row, and labels turns', () => {
    const entries = projectAgentSessionTranscript([
      message({
        id: 'assistant-2',
        type: 'SYSTEM',
        conversationId: 'source-conversation',
        createdAt: '2026-08-17T10:00:03.000Z',
        data: { type: 'AGENT', response: 'Second answer.' },
      }),
      message({
        id: 'user-2',
        type: 'USER',
        conversationId: 'source-conversation',
        createdAt: '2026-08-17T10:00:02.000Z',
        data: { comment: 'Follow-up question.' },
      }),
      message({
        id: 'assistant-1',
        type: 'SYSTEM',
        conversationId: 'source-conversation',
        createdAt: '2026-08-17T10:00:01.000Z',
        data: { type: 'AGENT', response: 'First answer.' },
      }),
      message({
        id: 'user-1',
        type: 'USER',
        conversationId: 'source-conversation',
        createdAt: '2026-08-17T10:00:00.000Z',
        data: { comment: 'Launch question.' },
      }),
    ]);

    expect(entries).toEqual([
      { role: 'user', turn: 1, content: 'Launch question.' },
      { role: 'assistant', turn: 1, content: 'First answer.' },
      { role: 'user', turn: 2, content: 'Follow-up question.' },
      { role: 'assistant', turn: 2, content: 'Second answer.' },
    ]);
    expect(formatAgentSessionTranscript(entries)).toBe(
      '### Turn 1 — User\nLaunch question.\n\n' +
        '### Turn 1 — Assistant\nFirst answer.\n\n' +
        '### Turn 2 — User\nFollow-up question.\n\n' +
        '### Turn 2 — Assistant\nSecond answer.',
    );
  });

  it('excludes carriers, interstitial narration, hidden plumbing, triggers, and empty completions', () => {
    const entries = projectAgentSessionTranscript([
      message({
        id: 'carrier',
        type: 'SYSTEM',
        conversationId: 'source-conversation',
        createdAt: '2026-08-17T10:00:01.000Z',
        data: { type: 'CARRIER', response: 'proposal payload' },
      }),
      message({
        id: 'interstitial',
        type: 'SYSTEM',
        conversationId: 'source-conversation',
        createdAt: '2026-08-17T10:00:02.000Z',
        data: {
          type: 'AGENT',
          response: 'thinking aloud',
          uiElements: [{ id: 'interstitial', type: 'interstitial', label: '' }],
        },
      }),
      message({
        id: 'hidden',
        type: 'SYSTEM',
        conversationId: 'source-conversation',
        createdAt: '2026-08-17T10:00:03.000Z',
        data: {
          type: 'AGENT',
          response: 'hidden submission payload',
          uiElements: [{ id: 'agent_hidden', type: 'agent_hidden', label: '' }],
        },
      }),
      message({
        id: 'trigger',
        type: 'SYSTEM',
        conversationId: 'source-conversation',
        createdAt: '2026-08-17T10:00:04.000Z',
        data: { type: 'AGENT', response: 'dispatch plumbing', triggersAgent: {} },
      }),
      message({
        id: 'empty',
        type: 'SYSTEM',
        conversationId: 'source-conversation',
        createdAt: '2026-08-17T10:00:05.000Z',
        data: { type: 'AGENT', response: '  ' },
      }),
      message({
        id: 'visible',
        type: 'SYSTEM',
        conversationId: 'source-conversation',
        createdAt: '2026-08-17T10:00:06.000Z',
        data: { type: 'AGENT', response: 'Visible completion.' },
      }),
    ]);

    expect(entries).toEqual([{ role: 'assistant', turn: 1, content: 'Visible completion.' }]);
  });
});
