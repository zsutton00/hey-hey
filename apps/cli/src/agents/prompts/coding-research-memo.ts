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
  const hasSelfResearchEvidence = report.format === 'SELF_RESEARCH';
  const evidence =
    additionalEvidence ??
    (report.format === 'SELF_RESEARCH'
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
    report.format === 'SUBAGENT_PARENT' ? '## Research report' : '## Research frame',
    ...(report.format === 'SUBAGENT_PARENT'
      ? [`Summary: ${report.summary}`, '', report.analysis]
      : ['```json', JSON.stringify(report.frame, null, 2), '```', '', report.analysis]),
    ...(hasSelfResearchEvidence || additionalEvidence
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
    // A subagent-parent report carries no frame of its own, so the producer's frame is
    // rendered here once. A self-research report already printed its frame first.
    ...(report.format === 'SUBAGENT_PARENT' && additionalEvidence
      ? ['', '## Research frame', '```json', JSON.stringify(evidence.frame, null, 2), '```']
      : []),
    ...(report.format === 'SELF_RESEARCH'
      ? ['', '## Uncertainties', '```json', JSON.stringify(evidence.uncertainties, null, 2), '```']
      : []),
  ].join('\n');
};
