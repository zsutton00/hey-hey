import { useSyncExternalStore } from "react";
import {
  parseLocalSetupEvents,
  readStoredLocalSetupEvents,
  subscribeToLocalSetupEvents,
} from "./localSetupEvents";

/** Shows what the setup page did in this tab, so a failure never has to be guessed at. */
export function LocalSetupDiagnostics(): React.JSX.Element {
  const stored = useSyncExternalStore(
    subscribeToLocalSetupEvents,
    readStoredLocalSetupEvents,
  );
  const events = parseLocalSetupEvents(stored);

  return (
    <details open className="local-setup__diagnostics">
      <summary>Setup details (send these if something looks wrong)</summary>
      <pre data-testid="local-setup-diagnostics">
        {events.length > 0
          ? events.join("\n")
          : "Nothing recorded in this tab."}
      </pre>
    </details>
  );
}
