import { I18nextProvider } from "react-i18next";
import i18n from "@hey-hey/ui-common/i18n";
import { WebClientProvider } from "@hey-hey/ui-common/clients";
import { ThemeProvider } from "@hey-hey/ui-common/context";
import { getApiBaseUrl } from "@hey-hey/ui-common/services";
import { LocalSetupPage } from "../pages/LocalSetup/LocalSetupPage";
import { setupAuthAdapter } from "./setupSession";

/**
 * Local first-time setup as its own app. It mounts none of the main app:
 * no routes or shell, no sign-in provider or background renewal, no
 * organization loading and no live connection. Its API client carries the
 * session setup holds and never renews it on its own.
 */
export function LocalSetupApp(): React.JSX.Element {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <WebClientProvider
          baseUrl={getApiBaseUrl()}
          authAdapter={setupAuthAdapter}
        >
          <LocalSetupPage />
        </WebClientProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
