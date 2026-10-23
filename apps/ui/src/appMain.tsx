import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@hey-hey/ui-common/context";
import i18n from "@hey-hey/ui-common/i18n";
import { I18nextProvider } from "react-i18next";

import "./index.css";
import App from "./App.tsx";

async function bootstrap() {
  if (import.meta.env.DEV) {
    await import("./wdyr");
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </I18nextProvider>
    </StrictMode>
  );
}

void bootstrap();
