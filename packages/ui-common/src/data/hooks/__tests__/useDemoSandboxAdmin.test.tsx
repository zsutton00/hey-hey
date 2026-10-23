import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDemoSandboxAdmin } from "../useDemoSandboxAdmin";

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  setProgram: vi.fn(),
  setTemplate: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getDemoSandboxAdminOverview: mocks.read,
    setDemoSandboxProgram: mocks.setProgram,
    setDemoSandboxTemplate: mocks.setTemplate,
  },
}));

const program = {
  activeCap: 10,
  perIpLimit: 2,
  perIpWindowSeconds: 3600,
};
const template = {
  id: "8f8d1c4e-55a2-4f4e-9b0c-1d2e3f4a5b6c",
  projectId: "ac41a491-6eb2-48ce-82e8-489897ca63ec",
  repositoryUrl: "https://github.com/example/template",
  active: true,
  createdAt: "2026-10-21T10:00:00Z",
};
const overview = { program, template: null, activeCount: 3 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue({ data: { data: overview } });
});

describe("useDemoSandboxAdmin", () => {
  it("re-reads the overview after the program is saved", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(() => useDemoSandboxAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.isReady).toBe(true));
    const opened = { ...program, activeCap: 25 };
    mocks.setProgram.mockResolvedValue({ data: { data: opened } });
    mocks.read.mockResolvedValue({
      data: { data: { ...overview, program: opened } },
    });
    await act(async () => {
      await view.result.current.updateProgram.mutate(opened);
    });
    await waitFor(() =>
      expect(view.result.current.data?.program.activeCap).toBe(25),
    );
    expect(mocks.setProgram).toHaveBeenCalledWith({
      demoSandboxProgramDto: opened,
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  });

  it("re-reads the overview after the template is designated", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(() => useDemoSandboxAdmin(), { wrapper });
    await waitFor(() => expect(view.result.current.isReady).toBe(true));
    mocks.setTemplate.mockResolvedValue({ data: { data: template } });
    mocks.read.mockResolvedValue({ data: { data: { ...overview, template } } });
    const input = {
      projectId: template.projectId,
      repositoryUrl: template.repositoryUrl,
    };
    await act(async () => {
      await view.result.current.setTemplate.mutate(input);
    });
    await waitFor(() =>
      expect(view.result.current.data?.template).toEqual(template),
    );
    expect(mocks.setTemplate).toHaveBeenCalledWith({
      setDemoTemplateDto: input,
    });
    view.unmount();
    client.clear();
  });
});
