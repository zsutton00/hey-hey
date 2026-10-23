import type {
  MachineEnrollmentCeremonyStep,
  MachineEnrollmentOutcome,
} from '../../../auth/machine-enrollment-ceremony';
import type { CeremonyState, PresentationState } from '../../presentation-state';
import { bodyHeight, contentWidth, type ScreenModel } from '../../screen-model';
import { formatClock, row, sanitize, wrapRows, type Row } from '../../text';

const TITLE: Record<CeremonyState['actionId'], string> = {
  pair: 'HEY HEY / pair this machine',
  'add-controller': 'HEY HEY / add a controller',
};

const OUTCOME: Record<MachineEnrollmentOutcome, Row> = {
  confirmed: row('Done.', 'success', true),
  declined: row('You declined the request. Nothing was changed.', 'warning'),
  expired: row('The request expired. Start again from the menu.', 'warning'),
  terminal: row('This enrollment ended and cannot continue. Start again from the menu.', 'danger'),
  cancelled: row('Cancelled. Nothing was changed.', 'muted'),
  failed: row('Something went wrong. Debug logs have the details.', 'danger'),
};

const stepRows = (ceremony: CeremonyState, step: MachineEnrollmentCeremonyStep | null): Row[] => {
  const link: Row[] = ceremony.browserUrl
    ? [
        row('Open this page in your browser to continue:'),
        row(`  ${ceremony.browserUrl}`, 'accent'),
      ]
    : [];
  if (step === null) return [row('Starting…', 'muted')];
  switch (step.kind) {
    case 'browser-handoff':
      return [...link, row(''), row(`Code  ${step.userCode}`, 'normal', true)];
    case 'waiting-for-browser':
      return [
        ...link,
        row(''),
        row('Waiting for you to finish in the browser…', 'muted'),
        row(`This request expires at ${formatClock(step.expiresAt)}.`, 'muted'),
        ...(step.resumed ? [row('Resumed an earlier request from this machine.', 'muted')] : []),
      ];
    case 'local-review': {
      const review = step.review;
      return [
        row('Review this request before it is allowed', 'normal', true),
        row(''),
        row(`Machine      ${sanitize(review.machineName)} (${review.osFamily})`),
        row(`Controller   ${sanitize(review.controllerLabel)}`),
        row(`Fingerprint  ${review.controllerCredentialFingerprint}`),
        row(
          `Passkey      ${review.backupEligible ? 'backup eligible' : 'not backup eligible'}, ${review.backupState ? 'backed up' : 'not backed up'}`,
        ),
        row(`Expires      ${formatClock(review.expiresAt)}`),
        row(''),
        row('Approve only if you started this from a device you control.', 'warning'),
      ];
    }
    case 'activating':
      return [row('Activating…', 'muted')];
    case 'problem':
      return [row(sanitize(step.message), 'warning')];
    case 'finished':
      return [OUTCOME[step.outcome]];
  }
};

export const ceremonyViewModel = (state: PresentationState): ScreenModel => {
  const ceremony = state.ceremony;
  if (!ceremony) {
    return {
      title: 'HEY HEY',
      aside: 'Esc back',
      body: [row('No enrollment is running.', 'muted')],
      footer: 'Esc back',
    };
  }
  const step = ceremony.step;
  const width = contentWidth(state.viewport.columns);
  const body = stepRows(ceremony, step).flatMap((source) => wrapRows(source, width));
  const footer =
    step?.kind === 'finished'
      ? 'Esc back to menu'
      : step?.kind === 'local-review'
        ? 'y approve  n decline  Esc cancel'
        : 'Esc cancel';
  return {
    title: TITLE[ceremony.actionId],
    aside: step?.kind === 'finished' ? 'Esc back' : 'Esc cancel',
    body: body.slice(0, bodyHeight(state.viewport.rows)),
    footer,
  };
};

/** True while the local review waits for y/n, so the keymap accepts those keys. */
export const ceremonyReviewPending = (state: PresentationState): boolean =>
  state.ceremony?.step?.kind === 'local-review';
