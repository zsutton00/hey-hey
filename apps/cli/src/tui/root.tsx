import { Component, useSyncExternalStore, type ReactNode } from 'react';
import { ink } from './ink';
import { resolveKeyCommand } from './keybindings';
import { topScreen } from './navigation';
import type { PresentationOwner } from './presentation-owner';
import type { PresentationState } from './presentation-state';
import { MINIMUM_VIEWPORT } from './screen-model';
import { CeremonyScreen } from './screens/ceremony/CeremonyScreen';
import { ceremonyReviewPending, ceremonyViewModel } from './screens/ceremony/view-model';
import { DebugScreen } from './screens/debug/DebugScreen';
import { debugViewModel } from './screens/debug/view-model';
import { OptionsScreen } from './screens/options/OptionsScreen';
import { optionsViewModel } from './screens/options/view-model';
import { MenuScreen } from './screens/menu/MenuScreen';
import { menuViewModel } from './screens/menu/view-model';
import { QuitScreen } from './screens/quit/QuitScreen';
import { quitViewModel } from './screens/quit/view-model';
import { SessionScreen } from './screens/session/SessionScreen';
import { sessionViewModel } from './screens/session/view-model';

const TopScreen = ({ state }: { state: PresentationState }): React.JSX.Element => {
  const { Text } = ink();
  const { columns, rows } = state.viewport;
  if (columns < MINIMUM_VIEWPORT.columns || rows < MINIMUM_VIEWPORT.rows) {
    return (
      <Text wrap="wrap">
        Terminal too small. Enlarge it to at least {MINIMUM_VIEWPORT.columns}×
        {MINIMUM_VIEWPORT.rows}.
      </Text>
    );
  }
  const frame = { color: state.color, columns, rows };
  const screen = topScreen(state.navigation);
  switch (screen.kind) {
    case 'menu':
      return <MenuScreen model={menuViewModel(state)} {...frame} />;
    case 'session':
      return <SessionScreen model={sessionViewModel(state, screen.run)} {...frame} />;
    case 'options':
      return <OptionsScreen model={optionsViewModel(state)} {...frame} />;
    case 'debug':
      return <DebugScreen model={debugViewModel(state)} {...frame} />;
    case 'pairing':
    case 'add-controller':
      return <CeremonyScreen model={ceremonyViewModel(state)} {...frame} />;
    case 'quit-confirmation':
      return <QuitScreen model={quitViewModel(state)} {...frame} />;
  }
};

/** Connects to the presentation owner once and routes every key through the keybinding layer. */
export const PresentationRoot = ({ owner }: { owner: PresentationOwner }): React.JSX.Element => {
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  ink().useInput((input, key) => {
    const command = resolveKeyCommand(
      { screen: topScreen(state.navigation).kind, reviewPending: ceremonyReviewPending(state) },
      input,
      key,
    );
    if (command) owner.dispatch(command);
  });
  return <TopScreen state={state} />;
};

interface RootErrorBoundaryProps {
  readonly onRenderError: (error: Error) => void;
  readonly children: ReactNode;
}

/** Catches render failures so they are logged and the terminal restored; Runs are untouched. */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, { failed: boolean }> {
  public override state = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public override componentDidCatch(error: Error): void {
    this.props.onRenderError(error);
  }

  public override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
