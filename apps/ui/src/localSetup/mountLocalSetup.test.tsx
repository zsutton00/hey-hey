import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@hey-hey/ui-common/i18n";
import { mountLocalSetup } from "./mountLocalSetup";
import { LocalSetupRoute } from "./LocalSetupRoute";
import { loadDocument } from "./loadDocument";

const loaded = vi.hoisted(() => ({
  mainApp: vi.fn(),
  setupApp: vi.fn(),
}));

vi.mock("../appMain", () => {
  loaded.mainApp();
  return {};
});

vi.mock("./startLocalSetupApp", () => ({
  startLocalSetupApp: loaded.setupApp,
}));

vi.mock("./loadDocument", () => ({ loadDocument: vi.fn() }));

afterEach(() => {
  delete window.__HEY_HEY_RUNTIME_CONFIG__;
  vi.clearAllMocks();
});

describe("/local entry", () => {
  it("starts only the setup app in a local deployment", async () => {
    window.__HEY_HEY_RUNTIME_CONFIG__ = { deployment: "local" };
    const root = document.createElement("div");

    mountLocalSetup(root);

    await vi.waitFor(() => expect(loaded.setupApp).toHaveBeenCalledWith(root));
    expect(loaded.mainApp).not.toHaveBeenCalled();
  });

  it("never loads setup in a hosted deployment, where /local is not a page", async () => {
    window.__HEY_HEY_RUNTIME_CONFIG__ = { deployment: "hosted" };

    mountLocalSetup(document.createElement("div"));

    await vi.waitFor(() => expect(loaded.mainApp).toHaveBeenCalled());
    expect(loaded.setupApp).not.toHaveBeenCalled();

    render(
      <MemoryRouter initialEntries={["/local?pairing=started"]}>
        <Routes>
          <Route path="/local" element={<LocalSetupRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(loadDocument).not.toHaveBeenCalled();
  });

  it("reloads an in-app visit to /local so setup starts on its own", () => {
    window.__HEY_HEY_RUNTIME_CONFIG__ = { deployment: "local" };

    render(
      <MemoryRouter initialEntries={["/local?pairing=started"]}>
        <Routes>
          <Route path="/local" element={<LocalSetupRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(loadDocument).toHaveBeenCalledWith("/local?pairing=started");
  });
});
