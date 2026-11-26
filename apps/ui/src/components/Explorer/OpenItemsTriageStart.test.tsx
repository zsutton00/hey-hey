import { useState } from "react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@hey-hey/ui-common/i18n";
import { MachineExecutionReadinessState } from "@hey-hey/contracts/api";
import {
  resetCapabilityCatalogForTests,
  RuntimeModelSelector,
  type CapabilityCatalogRow,
  type SurfaceSelection,
} from "@hey-hey/ui-common/components";
import { fetchRuntimeModelCatalog } from "../../../../../packages/ui-common/src/data/collections/runtimeModelCatalog";
import { renderWithQueryClient } from "../../test/renderWithQueryClient";
import {
  serveTriageMachines,
  triageCatalog,
  triageMachine,
} from "../../test/openItemsTriageStart";
import { OpenItemsTriageHelp } from "./OpenItemsTriageHelp";

// The CLI read is the boundary: the picker, memory and catalog are real.
vi.mock(
  "../../../../../packages/ui-common/src/data/collections/runtimeModelCatalog",
  () => ({ fetchRuntimeModelCatalog: vi.fn() }),
);

const STORAGE_KEY = "hey-hey:agent-selection:open-items-triage";
const PICKER = "open-items-triage-model";
const [claude, codex, opencode, antigravity] = triageCatalog;

const catalogResponse = (providers: readonly CapabilityCatalogRow[]) => ({
  id: "catalog",
  response: {
    requestId: "catalog",
    operation: "runtime.model_catalog.get" as const,
    status: "success" as const,
    result: {
      providers: providers.map((row) => ({
        ...row,
        models: row.models.map((model) => ({
          ...model,
          efforts: [...model.efforts],
          ...(model.serviceTiers
            ? { serviceTiers: [...model.serviceTiers] }
            : {}),
        })),
      })),
    },
  },
});

const serveCatalog = (providers: readonly CapabilityCatalogRow[]) => {
  vi.mocked(fetchRuntimeModelCatalog).mockResolvedValue(
    catalogResponse(providers),
  );
};

/** What a second computer's CLI reports: none of triage's machine's models. */
const otherCatalog: readonly CapabilityCatalogRow[] = [
  {
    provider: "claude",
    models: [{ id: "other-claude", label: "Other Claude", efforts: ["low"] }],
  },
  {
    provider: "codex",
    models: [{ id: "other-codex", label: "Other Codex", efforts: ["low"] }],
  },
];

/** Another surface's picker, on its own machine, that re-renders on demand. */
function OtherMachinePicker() {
  const [renders, setRenders] = useState(0);
  return (
    <>
      <button
        data-testid="other-picker-render"
        onClick={() => setRenders(renders + 1)}
      />
      <RuntimeModelSelector
        catalogSource={{
          organizationId: "org",
          projectId: "project",
          machineId: "other-machine",
        }}
        provider="claude"
        model="other-claude"
        reasoningEffort="low"
        fastMode={false}
        disabled={renders % 2 === 1}
        onProviderChange={() => {}}
        onModelChange={() => {}}
        onReasoningEffortChange={() => {}}
        onFastModeChange={() => {}}
        testIdPrefix="other-model"
      />
    </>
  );
}

const without = (row: CapabilityCatalogRow, modelId: string) => ({
  ...row,
  models: row.models.filter((model) => model.id !== modelId),
});

const open = ({ besideOtherPicker = false } = {}) => {
  const onRun = vi.fn();
  renderWithQueryClient(
    <I18nextProvider i18n={i18n}>
      <OpenItemsTriageHelp
        organizationId="org"
        projectId="project"
        onRun={onRun}
      />
      {besideOtherPicker && <OtherMachinePicker />}
    </I18nextProvider>,
  );
  return onRun;
};

const tidyUp = () => screen.getByTestId("triage-start-tidy-up");
const springCleaning = () => screen.getByTestId("triage-start-spring-cleaning");

/** Presses Tidy up once the choice is complete and returns what it started. */
const startedRuntime = async (onRun: ReturnType<typeof vi.fn>) => {
  await waitFor(() => expect(tidyUp()).toBeEnabled());
  await userEvent.click(tidyUp());
  return onRun.mock.lastCall?.[0].runtime;
};

const choose = async (
  field: "provider" | "effort" | "model",
  option: string,
) => {
  const control = await screen.findByTestId(`${PICKER}-${field}-select`);
  await userEvent.click(within(control).getByRole("combobox"));
  await userEvent.click(
    await screen.findByTestId(`${PICKER}-${field}-option-${option}`),
  );
};

const saved = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
};

beforeEach(() => {
  localStorage.clear();
  resetCapabilityCatalogForTests();
  serveTriageMachines([triageMachine]);
  serveCatalog(triageCatalog);
});

