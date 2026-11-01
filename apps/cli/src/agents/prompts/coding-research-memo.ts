import type { CodingResearchReportPayload } from '../../shared/api/generated/api';

/** The run-local handoff shared by real bootstrap and isolated eval preparation. */
export const renderCodingResearchMemo = (report: CodingResearchReportPayload): string =>
  [
    '## Research frame',
    '```json',
    JSON.stringify(report.frame, null, 2),
    '```',
    '',
    '## Reconciliation updates',
    '```json',
    JSON.stringify(report.updates, null, 2),
    '```',
    '',
    '## Implementation-readiness evidence',
    '```json',
    JSON.stringify(report.readinessEvidence, null, 2),
    '```',
    '',
    report.analysis,
  ].join('\n');
