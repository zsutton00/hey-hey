import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { forgetLocalPairing } from "../pages/Settings/localApproval";
import { LocalSetupApp } from "./LocalSetupApp";
import { loadDocument } from "./loadDocument";
import { forgetSetupSession, getSetupSession } from "./setupSession";

vi.mock("./loadDocument", () => ({ loadDocument: vi.fn() }));

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const ORG_ID = "550e8400-e29b-41d4-a716-446655440002";
const ENROLLMENT_ID = "550e8400-e29b-41d4-a716-446655440003";
const HANDOFF_TOKEN = "h".repeat(43);
const APPROVAL_SECRET = Buffer.alloc(32, 7).toString("base64url");

const sessionWith = (accessToken: string, name: string) => ({
  accessToken,
  expiresIn: 900,
  user: {
    id: USER_ID,
    currentOrganizationId: ORG_ID,
    email: "local@installation.invalid",
    name,
    isActive: true,
    isLocalAccount: true,
    createdAt: "2026-11-02T00:00:00Z",
    updatedAt: "2026-11-02T00:00:00Z",
  },
});

const claimable = {
  state: "claimable",
  enrollmentId: ENROLLMENT_ID,
  machineId: "550e8400-e29b-41d4-a716-446655440004",
  userId: USER_ID,
  organizationId: ORG_ID,
  machineName: "Ada's MacBook",
  osFamily: "macos",
  cliVersion: "2.2.2",
  machineKeyFingerprint: "sha256:machine",
  controllerLabel: "Passkey on this computer",
  enrollmentMode: "SHARED_NEW",
  expiresAt: "2099-01-01T00:00:00.000Z",
  registrationOptions: {
    challenge: "Y2hhbGxlbmdl",
    rp: { id: "localhost", name: "Hey Hey" },
    user: { id: "dXNlcg", name: "Ada", displayName: "Ada" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: {
      userVerification: "required",
      residentKey: "required",
    },
    attestation: "none",
  },
};

/** What the browser's passkey prompt returns once the person approves it. */
const createdPasskey = () => ({
  id: "Y3JlZGVudGlhbA",
  type: "public-key",
  rawId: new Uint8Array([1, 2, 3]).buffer,
  authenticatorAttachment: "platform",
  response: {
    clientDataJSON: new Uint8Array([4]).buffer,
    attestationObject: new Uint8Array([5]).buffer,
    getTransports: () => ["internal"],
    getPublicKey: () => new Uint8Array([48, 89, 48, 19]).buffer,
  },
});

interface SetupServer {
  requests: string[];
  refreshes: number;
  statusTokens: string[];
  nameComplete: boolean;
  machineConnected: boolean;
}

const serveSetup = (): SetupServer => {
  const server: SetupServer = {
    requests: [],
    refreshes: 0,
    statusTokens: [],
    nameComplete: false,
    machineConnected: false,
  };
  const status = () => ({
    nameComplete: server.nameComplete,
    browserSession: true,
    machineConnected: server.machineConnected,
    executionReady: false,
    hasProjects: false,
    setupProjectId: null,
  });

  globalThis.mswServer.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    server.requests.push(`${request.method} ${url.pathname}`);
  });
  globalThis.mswServer.use(
    http.post("*/auth/local/handoff", async ({ request }) => {
      expect(await request.json()).toEqual({ handoffToken: HANDOFF_TOKEN });
      return HttpResponse.json({ data: sessionWith("handoff-token", "") });
    }),
    http.get("*/auth/local/status", ({ request }) => {
      server.statusTokens.push(request.headers.get("authorization") ?? "");
      return HttpResponse.json({ data: status() });
    }),
    http.patch("*/auth/local/name", async ({ request }) => {
      expect(await request.json()).toEqual({ name: "Ada" });
      server.nameComplete = true;
      return HttpResponse.json({ data: status() });
    }),
    http.post("*/auth/refresh", () => {
      server.refreshes += 1;
      return HttpResponse.json({ data: sessionWith("renewed-token", "Ada") });
    }),
    http.get("*/auth/passkeys", () =>
      HttpResponse.json({ data: { passkeys: [] } }),
    ),
    http.get("*/organizations", ({ request }) => {
      expect(request.headers.get("authorization")).toBe("Bearer renewed-token");
      return HttpResponse.json({
        data: [{ id: ORG_ID, name: "Ada's workspace" }],
      });
    }),
    http.post("*/machines/enrollments/claim/begin", () =>
      HttpResponse.json({ data: claimable }),
    ),
    http.post("*/machines/enrollments/claim/complete", async ({ request }) => {
      expect(await request.json()).toMatchObject({
        enrollmentId: ENROLLMENT_ID,
        localApprovalProof: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
      return HttpResponse.json({
        data: {
          enrollmentId: ENROLLMENT_ID,
          machineId: claimable.machineId,
          organizationId: ORG_ID,
          state: "awaiting-machine-confirmation",
          credentialFingerprint: "sha256:credential",
          backupEligible: true,
          backupState: true,
          controllerLabel: claimable.controllerLabel,
          // Adding the sign-in passkey ended every earlier session; this replaces setup's.
          session: sessionWith("passkey-token", "Ada"),
        },
      });
    }),
  );

  return server;
};

const webSocket = vi.fn();

beforeEach(() => {
  forgetSetupSession();
  forgetLocalPairing();
  sessionStorage.clear();
  vi.stubGlobal("WebSocket", webSocket);
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { create: vi.fn().mockResolvedValue(createdPasskey()) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(loadDocument).mockClear();
  globalThis.mswServer.events.removeAllListeners();
  window.history.replaceState({}, "", "/");
});

describe("local setup app", () => {
  it("runs name, passkey and CLI confirmation in order with only its own session, then hands off with a fresh page load", async () => {
    const server = serveSetup();
    window.history.replaceState(
      {},
      "",
      `/local?pairing=started#code=BCDFGHJKLM&approval=${APPROVAL_SECRET}&handoff=${HANDOFF_TOKEN}`,
    );
    const user = userEvent.setup();
    render(<LocalSetupApp />);

    await user.type(await screen.findByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const createPasskey = await screen.findByTestId(
      "local-pairing-create-passkey",
    );
    await waitFor(() => expect(createPasskey).toBeEnabled());
    // The pairing screen shows the name the server saved, read by setup's one renewal.
    expect(screen.getByTestId("local-pairing-technical")).toHaveTextContent(
      "Ada",
    );
    await user.click(createPasskey);

    expect(
      await screen.findByTestId("local-pairing-progress"),
    ).toBeInTheDocument();
    expect(getSetupSession()?.accessToken).toBe("passkey-token");
    server.machineConnected = true;
    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith("/welcome"), {
      timeout: 5000,
    });

    // Setup renewed exactly once, after the name; nothing renewed in the background.
    expect(server.refreshes).toBe(1);
    // After the passkey, every status check carries the passkey's session and no other.
    const afterPasskey = server.statusTokens.slice(
      server.statusTokens.indexOf("Bearer passkey-token"),
    );
    expect(afterPasskey.length).toBeGreaterThan(0);
    expect(new Set(afterPasskey)).toEqual(new Set(["Bearer passkey-token"]));
    // None of the main app starts: no live connection and no requests outside setup's own.
    expect(webSocket).not.toHaveBeenCalled();
    expect(new Set(server.requests)).toEqual(
      new Set([
        "POST /api/v1/auth/local/handoff",
        "GET /api/v1/auth/local/status",
        "PATCH /api/v1/auth/local/name",
        "POST /api/v1/auth/refresh",
        "GET /api/v1/auth/passkeys",
        "GET /api/v1/organizations",
        "POST /api/v1/machines/enrollments/claim/begin",
        "POST /api/v1/machines/enrollments/claim/complete",
      ]),
    );
  }, 15000);

  it("treats a refused request as a setup problem: no renewal, no sign-out, and a way forward", async () => {
    const server = serveSetup();
    globalThis.mswServer.use(
      http.get(
        "*/auth/local/status",
        () => new HttpResponse(null, { status: 401 }),
      ),
    );
    window.history.replaceState({}, "", `/local#handoff=${HANDOFF_TOKEN}`);
    render(<LocalSetupApp />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Run heyhey local and retry.",
    );
    expect(server.refreshes).toBe(0);
    expect(getSetupSession()?.accessToken).toBe("handoff-token");
    expect(loadDocument).not.toHaveBeenCalled();
  });

  it.each([
    [null, "/home"],
    [
      "550e8400-e29b-41d4-a716-446655440077",
      "/welcome?projectId=550e8400-e29b-41d4-a716-446655440077",
    ],
  ])(
    "returning after passkey sign-in restores setup from the cookie and resumes the workspace or unfinished setup (%s)",
    async (setupProjectId, destination) => {
      const server = serveSetup();
      globalThis.mswServer.use(
        http.get("*/auth/local/status", ({ request }) => {
          expect(request.headers.get("authorization")).toBe(
            "Bearer renewed-token",
          );
          return HttpResponse.json({
            data: {
              nameComplete: true,
              browserSession: true,
              machineConnected: true,
              executionReady: false,
              hasProjects: true,
              setupProjectId,
            },
          });
        }),
      );
      window.history.replaceState({}, "", "/local?pairing=started");
      render(<LocalSetupApp />);

      await waitFor(() =>
        expect(loadDocument).toHaveBeenCalledWith(destination),
      );
      expect(server.refreshes).toBe(1);
    },
  );
});
