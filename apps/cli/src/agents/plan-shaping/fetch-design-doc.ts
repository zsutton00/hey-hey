import type { ServerLogger } from '../../server/logger';

export interface FetchDesignDocBodyDeps {
  organizationId: string;
  designDocId: string;
  fetchImpl: typeof fetch;
  accessToken: string;
  apiBaseUrl: string;
  logger?: ServerLogger;
}

interface DesignDocSectionRecord {
  key?: string;
  order?: number;
  materializedMarkdown?: string;
}

/**
 * Fetches a design document and returns its body as a single markdown string,
 * concatenating each section's `materializedMarkdown` in `order`. Throws on
 * HTTP failure or when the assembled body is empty — the phase-breakdown turn
 * has no graceful fallback for a missing design doc, so we surface the failure
 * instead of producing a degraded prompt.
 */
export async function fetchDesignDocBody(deps: FetchDesignDocBodyDeps): Promise<string> {
  const { organizationId, designDocId, fetchImpl, accessToken, apiBaseUrl, logger } = deps;

  const url =
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}` +
    `/design-docs/${encodeURIComponent(designDocId)}`;

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(
      `fetchDesignDocBody: HTTP ${response.status} fetching design doc ${designDocId}`,
    );
  }

  const body = (await response.json()) as {
    data?: { sections?: DesignDocSectionRecord[] };
  };

  const sections = Array.isArray(body.data?.sections) ? body.data!.sections! : [];
  const rendered = [...sections]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => (typeof s.materializedMarkdown === 'string' ? s.materializedMarkdown.trim() : ''))
    .filter((m) => m.length > 0)
    .join('\n\n');

  if (!rendered) {
    throw new Error(`fetchDesignDocBody: design doc ${designDocId} has empty body`);
  }

  logger?.info('plan_shaping_phase_breakdown.fetch_design_doc.found', {
    designDocId,
    bodyLength: rendered.length,
    sectionCount: sections.length,
  });

  return rendered;
}
