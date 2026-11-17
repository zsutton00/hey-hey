import { useTranslation } from "react-i18next";
import type { LocalRepairView } from "./useLocalReturningPasskey";

interface LocalRepairPanelProps {
  view: Exclude<LocalRepairView, "none">;
  /** Why the last request was refused, in the API's own words. */
  error: string | null;
  onRepair: () => void;
}

/**
 * Shown when the passkey this computer was set up with can't be used here:
 * says what happened in plain words and offers the one action that fixes it.
 */
export function LocalRepairPanel({
  view,
  error,
  onRepair,
}: LocalRepairPanelProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <section
      className="local-pairing__repair"
      data-testid="local-repair"
      aria-live="polite"
    >
      <p data-testid="local-repair-explanation">
        {t("localSetup.repair.explanation")}
      </p>
      {error ? (
        <p role="alert" data-testid="local-repair-error">
          {error}
        </p>
      ) : null}
      {view === "requested" ? (
        <p role="status" data-testid="local-repair-confirm-in-terminal">
          {t("localSetup.repair.confirmInTerminal")}
        </p>
      ) : (
        <>
          {view === "declined" ? (
            <p role="status" data-testid="local-repair-declined">
              {t("localSetup.repair.declined")}
            </p>
          ) : null}
          <button data-testid="local-repair-action" onClick={onRepair}>
            {t("localSetup.repair.action")}
          </button>
        </>
      )}
    </section>
  );
}
