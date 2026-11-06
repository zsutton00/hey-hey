import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@hey-hey/ui-common/context";
import { initializeBrowserApiRuntime } from "@hey-hey/ui-common/clients";
import { clearAuthToken } from "@hey-hey/ui-common/services";
import "@hey-hey/ui-common/i18n";
import LoginRoute from "./LoginRoute";

class TestCredential {
  id = "AQ";
  rawId = new Uint8Array([1]).buffer;
  type = "public-key";
  authenticatorAttachment = "platform";
  response = {
    clientDataJSON: new Uint8Array([1]).buffer,
    authenticatorData: new Uint8Array([2]).buffer,
    signature: new Uint8Array([3]).buffer,
    userHandle: null,
  };
}

const credentialGet = vi.fn();
const session = {
  accessToken: "local-access-token",
  expiresIn: 900,
  user: {
    id: "550e8400-e29b-41d4-a716-446655440001",
    currentOrganizationId: "550e8400-e29b-41d4-a716-446655440002",
    email: "hidden@installation.invalid",
    name: "Local User",
    isActive: true,
    isLocalAccount: true,
    createdAt: "2026-11-02T00:00:00Z",
    updatedAt: "2026-11-02T00:00:00Z",
  },
};

function Destination() {
  const location = useLocation();
  return (
    <p data-testid="destination">
      {location.pathname}
      {location.search}
      {location.hash}
    </p>
  );
}

function renderLogin(target = "/projects?tab=docs#requirements") {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: "/login", state: { from: target } }]}
    >
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/projects" element={<Destination />} />
          <Route path="/home" element={<Destination />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearAuthToken();
  localStorage.clear();
  initializeBrowserApiRuntime({ baseUrl: "http://localhost:3000/api/v1" });
  window.__HEY_HEY_RUNTIME_CONFIG__ = { deployment: "local" };
  vi.stubGlobal("PublicKeyCredential", TestCredential);
  vi.stubGlobal("navigator", {
    ...navigator,
    credentials: { get: credentialGet },
  });
  credentialGet.mockResolvedValue(new TestCredential());
  globalThis.mswServer.use(
    http.post("*/auth/refresh", () => new HttpResponse(null, { status: 401 })),
    http.post("*/auth/passkeys/sign-in/options", () =>
      HttpResponse.json({
        data: {
          challenge: "AQ",
          rpId: "localhost",
          allowCredentialIds: [],
          timeoutMs: 300000,
        },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  clearAuthToken();
  delete window.__HEY_HEY_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
});

describe("deployment login", () => {
  it("renews a valid session and restores the whole destination without a passkey prompt", async () => {
    globalThis.mswServer.use(
      http.post("*/auth/refresh", () => HttpResponse.json({ data: session })),
    );
    renderLogin();
    expect(screen.getByTestId("return-progress")).toBeInTheDocument();
    expect(await screen.findByTestId("destination")).toHaveTextContent(
      "/projects?tab=docs#requirements",
    );
    expect(credentialGet).not.toHaveBeenCalled();
  });

  it("signs in through the existing passkey endpoints without showing account credentials", async () => {
    let completed = false;
    globalThis.mswServer.use(
      http.post("*/auth/passkeys/sign-in", async ({ request }) => {
        expect(await request.json()).toMatchObject({
          credential: { id: "AQ", type: "public-key" },
        });
        completed = true;
        return HttpResponse.json({ data: session });
      }),
    );
    renderLogin();
    await userEvent.click(await screen.findByTestId("return-passkey"));
    expect(await screen.findByTestId("destination")).toHaveTextContent(
      "/projects?tab=docs#requirements",
    );
    expect(completed).toBe(true);
    expect(screen.queryByLabelText(/email|password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(session.user.email)).not.toBeInTheDocument();
  });

  it("keeps cancelled and rejected passkey attempts retryable", async () => {
    credentialGet.mockRejectedValueOnce(
      new DOMException("Cancelled", "NotAllowedError"),
    );
    renderLogin();
    await userEvent.click(await screen.findByTestId("return-passkey"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    globalThis.mswServer.use(
      http.post(
        "*/auth/passkeys/sign-in",
        () => new HttpResponse(null, { status: 401 }),
      ),
    );
    await userEvent.click(screen.getByTestId("return-passkey"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("return-passkey")).toBeEnabled();
    expect(screen.queryByTestId("destination")).not.toBeInTheDocument();
  });

  it("rejects unsafe destinations after session restoration", async () => {
    globalThis.mswServer.use(
      http.post("*/auth/refresh", () => HttpResponse.json({ data: session })),
    );
    renderLogin("https://unrelated.example/");
    expect(await screen.findByTestId("destination")).toHaveTextContent("/home");
  });

  it("renders the existing hosted login when the local flag is absent", async () => {
    delete window.__HEY_HEY_RUNTIME_CONFIG__;
    renderLogin();
    expect(await screen.findByLabelText(/Email Address/)).toBeInTheDocument();
    expect(screen.queryByTestId("local-login")).not.toBeInTheDocument();
  });
});
