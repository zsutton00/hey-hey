import type { CreateMachineEnrollmentResponseDto } from '../shared/api/index';

/**
 * Formats the small, actionable handoff shown while the browser completes an
 * enrollment. Browser-reviewed machine and account details stay in the web
 * UI; the CLI only needs the code, URL, and local-confirmation instruction.
 */
export const describeEnrollment = (
  enrollment: Pick<CreateMachineEnrollmentResponseDto, 'userCode'>,
  pairingUrl: string,
  introduction = 'Pair this machine in your browser.',
): string =>
  [
    introduction,
    `Code: ${enrollment.userCode}`,
    `Open: ${pairingUrl}`,
    'Keep this terminal open. After creating the passkey, return here to confirm.',
  ].join('\n');
