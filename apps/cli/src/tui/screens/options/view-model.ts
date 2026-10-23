import type { PresentationState } from '../../presentation-state';
import { bodyHeight, contentWidth, type ScreenModel } from '../../screen-model';
import { heading, line, row, segment, wrapRows, type Row, type Segment } from '../../text';

const stateSegments = (enabled: boolean | null): Segment[] => {
  if (enabled === null) return [segment('Checking…', 'muted')];
  return enabled
    ? [segment('On', 'success'), segment('   Enter to turn off', 'muted')]
    : [segment('Off', 'warning'), segment('   Enter to turn on', 'muted')];
};

export const optionsViewModel = (state: PresentationState): ScreenModel => {
  const width = contentWidth(state.viewport.columns);
  const jevKeyMissing = state.options?.jevKeyDefined === false;
  const notice: Row[] = state.navigation.notice ? [row(state.navigation.notice, 'warning')] : [];
  return {
    title: 'OPTIONS',
    aside: 'This machine',
    body: [
      ...notice,
      heading('AGENTS'),
      line([segment('Intent-first (experimental)', 'accent', true)], {
        right: stateSegments(state.options?.intentFirst ?? null),
        selected: state.optionsRow === 'intent-first',
      }),
      line([segment('Agents write and ask in terms of what you want and will see', 'muted')], {
        indent: 3,
      }),
      line([]),
      line([segment('Remote tool-call viewing', 'accent', true)], {
        right: stateSegments(state.options?.remoteToolCallViewing ?? null),
        selected: state.optionsRow === 'remote-tool-call-viewing',
      }),
      line([segment("Let your other devices see this machine's agents' tool calls", 'muted')], {
        indent: 3,
      }),
      line([]),
      line([segment('Jev-filtered parent feature load', 'accent', true)], {
        right: jevKeyMissing
          ? [segment('Unavailable', 'muted')]
          : stateSegments(state.options?.jevParentFeatureFilter ?? null),
        selected: state.optionsRow === 'jev-parent-feature-filter',
      }),
      line(
        [
          segment(
            jevKeyMissing
              ? 'Needs a Jev key. Define TYPESAFE_API_KEY in your environment to use this.'
              : 'Project Assistant starts with only the parent requirements Jev judges relevant. Needs a Jev key.',
            'muted',
          ),
        ],
        { indent: 3 },
      ),
      line([]),
      ...wrapRows(
        row('Applies to every project on this machine. New sessions pick up changes.', 'muted'),
        width,
      ),
    ].slice(0, bodyHeight(state.viewport.rows)),
    footer: 'Esc back  ↑↓ move  Enter switch  q quit',
  };
};
