import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActionsCapsuleProvider } from "../ActionsCapsule/ActionsCapsuleProvider";
import { useActionsCapsule } from "../ActionsCapsule/ActionsCapsuleContext";
import { LocalRunBrowserOpenErrorCode } from "../../local-agent-api/generated/api";
import { OpenBrowserCapsuleAction } from "./OpenBrowserCapsuleAction";
import { LocalRunBrowserOpenError } from "./runtime/directoryBindingApi";

const listRepos = vi.fn();
const openRunBrowserTab = vi.fn();

vi.mock("./runtime/directoryBindingApi", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./runtime/directoryBindingApi")
  >();
  return {
    ...actual,
    resolveLocalDirectoryRuntimeBaseUrl: () => "http://localhost:3847",
    createDirectoryBindingApi: () => ({ listRepos, openRunBrowserTab }),
  };
});

interface RegisteredAction {
  id: string;
  disabled?: boolean;
  onClick?: () => void;
  feedback?: { reason: string; retryable: boolean };
}

let latest: RegisteredAction | undefined;

const ActionsHarness: React.FC = () => {
  const ctx = useActionsCapsule();
  latest = (ctx.actions as unknown as RegisteredAction[]).find(
    (action) => action.id === "open-browser"
  );
  return null;
};

const renderAction = (props: {
  runId: string | null;
  sessionMachineId: string | null;
}) =>
  render(
    <ActionsCapsuleProvider>
      <OpenBrowserCapsuleAction {...props} order={35} />
      <ActionsHarness />
    </ActionsCapsuleProvider>
  );

beforeEach(() => {
  latest = undefined;
  listRepos.mockReset();
  openRunBrowserTab.mockReset();
});

describe("OpenBrowserCapsuleAction", () => {
  it("is enabled when the local CLI is the session's machine and opens the Run's tab", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    openRunBrowserTab.mockResolvedValue({ runId: "run-1", url: "about:blank" });
    renderAction({ runId: "run-1", sessionMachineId: "machine-1" });

    await waitFor(() => expect(latest?.disabled).toBe(false));
    expect(latest?.feedback).toBeUndefined();
    await act(async () => {
      latest?.onClick?.();
    });

    expect(openRunBrowserTab).toHaveBeenCalledWith("run-1", {
      machineId: "machine-1",
    });
  });

  it("is disabled with a reason when the local CLI is another machine", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-2", bindings: [] });
    renderAction({ runId: "run-1", sessionMachineId: "machine-1" });

    await waitFor(() => expect(latest?.feedback).toBeDefined());
    expect(latest?.disabled).toBe(true);
    expect(latest?.feedback?.reason).toMatch(/same computer/u);
    expect(latest?.feedback?.retryable).toBe(false);
  });

  it("is disabled without falling back when no local CLI answers", async () => {
    listRepos.mockRejectedValue(new TypeError("Failed to fetch"));
    renderAction({ runId: "run-1", sessionMachineId: "machine-1" });

    await waitFor(() => expect(latest?.feedback).toBeDefined());
    expect(latest?.disabled).toBe(true);
    expect(openRunBrowserTab).not.toHaveBeenCalled();
  });

  it("shows a typed failure such as Shared Browser being off", async () => {
    listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
    openRunBrowserTab.mockRejectedValue(
      new LocalRunBrowserOpenError(
        "off",
        LocalRunBrowserOpenErrorCode.SharedBrowserDisabled
      )
    );
    renderAction({ runId: "run-1", sessionMachineId: "machine-1" });

    await waitFor(() => expect(latest?.disabled).toBe(false));
    await act(async () => {
      latest?.onClick?.();
    });

    await waitFor(() =>
      expect(latest?.feedback?.reason).toBe(
        "The shared browser is turned off on this computer."
      )
    );
    expect(latest?.feedback?.retryable).toBe(true);
    expect(latest?.disabled).toBe(false);
  });
});