afterEach(() => {
  cleanup();
});

describe("Open Items triage start screen", () => {
  it("starts on Haiku 5.5 at extra high on the ready machine and saves nothing", async () => {
    const onRun = open();
    expect(tidyUp()).toBeDisabled();
    expect(springCleaning()).toBeDisabled();

    await waitFor(() => expect(springCleaning()).toBeEnabled());
    await userEvent.type(
      screen.getByTestId("triage-start-guidance-input"),
      "Billing",
    );
    await userEvent.click(springCleaning());

    expect(onRun).toHaveBeenCalledExactlyOnceWith({
      mode: "springCleaning",
      guidance: "Billing",
      machineId: triageMachine.machineId,
      runtime: {
        provider: "claude",
        model: "claude-haiku-5-5",
        reasoningEffort: "xhigh",
      },
    });
    expect(saved()).toBeNull();
  });

  it.each<[string, readonly CapabilityCatalogRow[], SurfaceSelection]>([
    [
      "GPT-6 Luna at extra high when Codex is reported first",
      [codex, claude],
      {
        provider: "codex",
        model: "gpt-6-luna",
        reasoningEffort: "xhigh",
        fastMode: false,
      },
    ],
    [
      "the first provider that has models",
      [antigravity, claude],
      {
        provider: "claude",
        model: "claude-haiku-5-5",
        reasoningEffort: "xhigh",
      },
    ],
    [
      "the normal model and effort when the preferred model is not offered",
      [without(claude, "claude-haiku-5-5"), codex],
      {
        provider: "claude",
        model: "claude-opus-5-5",
        reasoningEffort: "medium",
        fastMode: false,
      },
    ],
    [
      "the normal model and effort for a provider with no triage default",
      [opencode, claude],
      {
        provider: "opencode",
        model: "opencode-default",
        reasoningEffort: null,
      },
    ],
  ])("with nothing saved starts on %s", async (_case, catalog, expected) => {
    serveCatalog(catalog);

    expect(await startedRuntime(open())).toEqual(expected);
    expect(saved()).toBeNull();
  });

  it.each<
    [
      string,
      readonly CapabilityCatalogRow[],
      SurfaceSelection,
      SurfaceSelection,
    ]
  >([
    [
      "preselects a saved choice",
      triageCatalog,
      {
        provider: "codex",
        model: "gpt-6-sol",
        reasoningEffort: "high",
        fastMode: true,
      },
      {
        provider: "codex",
        model: "gpt-6-sol",
        reasoningEffort: "high",
        fastMode: true,
      },
    ],
    [
      "replaces a saved model that is gone with that provider's triage default",
      triageCatalog,
      { provider: "codex", model: "gpt-5", reasoningEffort: "high" },
      {
        provider: "codex",
        model: "gpt-6-luna",
        reasoningEffort: "xhigh",
        fastMode: false,
      },
    ],
    [
      "uses the saved provider's normal default when its triage default is gone too",
      [claude, without(codex, "gpt-6-luna")],
      { provider: "codex", model: "gpt-5", reasoningEffort: "high" },
      {
        provider: "codex",
        model: "gpt-6-sol",
        reasoningEffort: "medium",
        fastMode: false,
      },
    ],
    [
      "ignores a saved provider the machine does not offer",
      triageCatalog,
      { provider: "antigravity", model: "gemini", reasoningEffort: "high" },
      {
        provider: "claude",
        model: "claude-haiku-5-5",
        reasoningEffort: "xhigh",
      },
    ],
    [
      "uses the normal effort when the saved one is no longer offered",
      triageCatalog,
      { provider: "codex", model: "gpt-6-sol", reasoningEffort: "max" },
      {
        provider: "codex",
        model: "gpt-6-sol",
        reasoningEffort: "medium",
        fastMode: false,
      },
    ],
  ])("%s", async (_case, catalog, remembered, expected) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remembered));
    serveCatalog(catalog);

    expect(await startedRuntime(open())).toEqual(expected);
    // A fallback never overwrites what the user saved.
    expect(saved()).toEqual(remembered);
  });

  it("lands a provider switch on its triage default and preselects it next time", async () => {
    open();
    await waitFor(() => expect(tidyUp()).toBeEnabled());
    const chosen = {
      provider: "codex",
      model: "gpt-6-luna",
      reasoningEffort: "xhigh",
      fastMode: false,
    };

    await choose("provider", "codex");

    expect(saved()).toEqual(chosen);
    cleanup();
    expect(await startedRuntime(open())).toEqual(chosen);
  });

  it("does not raise another provider's model to extra high", async () => {
    const onRun = open();
    await waitFor(() => expect(tidyUp()).toBeEnabled());

    await choose("provider", "opencode");

    expect(await startedRuntime(onRun)).toEqual({
      provider: "opencode",
      model: "opencode-default",
      reasoningEffort: null,
    });
  });

  it("keeps extra high on another model and sends and saves the user's Fast mode", async () => {
    const onRun = open();
    await waitFor(() => expect(tidyUp()).toBeEnabled());

    await choose("model", "claude-opus-5-5");
    await userEvent.click(
      screen.getByTestId(`${PICKER}-fast-mode-switch`).querySelector("input")!,
    );

    const chosen = {
      provider: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "xhigh",
      fastMode: true,
    };
    expect(await startedRuntime(onRun)).toEqual(chosen);
    expect(saved()).toEqual(chosen);
  });

  describe("beside a picker on another machine", () => {
    /** Both catalogs loaded, with the other picker the last to render. */
    const openBesideOtherPicker = async () => {
      vi.mocked(fetchRuntimeModelCatalog).mockImplementation(
        async ({ machineId }) =>
          catalogResponse(
            machineId === triageMachine.machineId
              ? triageCatalog
              : otherCatalog,
          ),
      );
      const onRun = open({ besideOtherPicker: true });
      await waitFor(() => expect(tidyUp()).toBeEnabled());
      await screen.findByTestId("other-model-catalog-ready");
      await userEvent.click(screen.getByTestId("other-picker-render"));
      return onRun;
    };

    it.each([
      [
        "a provider switch",
        "provider" as const,
        "codex",
        {
          provider: "codex",
          model: "gpt-6-luna",
          reasoningEffort: "xhigh",
          fastMode: false,
        },
      ],
      [
        "a model change",
        "model" as const,
        "claude-opus-5-5",
        {
          provider: "claude",
          model: "claude-opus-5-5",
          reasoningEffort: "xhigh",
          fastMode: false,
        },
      ],
    ])(
      "resolves %s against its own machine",
      async (_change, field, option, expected) => {
        const onRun = await openBesideOtherPicker();

        await choose(field, option);

        expect(saved()).toEqual(expected);
        expect(await startedRuntime(onRun)).toEqual(expected);
      },
    );

    it("keeps showing its own machine's models when only the picker re-renders", async () => {
      await openBesideOtherPicker();

      await userEvent.click(screen.getByTestId(`${PICKER}-favorite-save`));

      expect(
        screen.queryByTestId(`${PICKER}-selection-unavailable`),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId(`${PICKER}-model-input`)).toHaveValue(
        "Haiku 5.5",
      );
    });
  });

  it("waits for the user to pick among several ready machines", async () => {
    serveTriageMachines([
      triageMachine,
      { ...triageMachine, machineId: "second", name: "Second computer" },
    ]);
    const onRun = open();
    const picker = await screen.findByTestId("machine-picker-select");
    expect(tidyUp()).toBeDisabled();
    expect(fetchRuntimeModelCatalog).not.toHaveBeenCalled();

    await userEvent.click(within(picker).getByRole("combobox"));
    await userEvent.click(
      screen.getByRole("option", { name: /Second computer/ }),
    );

    await waitFor(() => expect(tidyUp()).toBeEnabled());
    await userEvent.click(tidyUp());
    expect(onRun.mock.lastCall?.[0].machineId).toBe("second");
  });

  it.each([
    [
      "no machine is paired",
      [],
      "open-items-triage-model-machine-readiness-notice",
    ],
    [
      "no paired machine is ready",
      [
        {
          ...triageMachine,
          executionReadiness: MachineExecutionReadinessState.Disconnected,
        },
      ],
      "triage-start-machine-recovery",
    ],
  ])("says why nothing can start when %s", async (_case, machines, cause) => {
    serveTriageMachines(machines);
    open();

    expect(await screen.findByTestId(cause)).not.toBeEmptyDOMElement();
    expect(tidyUp()).toBeDisabled();
    expect(springCleaning()).toBeDisabled();
  });

  it("shows why the machine list failed and starts nothing", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    globalThis.mswServer.use(
      http.get("*/api/v1/machines", () =>
        HttpResponse.json({ message: "down" }, { status: 500 }),
      ),
    );
    open();

    expect(
      await screen.findByTestId(
        "triage-start-machines-error",
        {},
        { timeout: 10_000 },
      ),
    ).toHaveTextContent("status code 500");
    expect(tidyUp()).toBeDisabled();
    expect(springCleaning()).toBeDisabled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  }, 15_000);

  it("shows why the model list failed and starts nothing", async () => {
    vi.mocked(fetchRuntimeModelCatalog).mockRejectedValue(
      new Error("The CLI did not answer in time."),
    );
    open();

    expect(
      await screen.findByTestId(`${PICKER}-catalog-error`),
    ).toHaveTextContent("The CLI did not answer in time.");
    expect(tidyUp()).toBeDisabled();
    expect(springCleaning()).toBeDisabled();
  });
});
