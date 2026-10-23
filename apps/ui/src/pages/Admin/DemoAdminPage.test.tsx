import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { DemoAdminPage } from "./DemoAdminPage";

const mocks = vi.hoisted(() => ({
  useDemoSandboxAdmin: vi.fn(),
  updateProgram: vi.fn(),
  setTemplate: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useDemoSandboxAdmin: mocks.useDemoSandboxAdmin,
  useProjects: () => ({
    projects: [{ id: "project-1", name: "Template project" }],
  }),
}));
vi.mock("@hey-hey/ui-common/context", () => ({
  useOrganization: () => ({ currentOrganization: { id: "org-1" } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const program = {
  activeCap: 10,
  perIpLimit: 2,
  perIpWindowSeconds: 3600,
};
const template = {
  id: "template-1",
  projectId: "project-1",
  repositoryUrl: "https://github.com/example/template",
  active: true,
  createdAt: "2026-10-21T10:00:00Z",
};

const withOverview = (overview: {
  program: typeof program;
  template: typeof template | null;
  activeCount: number;
}) =>
  mocks.useDemoSandboxAdmin.mockReturnValue({
    data: overview,
    error: null,
    isLoading: false,
    updateProgram: { mutate: mocks.updateProgram, isPending: false },
    setTemplate: { mutate: mocks.setTemplate, isPending: false },
  });

describe("DemoAdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOverview({ program, template, activeCount: 3 });
  });

  it("shows counts, limits and template without any on/off switch", () => {
    render(<DemoAdminPage />);

    expect(screen.queryByTestId("demo-admin-enabled")).toBeNull();
    expect(screen.getByTestId("demo-admin-active-count")).toHaveTextContent(
      "3 / 10",
    );
    expect(screen.getByTestId("demo-admin-activeCap")).toHaveValue(10);
    expect(screen.getByTestId("demo-admin-perIpLimit")).toHaveValue(2);
    expect(screen.getByTestId("demo-admin-perIpWindowSeconds")).toHaveValue(
      3600,
    );
    expect(screen.getByTestId("demo-admin-template-current")).toHaveTextContent(
      "Template project · https://github.com/example/template",
    );
    expect(screen.queryByTestId("demo-admin-no-template")).toBeNull();
  });

  it("says so when no template is set", () => {
    withOverview({ program, template: null, activeCount: 0 });
    render(<DemoAdminPage />);

    expect(screen.getByTestId("demo-admin-no-template")).toBeInTheDocument();
    expect(screen.getByTestId("demo-admin-template-current")).toHaveTextContent(
      "admin.demo.template.none",
    );
  });

  it("saves the limits through the program update", async () => {
    mocks.updateProgram.mockResolvedValue(program);
    render(<DemoAdminPage />);

    fireEvent.change(screen.getByTestId("demo-admin-activeCap"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByTestId("demo-admin-save-limits"));
    await waitFor(() =>
      expect(mocks.updateProgram).toHaveBeenCalledWith({
        ...program,
        activeCap: 25,
      }),
    );
  });

  it("shows the re-read values after saving", () => {
    const view = render(<DemoAdminPage />);
    withOverview({
      program: { ...program, activeCap: 25 },
      template,
      activeCount: 3,
    });
    view.rerender(<DemoAdminPage />);

    expect(screen.getByTestId("demo-admin-activeCap")).toHaveValue(25);
  });

  it("shows the server's reason when a repository is rejected", async () => {
    mocks.setTemplate.mockRejectedValue(
      new AxiosError("Bad Request", "400", undefined, undefined, {
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { message: "GitHub repository must exist and be public" },
      }),
    );
    render(<DemoAdminPage />);

    fireEvent.change(screen.getByTestId("demo-admin-template-repository"), {
      target: { value: "https://github.com/example/private" },
    });
    fireEvent.click(screen.getByTestId("demo-admin-save-template"));

    await waitFor(() =>
      expect(screen.getByTestId("demo-admin-error")).toHaveTextContent(
        "GitHub repository must exist and be public",
      ),
    );
    expect(mocks.setTemplate).toHaveBeenCalledWith({
      projectId: "project-1",
      repositoryUrl: "https://github.com/example/private",
    });
  });
});
