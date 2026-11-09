import type { ProjectReportFailure } from '@hey-hey/contracts/api/models';

const PUBLIC_MESSAGES: Record<string, string> = {
  LAUNCH_PREPARATION_FAILED: 'The project report run could not be prepared',
  START_RUN_REJECTED: 'The selected machine rejected the report run',
  START_RUN_FAILED: 'The project report run could not start',
  AUTHORIZATION_FAILED: 'The project report run could not be authorized',
  PROJECT_ACCESS_REVOKED: 'Project access was revoked during report generation',
  AGENT_SESSION_FAILED: 'The report agent ended with an error',
  REPORT_NOT_SUBMITTED: 'The report agent completed without a persisted report',
};

const UNKNOWN_FAILURE_CODE = 'REPORT_GENERATION_FAILED';
const UNKNOWN_FAILURE_MESSAGE = 'The project report could not be generated';

/**
 * The failure a member may see. Stored failure text can come from arbitrary
 * errors, so only approved codes keep their code, and every message is the
 * approved one for its code. Diagnostics stay in logs.
 */
export function toPublicProjectReportFailure(
  failure: ProjectReportFailure,
): ProjectReportFailure {
  // Authored by the launch check to name the selected Services that are
  // missing, so it is already member-facing text.
  if (failure.code === 'SERVICE_REPOSITORIES_UNAVAILABLE') {
    return failure;
  }

  const message = PUBLIC_MESSAGES[failure.code];
  if (message === undefined) {
    return {
      stage: failure.stage,
      code: UNKNOWN_FAILURE_CODE,
      message: UNKNOWN_FAILURE_MESSAGE,
      retryable: failure.retryable,
    };
  }

  return {
    stage: failure.stage,
    code: failure.code,
    message,
    retryable: failure.retryable,
  };
}
