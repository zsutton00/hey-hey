import { describe, expect, it, vi } from 'vitest';
import { loadPlanDesignDoc } from './load-plan-design-doc';
import { NOOP_LOGGER } from './logger';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const DESIGN_DOC_ID = '44444444-4444-4444-8444-444444444444';

const envelope = (data: object | object[]): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('loadPlanDesignDoc', () => {
  it('loads the PLAN_DOCUMENT returned by the project- and Plan-filtered collection', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/design-docs')) {
        return envelope([
          {
            id: '55555555-5555-4555-8555-555555555555',
            template: 'RFC',
          },
          {
            id: DESIGN_DOC_ID,
            template: 'PLAN_DOCUMENT',
          },
        ]);
      }
      if (url.pathname.endsWith(`/design-docs/${DESIGN_DOC_ID}`)) {
        return envelope({
          id: DESIGN_DOC_ID,
          name: 'Canonical Plan Design',
          sections: [
            { key: 'constraints', order: 1, materializedMarkdown: ' Preserve ownership. ' },
            { key: 'empty', order: 2, materializedMarkdown: '   ' },
            { key: 'approach', order: 0, materializedMarkdown: 'Load canonical evidence.' },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    });

    await expect(
      loadPlanDesignDoc(
        {
          apiBaseUrl: 'https://api.test/v1/',
          fetchImpl: fetchImpl as typeof fetch,
          logger: NOOP_LOGGER,
        },
        {
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          taskId: PLAN_ID,
          accessToken: 'token',
        },
      ),
    ).resolves.toEqual({
      id: DESIGN_DOC_ID,
      title: 'Canonical Plan Design',
      sections: {
        approach: 'Load canonical evidence.',
        constraints: 'Preserve ownership.',
      },
    });

    const designDocsUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(designDocsUrl.pathname).toBe(`/v1/organizations/${ORGANIZATION_ID}/design-docs`);
    expect(Object.fromEntries(designDocsUrl.searchParams)).toEqual({
      projectId: PROJECT_ID,
      taskId: PLAN_ID,
    });
    expect(new URL(String(fetchImpl.mock.calls[1]?.[0])).pathname).toBe(
      `/v1/organizations/${ORGANIZATION_ID}/design-docs/${DESIGN_DOC_ID}`,
    );
  });

  it('returns null without a detail read when the collection has no PLAN_DOCUMENT', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        envelope([
          {
            id: '55555555-5555-4555-8555-555555555555',
            template: 'RFC',
          },
        ]),
      ),
    );

    await expect(
      loadPlanDesignDoc(
        {
          apiBaseUrl: 'https://api.test/v1',
          fetchImpl: fetchImpl as typeof fetch,
          logger: NOOP_LOGGER,
        },
        {
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          taskId: PLAN_ID,
          accessToken: 'token',
        },
      ),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects a detail response for a different design document', async () => {
    const returnedDesignDocId = '66666666-6666-4666-8666-666666666666';
    const fetchImpl = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/design-docs')) {
        return envelope([{ id: DESIGN_DOC_ID, template: 'PLAN_DOCUMENT' }]);
      }
      return envelope({
        id: returnedDesignDocId,
        name: 'Wrong Plan Design',
        sections: [{ key: 'approach', order: 0, materializedMarkdown: 'Wrong contract.' }],
      });
    });

    await expect(
      loadPlanDesignDoc(
        {
          apiBaseUrl: 'https://api.test/v1',
          fetchImpl: fetchImpl as typeof fetch,
          logger: NOOP_LOGGER,
        },
        {
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          taskId: PLAN_ID,
          accessToken: 'token',
        },
      ),
    ).rejects.toThrow('Plan design document read returned a different design document.');
  });
});
