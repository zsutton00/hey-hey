import { describe, it, expect, vi } from 'vitest';
import { SessionEvidenceReader } from './session-evidence';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import type { EvidenceLimit } from './input-owner';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-10-25T06:00:00.000Z';
const item = (n: number) => ({
  entityType: 'AGENT_SESSION' as const,
  entityId: id(n),
  title: 'Agent Session',
});
const response = (data: object) => new Response(JSON.stringify({ data }));
const make = (fetchImpl: typeof fetch) =>
  new SessionEvidenceReader(
    createPromptTypeHandlerTestDeps({ fetchImpl }),
    'https://example.test',
    'token',
    id(99),
  );

describe('bounded observational session evidence', () => {
  it('selects ten canonical keys deterministically, discloses omissions, and uses only observational operations', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === 'POST') {
        const ids = JSON.parse(String(init.body)).agentSessionIds as string[];
        return response({
          items: ids.map((agentSessionId) =>
            String(url).includes('current-state')
              ? { agentSessionId, currentState: 'IDLE', revision: 1, transitionedAt: date }
              : { agentSessionId, state: 'MESSAGE_READY', revision: 1, changedAt: date },
          ),
        });
      }
      return response({
        id: String(url).split('/').at(-1),
        projectId: id(99),
        status: 'ACTIVE',
        createdAt: date,
        conversationId: id(50),
      });
    });
    const limits: EvidenceLimit[] = [];
    const result = await make(fetchImpl).build(
      Array.from({ length: 12 }, (_, i) => item(12 - i)),
      limits,
      new Set(),
    );
    expect(result).toHaveLength(10);
    expect(result[0]).toMatchObject({
      key: `AGENT_SESSION:${id(1)}`,
      createdAt: date,
      conversationId: id(50),
      currentState: { currentState: 'IDLE' },
      outputAttention: { state: 'MESSAGE_READY' },
    });
    expect(limits[0]?.truncated).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(12);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(String(url)).not.toMatch(/acknowledge|ready|activate|stop|open-items/);
      if (init?.method === 'POST')
        expect(String(url)).toMatch(/(?:current-state|output-attention):batch$/);
    }
  });

  it('isolates malformed members, missing projections, failed details and archived sessions', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const path = String(url);
      if (path.endsWith('current-state:batch'))
        return response({
          items: [
            null,
            { agentSessionId: id(2), currentState: 'THINKING', revision: 1, transitionedAt: date },
          ],
        });
      if (path.endsWith('output-attention:batch')) return new Response('', { status: 503 });
      if (path.endsWith(id(1))) return new Response('', { status: 503 });
      return response({
        id: path.split('/').at(-1),
        projectId: id(99),
        status: path.endsWith(id(3)) ? 'ARCHIVED' : 'ACTIVE',
        createdAt: 'broken',
        conversationId: id(50),
      });
    });
    const limits: EvidenceLimit[] = [];
    const archived = new Set<string>();
    const result = await make(fetchImpl).build([item(1), item(2), item(3)], limits, archived);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      createdAt: null,
      conversationId: null,
      currentState: null,
      outputAttention: null,
    });
    expect(result[1]).toMatchObject({
      createdAt: null,
      conversationId: id(50),
      currentState: { currentState: 'THINKING' },
      outputAttention: null,
    });
    expect(limits.find((l) => l.scope === 'sessions:current-state:batch')?.invalidRecords).toBe(1);
    expect(limits.find((l) => l.scope === 'sessions:output-attention:batch')?.unavailable).toBe(
      true,
    );
    expect(archived.has(`AGENT_SESSION:${id(3)}`)).toBe(true);
  });

  it('refreshes observations on every build and performs no calls for an empty candidate set', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ items: [] }));
    const reader = make(fetchImpl);
    await reader.build([], [], new Set());
    expect(fetchImpl).not.toHaveBeenCalled();
    await reader.build([item(1)], [], new Set());
    await reader.build([item(1)], [], new Set());
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});
