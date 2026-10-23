import type {
  CreateProjectReportRequestDto,
  ProjectReportPayload,
} from 'src/generated';

export const projectReportRequest = {
  question: 'What changed this week?',
  scope: {
    projectId: '96c5429a-84d1-4813-b661-75be18f2b3c2',
    windowStart: '2026-09-21T00:00:00Z',
    windowEnd: '2026-09-28T00:00:00Z',
    timeZone: 'America/Los_Angeles',
  },
  exclusions: [],
  launch: {
    machineId: '1ec6a5cd-2633-4964-911b-70c99c2e3f36',
    provider: 'codex',
    model: 'configured-model',
    effort: 'high',
  },
  idempotencyKey: 'submission-one',
} satisfies CreateProjectReportRequestDto;

export const projectReportPayload = {
  reportType: 'PROJECT_REPORT',
  title: 'Weekly progress',
  summary: 'The selected work progressed this week.',
  question: projectReportRequest.question,
  scope: projectReportRequest.scope,
  exclusions: [],
  provenance: {
    requestId: '87b3c597-22f9-40ee-84a4-e028c2174109',
    attemptId: '62d8d42c-a788-4356-8ce9-ebfeec603b31',
    evidenceReadStartedAt: '2026-09-28T01:00:00Z',
    evidenceReadCompletedAt: '2026-09-28T01:01:00Z',
    evidence: [],
  },
  coverage: {
    status: 'COMPLETE',
    matchingActivityCount: 1,
    processedActivityCount: 1,
    pagesRead: 1,
    limitations: [],
  },
  body: {
    html: '<p>The selected work progressed.</p>',
    css: 'p { color: #222; }',
  },
} satisfies ProjectReportPayload;
