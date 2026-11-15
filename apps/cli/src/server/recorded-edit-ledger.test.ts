/** @vitest-environment node */

import { createServer, type Server } from 'node:http';
import type { ImplementReportEdit } from '@hey-hey/contracts/api/models';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordedEditLedger, RecordedEditLedgerUnavailableError } from './recorded-edit-ledger';

const scope = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  agentSessionId: '33333333-3333-4333-8333-333333333333',
  serviceId: '55555555-5555-4555-8555-555555555555',
};
const edit: ImplementReportEdit = {
  path: 'src/page.ts',
  turnId: 'turn-1',
  occurredAt: '2026-11-13T12:00:00Z',
  beforeObjectId: 'a'.repeat(40),
  afterObjectId: 'b'.repeat(40),
  beforeRanges: [{ startLine: 2, endLine: 4 }],
  afterRanges: [{ startLine: 2, endLine: 5 }],
  approximate: false,
  versionsRecorded: true,
};
const record = (edits: ImplementReportEdit[]) => ({
  report: { payload: { reportType: 'IMPLEMENT', summary: 's', filesChanged: [], edits } },
  commits: [],
});

describe('RecordedEditLedger', () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  const serve = async (pages: Array<{ records: unknown[]; hasMore: boolean }>) => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? '');
      const page =
        pages[
          Math.floor(
            Number(new URL(request.url ?? '', 'http://x').searchParams.get('offset')) / 100,
          )
        ];
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ success: true, data: page }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP port.');
    }
    return { url: `http://127.0.0.1:${String(address.port)}`, requests };
  };
  const authenticated = {
    getAccessToken: vi.fn().mockResolvedValue({ success: true, data: 'token' }),
  };

  it('finds an edit on a later page of the Run and Service reports', async () => {
    const api = await serve([
      { records: [record([{ ...edit, path: 'other.ts' }])], hasMore: true },
      { records: [record([edit])], hasMore: false },
    ]);
    const ledger = new RecordedEditLedger(authenticated, api.url);

    await expect(ledger.contains(scope, edit)).resolves.toBe(true);
    expect(api.requests[0]).toContain(`agentSessionId=${scope.agentSessionId}`);
    expect(api.requests[0]).toContain(`serviceId=${scope.serviceId}`);
  });

  it('does not accept an edit that re-pairs recorded versions', async () => {
    const api = await serve([{ records: [record([edit])], hasMore: false }]);
    const ledger = new RecordedEditLedger(authenticated, api.url);

    await expect(
      ledger.contains(scope, {
        ...edit,
        beforeObjectId: edit.afterObjectId,
        afterObjectId: edit.beforeObjectId,
      }),
    ).resolves.toBe(false);
  });

  it('reports membership as unknown when the stored reports cannot be read', async () => {
    const offline = new RecordedEditLedger(
      { getAccessToken: vi.fn().mockResolvedValue({ success: false, error: 'Not authenticated' }) },
      'http://127.0.0.1:1',
    );
    await expect(offline.contains(scope, edit)).rejects.toBeInstanceOf(
      RecordedEditLedgerUnavailableError,
    );
    const unreachable = new RecordedEditLedger(authenticated, 'http://127.0.0.1:1');
    await expect(unreachable.contains(scope, edit)).rejects.toBeInstanceOf(
      RecordedEditLedgerUnavailableError,
    );
  });
});
