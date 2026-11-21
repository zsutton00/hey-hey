import { ThemeProvider } from "@hey-hey/ui-common/context";
import i18n from "@hey-hey/ui-common/i18n";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";
import App from "./App";

vi.hoisted(() => window.history.replaceState(null, "", "/login"));

it("starts the Web UI with its production providers", async () => {
  globalThis.mswServer.use(
    http.post(
      "*/api/v1/auth/refresh",
      () => new HttpResponse(null, { status: 401 }),
    ),
    http.get("*/api/v1/machines", () =>
      HttpResponse.json({ success: true, data: { machines: [] } }),
    ),
  );
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </I18nextProvider>,
  );

  expect(await screen.findByRole("textbox", { name: /email/i })).toBeVisible();
});
