import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompleteOnboarding } from "./CompleteOnboarding";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  updateProject: vi.fn(),
  manageSettings: true,
  featureTree: {
    roots: [] as Array<unknown>,
    isLoading: false,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ projectId: "project-1" }),
}));

vi.mock("../../../contexts", () => ({
  usePathService: () => ({
    returnToProject: (projectId: string) => `/projects/${projectId}`,
  }),
}));

vi.mock("../../../hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "organization-1" }),
  useProjectCapabilities: () => ({ manageSettings: mocks.manageSettings }),
}));

vi.mock("../../../clients/client", () => ({
  apiClient: { updateProject: mocks.updateProject },
}));

vi.mock("../../../data/hooks/useFeatureHierarchy", () => ({
  useFeatureHierarchy: () => mocks.featureTree,
}));

const context = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "organization-1",
  interaction: {} as never,
};

describe("CompleteOnboarding", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.updateProject.mockReset();
    mocks.updateProject.mockResolvedValue({});
    mocks.featureTree.roots = [];
    mocks.manageSettings = true;
  });

  it("offers completion only to roles that can change project settings", () => {
    mocks.manageSettings = false;

    render(
      <CompleteOnboarding
        config={{
          field: "complete-onboarding",
          description: "Complete onboarding",
          type: "complete_onboarding",
        }}
        value={false}
        onChange={vi.fn()}
        isSubmitted={false}
        context={context}
      />
    );

    expect(
      screen.queryByTestId("complete-onboarding-button")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("complete-onboarding-not-permitted")
    ).toHaveTextContent("completeOnboarding.notPermitted");
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("opens the Project Overview Daily Session after activating onboarding", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <CompleteOnboarding
        config={{
          field: "complete-onboarding",
          description: "Complete onboarding",
          type: "complete_onboarding",
        }}
        value={false}
        onChange={onChange}
        isSubmitted={false}
        context={context}
      />
    );

    expect(screen.getByTestId("complete-onboarding-button")).toHaveTextContent(
      "completeOnboarding.button.complete"
    );
    await user.click(screen.getByTestId("complete-onboarding-button"));

    expect(mocks.updateProject).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      updateProjectDto: { status: "ACTIVE" },
    });
    expect(onChange).toHaveBeenCalledWith(true);
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/projects/project-1?tab=help",
      { replace: true }
    );
    expect(mocks.navigate).not.toHaveBeenCalledWith(
      expect.stringContaining("daily-session"),
      expect.anything()
    );
  });

  it("renders and completes only the imported hierarchy without activating the project", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mocks.featureTree.roots = [
      {
        feature: { id: "existing-1", name: "Pre-existing Billing" },
        children: [],
      },
    ];

    render(
      <CompleteOnboarding
        config={{
          field: "complete-onboarding",
          description: "Review imported Features",
          type: "complete_onboarding",
          payload: {
            mode: "existing_project_import",
            roots: [
              {
                rootKey: "root-1",
                name: "Order Management",
                description: "Manage orders",
                tag: "product",
                children: [
                  {
                    childKey: "child-1",
                    name: "Order History",
                    description: "Review orders",
                    tag: "frontend",
                  },
                ],
              },
            ],
            placements: [
              {
                rootKey: "root-1",
                target: {
                  kind: "EXISTING_FEATURE",
                  featureId: "orders-parent",
                },
              },
            ],
          } as never,
        }}
        value={false}
        onChange={onChange}
        isSubmitted={false}
        context={context}
      />
    );

    expect(screen.getByText("Imported Feature hierarchy")).toBeInTheDocument();
    expect(screen.getByText("Order Management")).toBeInTheDocument();
    expect(screen.getByText("Order History")).toBeInTheDocument();
    expect(
      screen.getByText("Parent Feature: orders-parent")
    ).toBeInTheDocument();
    expect(screen.queryByText("Pre-existing Billing")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("complete-onboarding-button")
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete Import" }));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("shows import-specific submitted copy", () => {
    render(
      <CompleteOnboarding
        config={{
          field: "complete-onboarding",
          description: "Review imported Features",
          type: "complete_onboarding",
          payload: {
            mode: "existing_project_import",
            roots: [],
            placements: [],
          } as never,
        }}
        value
        isSubmitted
        context={context}
      />
    );

    expect(screen.getByText("Features imported")).toBeInTheDocument();
    expect(
      screen.getByText("The imported Features are now part of this project.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/completeOnboarding/)).not.toBeInTheDocument();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });
});
