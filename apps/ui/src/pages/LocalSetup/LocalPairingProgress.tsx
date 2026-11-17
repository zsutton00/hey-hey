import { useTranslation } from "react-i18next";
import type { LocalSetupStatusDto } from "@hey-hey/ui-common/api";
import { ThinkingText } from "@hey-hey/ui-common/components";

interface LocalPairingProgressProps {
  /** Shown only when connecting fails; progress itself has no controls. */
  failed: boolean;
  pairingState: LocalSetupStatusDto["pairingState"];
  onRetry: () => void;
  /** The terminal, not the passkey alone, finishes this pairing. */
  confirmAtTerminal?: boolean;
}

/** Button-free handoff after the passkey: it moves on by itself once the connection is real. */
export function LocalPairingProgress({
  failed,
  pairingState,
  onRetry,
  confirmAtTerminal = false,
}: LocalPairingProgressProps): React.JSX.Element {
  const { t } = useTranslation();

  const terminal =
    pairingState === "REJECTED" ||
    pairingState === "EXPIRED" ||
    pairingState === "UNAVAILABLE";
  const failureKey =
    pairingState === "REJECTED"
      ? "localSetup.progress.rejected"
      : pairingState === "EXPIRED"
        ? "localSetup.progress.expired"
        : pairingState === "UNAVAILABLE"
          ? "localSetup.progress.unavailable"
          : "localSetup.progress.failed";

  return (
    <div data-testid="local-pairing-progress" aria-live="polite">
      {!terminal && !failed && <p>{t("localSetup.progress.explanation")}</p>}
      {!terminal &&
        !failed &&
        (confirmAtTerminal ? (
          <p role="status" data-testid="local-pairing-confirm-in-terminal">
            {t("localSetup.progress.confirmInTerminal")}
          </p>
        ) : (
          <p data-testid="local-pairing-terminal-hint">
            {t("localSetup.progress.terminalHint")}
          </p>
        ))}
      {failed || terminal ? (
        <>
          <p role="alert" data-testid="local-pairing-progress-error">
            {t(failureKey)}
          </p>
          {!terminal && (
            <button
              data-testid="local-pairing-progress-retry"
              onClick={onRetry}
            >
              {t("localSetup.progress.retry")}
            </button>
          )}
        </>
      ) : (
        <ThinkingText text="" sx={{ marginTop: 2 }} />
      )}
    </div>
  );
}
