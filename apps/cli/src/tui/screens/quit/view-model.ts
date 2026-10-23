import type { PresentationState } from '../../presentation-state';
import type { ScreenModel } from '../../screen-model';
import { plural, row } from '../../text';

export const quitViewModel = (state: PresentationState): ScreenModel => ({
  title: 'HEY HEY / quit',
  aside: 'Esc stay',
  body: [
    row('Stop Hey Hey?', 'normal', true),
    row(''),
    state.activeWorkCount > 0
      ? row(
          `${plural(state.activeWorkCount, 'session is', 'sessions are')} working. Quitting stops ${state.activeWorkCount === 1 ? 'it' : 'them'}.`,
          'warning',
        )
      : row('No sessions are working now.', 'muted'),
    row('Sessions waiting or idle are also closed on this machine.', 'muted'),
  ],
  footer: 'y or Enter quit  n or Esc stay  Ctrl+C quit now',
});
