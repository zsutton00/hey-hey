import { Frame } from '../tui/components/frame';
import { ink } from '../tui/ink';
import { row, sanitize, wrapText } from '../tui/text';
import type { LocalState } from './local-application';
import { PROMPT_WINDOW_LINES, promptRows } from './troubleshooting-prompt';
import { TROUBLESHOOT_COMMAND } from './troubleshooting-prompt-owner';

export function LocalScreen({
  state,
  selected,
  onSelect,
  onConfirm,
  onCancel,
  onTroubleshoot,
  onScroll,
  onCopy,
}: {
  state: LocalState;
  selected: number;
  onSelect: (index: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** When given, recovery and prerequisite screens offer the troubleshooting prompt. */
  onTroubleshoot?: (() => void) | undefined;
  onScroll?: (delta: number) => void;
  onCopy?: () => void;
}): React.JSX.Element {
  const { useInput } = ink();
  const actionable = [
    'installation',
    'prerequisite',
    'recovery',
    'stop',
    'update',
    'docker-repair',
    'troubleshooting',
  ].includes(state.kind);
  const offersPrompt =
    onTroubleshoot !== undefined && (state.kind === 'recovery' || state.kind === 'prerequisite');
  const choiceCount = offersPrompt ? 3 : 2;
  useInput((input, key) => {
    if (!actionable) {
      return;
    }
    if (state.kind === 'troubleshooting') {
      if (key.upArrow || key.downArrow) {
        onScroll?.(key.upArrow ? -1 : 1);
      } else if (key.pageUp || key.pageDown) {
        onScroll?.(key.pageUp ? -PROMPT_WINDOW_LINES : PROMPT_WINDOW_LINES);
      } else if (key.escape) {
        onCancel();
      } else if (key.return || input === 'c') {
        onCopy?.();
      }
      return;
    }
    if (key.upArrow) {
      onSelect((selected + choiceCount - 1) % choiceCount);
    }
    if (key.downArrow) {
      onSelect((selected + 1) % choiceCount);
    }
    if (key.escape) {
      onCancel();
    }
    if (key.return) {
      if (offersPrompt && selected === 2) {
        onTroubleshoot();
      } else if (
        selected ===
        (state.kind === 'stop' || state.kind === 'update' || state.kind === 'docker-repair' ? 0 : 1)
      ) {
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
        `${String(state.activeCount)} sessions are active, including other terminals.`,
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
      choices = ['Retry', 'Cancel', ...(offersPrompt ? ['Get troubleshooting prompt'] : [])];
      break;
    case 'progress':
      lines = [...state.steps.map((step) => `✓ ${step}`), `⋯ ${state.current}`];
      break;
    case 'docker-repair':
      title = 'Share the managed model with Docker?';
      lines = [
        state.message,
        '',
        `Repair adds the model share and restarts Colima profile ${state.profile}.`,
        'Restarting this VM stops its other containers. Existing shares, their options, installation data and volumes are kept. A configuration backup is saved before changes.',
      ];
      choices = ['Keep configuration unchanged', 'Repair and restart this VM'];
      break;
    case 'recovery':
      title = "Hey Hey couldn't start";
      lines = [state.message, '', 'Your existing installation and data are preserved.'];
      choices = ['Retry', 'Exit', ...(offersPrompt ? ['Get troubleshooting prompt'] : [])];
      break;
    case 'troubleshooting': {
      const rows = promptRows(state.prompt.text);
      const start = Math.min(state.offset, Math.max(0, rows.length - PROMPT_WINDOW_LINES));
      const end = start + PROMPT_WINDOW_LINES;
      title = 'Troubleshooting prompt';
      lines = [
        'Paste this to your own coding agent. Nothing is sent anywhere by Hey Hey.',
        'It contains local paths, which include your account name; check it before pasting it into a remote chat.',
        '',
        start > 0 ? `↑ ${start} more line(s) above` : '',
        ...rows.slice(start, end),
        end < rows.length ? `↓ ${rows.length - end} more line(s) below` : '',
        '',
        state.notice ??
          (state.prompt.savedPath
            ? `Saved to ${state.prompt.savedPath}. Show it again with: ${TROUBLESHOOT_COMMAND}`
            : `Not saved (${state.prompt.saveFailure ?? 'unknown reason'}). Show it again with: ${TROUBLESHOOT_COMMAND}`),
      ];
      choices = ['Copy to clipboard'];
      break;
    }
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
    ...choices.map((choice, index) => ({
      ...row(choice),
      selected: state.kind === 'troubleshooting' || index === selected,
    })),
  ];
  return (
    <Frame
      model={{
        title: 'HEY HEY',
        aside: 'LOCAL',
        body,
        footer:
          state.kind === 'troubleshooting'
            ? '↑ ↓ scroll   c or Enter copy   Esc back'
            : actionable
              ? '↑ ↓ choose   Enter confirm'
              : 'Existing installations keep their data.',
      }}
      color={true}
      columns={100}
      rows={30}
    />
  );
}
