import { useTranslation } from "react-i18next";
import {
  ControllerAuthorizationCadence,
  LocalCodingAgentAvailability,
  type LocalCodingAgentDetectionDto,
} from "@hey-hey/ui-common/api";

export interface TechnicalDetail {
  label: string;
  value: string;
}

interface LocalPairingScreenProps {
  computerName: string;
  /** Null when the CLI's report did not reach this page. */
  agents: LocalCodingAgentDetectionDto | null;
  technicalDetails: ReadonlyArray<TechnicalDetail>;
  /** The enrollment is prepared in the background; the ceremony needs it. */
  ready: boolean;
  busy: boolean;
  retryMessage: string | null;
  /** How long this browser may drive this computer once the passkey is approved. */
  cadence: ControllerAuthorizationCadence;
  onCadenceChange: (cadence: ControllerAuthorizationCadence) => void;
  onCreatePasskey: () => void;
  onCancel: () => void;
}

const DURATION_OPTIONS = [
  ControllerAuthorizationCadence.FiveMinutes,
  ControllerAuthorizationCadence.EightHours,
  ControllerAuthorizationCadence.OneDay,
  ControllerAuthorizationCadence.OneWeek,
  ControllerAuthorizationCadence.OneMonth,
] as const;

const DURATION_KEYS = {
  [ControllerAuthorizationCadence.FiveMinutes]:
    "localSetup.pairing.duration.FIVE_MINUTES",
  [ControllerAuthorizationCadence.EightHours]:
    "localSetup.pairing.duration.EIGHT_HOURS",
  [ControllerAuthorizationCadence.OneDay]:
    "localSetup.pairing.duration.ONE_DAY",
  [ControllerAuthorizationCadence.OneWeek]:
    "localSetup.pairing.duration.ONE_WEEK",
  [ControllerAuthorizationCadence.OneMonth]:
    "localSetup.pairing.duration.ONE_MONTH",
} as const satisfies Record<ControllerAuthorizationCadence, string>;

const AGENT_KEYS = ["claude", "codex", "opencode"] as const;

const AVAILABILITY_KEYS = {
  [LocalCodingAgentAvailability.Installed]:
    "localSetup.pairing.agents.installed",
  [LocalCodingAgentAvailability.NotFound]: "localSetup.pairing.agents.notFound",
  [LocalCodingAgentAvailability.CheckFailed]:
    "localSetup.pairing.agents.checkFailed",
} as const satisfies Record<LocalCodingAgentAvailability, string>;

const AGENT_NAME_KEYS = {
  claude: "localSetup.pairing.agents.claude",
  codex: "localSetup.pairing.agents.codex",
  opencode: "localSetup.pairing.agents.opencode",
} as const satisfies Record<(typeof AGENT_KEYS)[number], string>;

/** The single first-time pairing screen: what the passkey is for, then one button. */
export function LocalPairingScreen({
  computerName,
  agents,
  technicalDetails,
  ready,
  busy,
  retryMessage,
  cadence,
  onCadenceChange,
  onCreatePasskey,
  onCancel,
}: LocalPairingScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const noneFound =
    agents !== null &&
    AGENT_KEYS.every(
      (key) => agents[key] !== LocalCodingAgentAvailability.Installed,
    );

  return (
    <div data-testid="local-pairing-screen">
      <h2>{t("localSetup.pairing.title")}</h2>
      <p>{t("localSetup.pairing.purpose")}</p>
      <p data-testid="local-pairing-computer">
        {t("localSetup.pairing.computer")}: <strong>{computerName}</strong>
      </p>

      <section aria-labelledby="local-pairing-agents-heading">
        <h3 id="local-pairing-agents-heading">
          {t("localSetup.pairing.agents.heading")}
        </h3>
        {agents === null ? (
          <p data-testid="local-pairing-agents-unreported">
            {t("localSetup.pairing.agents.unreported")}
          </p>
        ) : (
          <ul data-testid="local-pairing-agents">
            {AGENT_KEYS.map((key) => (
              <li key={key} data-testid={`local-pairing-agent-${key}`}>
                {t(AGENT_NAME_KEYS[key])}: {t(AVAILABILITY_KEYS[agents[key]])}
              </li>
            ))}
          </ul>
        )}
        {noneFound ? (
          <p role="status" data-testid="local-pairing-none-found">
            {t("localSetup.pairing.agents.noneFound")}
          </p>
        ) : null}
      </section>

      <p data-testid="local-pairing-privacy">
        {t("localSetup.pairing.privacy")}
      </p>

      <fieldset data-testid="local-pairing-duration" disabled={busy}>
        <legend>{t("localSetup.pairing.duration.heading")}</legend>
        {DURATION_OPTIONS.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="local-pairing-duration"
              value={option}
              data-testid={`local-pairing-duration-${option}`}
              checked={cadence === option}
              onChange={() => onCadenceChange(option)}
            />
            {t(DURATION_KEYS[option])}
          </label>
        ))}
        <p data-testid="local-pairing-permission">
          {t("localSetup.pairing.duration.permission")}
        </p>
      </fieldset>

      <details data-testid="local-pairing-technical">
        <summary>{t("localSetup.pairing.technical.heading")}</summary>
        <dl>
          {technicalDetails.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>

      {retryMessage ? (
        <p role="alert" data-testid="local-pairing-retry">
          {retryMessage}
        </p>
      ) : null}

      <div className="local-setup__actions">
        <button
          data-testid="local-pairing-create-passkey"
          disabled={!ready || busy}
          onClick={onCreatePasskey}
        >
          {!ready
            ? t("localSetup.pairing.preparing")
            : retryMessage
              ? t("localSetup.pairing.tryAgain")
              : t("localSetup.pairing.createPasskey")}
        </button>
        <button data-testid="local-pairing-cancel" onClick={onCancel}>
          {t("localSetup.pairing.cancel")}
        </button>
      </div>
    </div>
  );
}
