import { Frame } from '../tui/components/frame';
import { ink } from '../tui/ink';
import { row, sanitize, wrapText } from '../tui/text';
import type { LocalState } from './local-application';

export function LocalScreen({
  state,
  selected,
  onSelect,
  onConfirm,
  onCancel,
}: {
  state: LocalState;
  selected: number;
  onSelect: (index: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { useInput } = ink();
  const actionable = ['installation', 'prerequisite', 'recovery', 'stop', 'update'].includes(
    state.kind,
  );
  useInput((_input, key) => {
    if (!actionable) {
      return;
    }
    if (key.upArrow || key.downArrow) {
      onSelect(selected === 0 ? 1 : 0);
    }
    if (key.escape) {
      onCancel();
    }
    if (key.return) {
      if (selected === (state.kind === 'stop' || state.kind === 'update' ? 0 : 1)) {
        onCancel();
      } else {
        onConfirm();
      }
    }
  });
  let title = 'Setting up local Hey Hey';
  let lines: string[] = [];
  let choices: string[] = [];
  switch (state.kind) {
    case 'stop':
      title = 'Stop local Hey Hey?';
      lines = [
        `${state.activeCount} sessions are active, including other terminals.`,
        'Stopping will interrupt them. Your local data will be kept.',
      ];
      choices = [
        'Keep running',
        state.activeCount > 0 ? 'Interrupt sessions and stop' : 'Stop application',
      ];
      break;
    case 'stopped':
      title = 'Local Hey Hey stopped';
      lines = ['Your local data was kept.', `Start again: ${state.restartCommand}`];
      break;
    case 'exited':
      title = 'Agent bridge stopped';
      lines = [
        `Local Hey Hey is still running at ${state.url}`,
        '',
        `Reconnect: ${state.reconnectCommand}`,
        `Stop application: ${state.stopCommand}`,
        '',
        'Closing this terminal does not stop the local application.',
      ];
      break;
    case 'update':
      title = `Update to CLI ${state.release.cliVersion}?`;
      lines = [
        state.required
          ? 'A matching release is required before starting or connecting.'
          : 'A newer coordinated release is available.',
        ...Object.entries(state.release.images).map(
          ([name, image]) => `${name}: ${image.reference}`,
        ),
        state.activeCount === null
          ? 'Active work could not be inspected. Update requires all terminal owners to be reachable.'
          : `${state.activeCount} active sessions will be interrupted. All local bridges will close.`,
        'The application will stop while updating. Your data will be kept.',
        'The CLI package and matching images change only if you accept.',
      ];
      choices = [state.required ? 'Cancel' : 'Keep current release', 'Update matching release'];
      break;
    case 'update-restart':
      title = `CLI ${state.version} installed`;
      lines = [
        'Run heyhey local to finish the consented matching-image update.',
        'Startup and connection remain blocked until the matching release is ready.',
      ];
      break;
    case 'installation':
      title = 'Run Hey Hey on this computer';
      lines = [
        'No local installation found.',
        '',
        'Hey Hey needs Docker. Setup downloads the application images and creates storage on this computer.',
      ];
      choices = ['Install and start', 'Cancel'];
      break;
    case 'prerequisite':
      title = 'Docker needs attention';
      lines = [state.message];
      choices = ['Retry', 'Cancel'];
      break;
    case 'progress':
      lines = [...state.steps.map((step) => `✓ ${step}`), `⋯ ${state.current}`];
      break;
    case 'recovery':
      title = "Hey Hey couldn't start";
      lines = [state.message, '', 'Your existing installation and data are preserved.'];
      choices = ['Retry', 'Exit'];
      break;
    case 'ready':
      title = 'Local application is ready';
      lines = [
        state.url,
        'The application runs in the background.',
        `Reconnect: ${state.reconnectCommand}`,
        `Stop application: ${state.stopCommand}`,
        'Account setup, bridge connection and execution authorization are separate.',
      ];
      break;
    case 'cancelled':
      title = 'Local setup cancelled';
      break;
  }
  const body = [
    row(title, 'accent'),
    row(''),
    ...lines.flatMap((line) => wrapText(sanitize(line), 90).map((text) => row(text))),
    row(''),
    ...choices.map((choice, index) => ({ ...row(choice), selected: index === selected })),
  ];
  return (
    <Frame
      model={{
        title: 'HEY HEY',
        aside: 'LOCAL',
        body,
        footer: actionable
          ? '↑ ↓ choose   Enter confirm'
          : 'Existing installations keep their data.',
      }}
      color={true}
      columns={100}
      rows={30}
    />
  );
}
