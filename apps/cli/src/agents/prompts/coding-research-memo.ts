import type {
  CodingResearchReportPayload,
  CodingResearchReadinessEvidence,
  CodingResearchUncertainty,
  CodingResearchUpdate,
} from '@hey-hey/contracts/api/models';

interface ResearchMemoEvidence {
  frame: Record<string, unknown>;
  updates: CodingResearchUpdate[];
  readinessEvidence: CodingResearchReadinessEvidence[];
  uncertainties: CodingResearchUncertainty[];
}

/** The run-local handoff shared by real bootstrap and isolated eval preparation. */
export const renderCodingResearchMemo = (
  report: CodingResearchReportPayload,
  additionalEvidence?: ResearchMemoEvidence,
): string => {
  const hasStructuredEvidence = report.format !== 'WRITTEN';
  const evidence =
    additionalEvidence ??
    (report.format !== 'WRITTEN'
      ? {
          frame: report.frame,
          updates: report.updates,
          readinessEvidence: report.readinessEvidence ?? [],
          uncertainties: report.uncertainties,
        }
      : {
          frame: {},
          updates: [],
          readinessEvidence: [],
          uncertainties: [],
        });

  return [
    report.format === 'WRITTEN' ? '## Research report' : '## Research frame',
    ...(report.format === 'WRITTEN'
      ? [`Summary: ${report.summary}`, '', report.analysis]
      : ['```json', JSON.stringify(report.frame, null, 2), '```', '', report.analysis]),
    ...(hasStructuredEvidence || additionalEvidence
      ? [
          '',
          '## Reconciliation updates',
          '```json',
          JSON.stringify(evidence.updates, null, 2),
          '```',
          '',
          '## Implementation-readiness evidence',
          '```json',
          JSON.stringify(evidence.readinessEvidence, null, 2),
          '```',
        ]
      : []),
    ...(additionalEvidence
      ? [
          '',
          '## Research evidence from child handoffs',
          '```json',
          JSON.stringify(evidence.frame, null, 2),
          '```',
        ]
      : []),
    ...(report.format === 'STRUCTURED'
      ? [
          '',
          '## Structured uncertainties',
          '```json',
          JSON.stringify(evidence.uncertainties, null, 2),
          '```',
        ]
      : []),
  ].join('\n');
};
