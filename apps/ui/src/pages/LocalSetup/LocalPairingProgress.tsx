import { useTranslation } from "react-i18next";

interface LocalPairingProgressProps {
  /** Shown only when connecting fails; progress itself has no controls. */
  failed: boolean;
  onRetry: () => void;
}

/** Button-free handoff after the passkey: it moves on by itself once the connection is real. */
export function LocalPairingProgress({
  failed,
  onRetry,
}: LocalPairingProgressProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div data-testid="local-pairing-progress" aria-live="polite">
      <h2>{t("localSetup.progress.title")}</h2>
      <p>{t("localSetup.progress.explanation")}</p>
      <p data-testid="local-pairing-terminal-hint">
        {t("localSetup.progress.terminalHint")}
      </p>
      {failed ? (
        <>
          <p role="alert" data-testid="local-pairing-progress-error">
            {t("localSetup.progress.failed")}
          </p>
          <button data-testid="local-pairing-progress-retry" onClick={onRetry}>
            {t("localSetup.progress.retry")}
          </button>
        </>
      ) : (
        <progress aria-label={t("localSetup.progress.title")} />
      )}
    </div>
  );
}
