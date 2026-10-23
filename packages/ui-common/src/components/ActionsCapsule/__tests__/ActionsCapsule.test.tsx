import React, { useEffect } from "react";
import AddIcon from "@mui/icons-material/Add";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { ActionsCapsule } from "../ActionsCapsule";
import { ActionsCapsuleProvider } from "../ActionsCapsuleProvider";
import { CapsuleActionButton } from "../CapsuleActionButton";
import { ContextIcon } from "../ContextIcon";
import { useActionsCapsule } from "../ActionsCapsuleContext";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import type {
  CapsuleActionRegistration,
  CapsuleActionUnavailableFeedback,
} from "../types";

vi.mock("../useSearchAction", () => ({
  useSearchAction: (): CapsuleActionRegistration => ({
    id: "search",
    label: "Search",
    behavior: "click",
    actionGroup: "conceptual",
    tier: "site",
    order: 20,
    onClick: vi.fn(),
  }),
}));

vi.mock("../../Scratchpad/useScratchpadCapsuleAction", () => ({
  useScratchpadCapsuleAction: () => null,
}));

vi.mock("../../Scratchpad/ScratchpadDropTarget", () => ({
  ScratchpadDropTarget: () => null,
}));

const dndState = {
  activeContent: null,
  activeSourceId: null,
  isDragging: false,
  setActiveContent: vi.fn(),
  setActiveSourceId: vi.fn(),
  setIsDragging: vi.fn(),
};

vi.mock("../../../contexts/DndContext", () => ({
  useDndContextSafe: () => dndState,
}));

const renderContent = vi.fn(() => <div data-testid="expandable-content" />);
const discussClick = vi.fn();

const ExpandableActionRegistrar: React.FC = () => {
  const { registerAction } = useActionsCapsule();
  useEffect(() => {
    registerAction({
      id: "test-expand",
      label: "Test",
      icon: AddIcon,
      behavior: "expand",
      actionGroup: "conceptual",
      tier: "site",
      order: 50,
      renderContent,
    });
  }, [registerAction]);
  return null;
};

const ordinaryActions: CapsuleActionRegistration[] = [
  {
    id: "tab-action",
    label: "Tab action",
    behavior: "click",
    actionGroup: "page",
    tier: "tab",
    order: 0,
    onClick: () => {},
  },
  {
    id: "page-action",
    label: "Page action",
    behavior: "click",
    actionGroup: "page",
    tier: "page",
    order: 0,
    onClick: () => {},
  },
  {
    id: "discuss",
    label: "Discuss",
    icon: ChatBubbleOutlineIcon,
    behavior: "click",
    actionGroup: "page",
    tier: "page",
    order: 90,
    onClick: discussClick,
  },
];

const OrdinaryActionRegistrar: React.FC = () => {
  const { registerAction } = useActionsCapsule();
  useEffect(() => {
    ordinaryActions.forEach(registerAction);
  }, [registerAction]);
  return null;
};

const feedbackRetry = vi.fn();

const FeedbackActionRegistrar: React.FC<{
  feedback: CapsuleActionUnavailableFeedback;
}> = ({ feedback }) => {
  const { registerAction } = useActionsCapsule();
  useEffect(() => {
    registerAction({
      id: "feedback-action",
      label: "Files",
      behavior: "click",
      actionGroup: "page",
      tier: "page",
      order: 10,
      onClick: vi.fn(),
      feedback,
    });
  }, [feedback, registerAction]);
  return null;
};

const buildFeedback = (
  reason: string,
  failureIdentity: string,
): CapsuleActionUnavailableFeedback => ({
  status: "unavailable",
  presentationScope: "action",
  reason,
  errorCode: null,
  retryable: true,
  failureIdentity: { reason: failureIdentity },
  retry: feedbackRetry,
  isRetrying: false,
});

const renderCapsule = () =>
  render(
    <MemoryRouter>
      <ActionsCapsuleProvider>
        <ExpandableActionRegistrar />
        <ActionsCapsule />
      </ActionsCapsuleProvider>
    </MemoryRouter>,
  );

const renderCapsuleWithOrdinaryActions = () =>
  render(
    <MemoryRouter>
      <ActionsCapsuleProvider>
        <OrdinaryActionRegistrar />
        <ActionsCapsule />
      </ActionsCapsuleProvider>
    </MemoryRouter>,
  );

const originalMatchMedia = window.matchMedia;

const setViewport = (mobile: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  feedbackRetry.mockReset();
  discussClick.mockReset();
});

describe("ActionsCapsule", () => {
  it.each(["light", "dark"] as const)(
    "renders an opaque action chip with supplied theme role colors in %s mode",
    (mode) => {
      setViewport(false);
      const theme = createHeyTheme(mode);

      render(
        <ThemeProvider theme={theme}>
          <CapsuleActionButton
            action={{
              id: "discuss",
              label: "Discuss",
              icon: ChatBubbleOutlineIcon,
              iconStyle: {
                backgroundColor: theme.palette.actionable.main,
                color: theme.palette.actionable.contrastText,
              },
              behavior: "click",
              actionGroup: "page",
              tier: "page",
              order: 90,
              onClick: vi.fn(),
            }}
            idx={0}
            isActive={false}
            isAnyExpanded={false}
            onClick={vi.fn()}
          />
        </ThemeProvider>,
      );

      const button = screen.getByTestId("capsule-action-discuss");
      const iconChip = button.querySelector(
        ".MuiButton-startIcon",
      ) as HTMLElement;
      const icon = button.querySelector(
        ".MuiButton-startIcon .MuiSvgIcon-root",
      ) as HTMLElement;

      expect(window.getComputedStyle(iconChip).backgroundColor).toBe(
        "rgb(60, 114, 160)",
      );
      expect(window.getComputedStyle(icon).color).toBe("rgb(255, 255, 255)");
    },
  );

  it("uses theme text color for backgroundless icons in light mode", () => {
    setViewport(false);
    const theme = createTheme({ palette: { mode: "light" } });

    render(
      <ThemeProvider theme={theme}>
        <CapsuleActionButton
          action={{
            id: "run-context",
            label: "Context",
            icon: ContextIcon,
            iconStyle: { backgroundColor: "transparent" },
            behavior: "click",
            actionGroup: "page",
            tier: "page",
            order: 0,
            onClick: vi.fn(),
          }}
          idx={0}
          isActive={false}
          isAnyExpanded={false}
          onClick={vi.fn()}
        />
      </ThemeProvider>,
    );

    const icon = screen
      .getByTestId("capsule-action-run-context")
      .querySelector(".MuiButton-startIcon .MuiSvgIcon-root");

    expect(icon).not.toBeNull();
    expect(window.getComputedStyle(icon as Element).color).toBe(
      theme.palette.text.primary,
    );
  });

  it("keeps white icons on opaque action chips", () => {
    setViewport(false);
    const theme = createTheme({ palette: { mode: "light" } });

    render(
      <ThemeProvider theme={theme}>
        <CapsuleActionButton
          action={{
            id: "opaque-action",
            label: "Opaque",
            icon: AddIcon,
            behavior: "click",
            actionGroup: "page",
            tier: "page",
            order: 0,
            onClick: vi.fn(),
          }}
          idx={0}
          isActive={false}
          isAnyExpanded={false}
          onClick={vi.fn()}
        />
      </ThemeProvider>,
    );

    const icon = screen
      .getByTestId("capsule-action-opaque-action")
      .querySelector(".MuiButton-startIcon .MuiSvgIcon-root");

    expect(icon).not.toBeNull();
    expect(window.getComputedStyle(icon as Element).color).toBe(
      "rgb(255, 255, 255)",
    );
  });

  it("toggles the expandable action closed when its button is clicked while active", () => {
    setViewport(false);
    renderCapsule();

    const button = screen.getByTestId("capsule-action-test-expand");

    // First click expands
    fireEvent.click(button);
    expect(screen.getByTestId("expandable-content")).toBeInTheDocument();

    // Second click on the same active button collapses it
    fireEvent.click(button);
    expect(screen.queryByTestId("expandable-content")).not.toBeInTheDocument();
  });

  it("shows only the corner button on mobile until it is opened", () => {
    setViewport(true);
    renderCapsule();

    expect(
      screen.queryByTestId("actions-capsule-toolbar"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^capsule-action-/)).not.toBeInTheDocument();
    const toggle = screen.getByTestId("capsule-toggle");
    expect(toggle).toHaveAttribute("aria-label", "Open actions");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("capsule-position-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("capsule-minimize-button"),
    ).not.toBeInTheDocument();
  });

  it("opens every action with its label in a wrapping grid, Discuss first", () => {
    setViewport(true);
    renderCapsuleWithOrdinaryActions();

    fireEvent.click(screen.getByTestId("capsule-toggle"));

    const grid = screen.getByTestId("capsule-mobile-grid");
    expect(window.getComputedStyle(grid).display).toBe("grid");
    const actionButtons = screen.getAllByTestId(/^capsule-action-/);
    expect(
      actionButtons.map((button) => button.getAttribute("data-testid")),
    ).toEqual([
      "capsule-action-discuss",
      "capsule-action-tab-action",
      "capsule-action-page-action",
      "capsule-action-search",
    ]);
    const discuss = screen.getByTestId("capsule-action-discuss");
    expect(discuss).toHaveTextContent("Discuss");
    expect(window.getComputedStyle(discuss).whiteSpace).toBe("nowrap");
    expect(window.getComputedStyle(discuss).textOverflow).not.toBe("ellipsis");
    const chip = discuss.querySelector(".MuiButton-startIcon") as HTMLElement;
    expect(window.getComputedStyle(chip).width).toBe("44px");
    expect(window.getComputedStyle(chip).borderRadius).toBe("50%");
    expect(screen.getByTestId("capsule-toggle")).toHaveAttribute(
      "aria-label",
      "Close actions",
    );

    fireEvent.click(discuss);
    expect(discussClick).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("capsule-mobile-grid")).not.toBeInTheDocument();
  });

  it.each([
    ["the toggle", () => fireEvent.click(screen.getByTestId("capsule-toggle"))],
    ["outside", () => fireEvent.click(screen.getByTestId("capsule-scrim"))],
    ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
  ])("closes the mobile capsule via %s", (_label, close) => {
    setViewport(true);
    renderCapsuleWithOrdinaryActions();

    fireEvent.click(screen.getByTestId("capsule-toggle"));
    expect(screen.getByTestId("capsule-mobile-grid")).toBeInTheDocument();
    close();
    expect(screen.queryByTestId("capsule-mobile-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("capsule-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("closes the grid and opens an expand action as a bottom sheet", async () => {
    setViewport(true);
    renderCapsule();

    fireEvent.click(screen.getByTestId("capsule-toggle"));
    fireEvent.click(screen.getByTestId("capsule-action-test-expand"));

    expect(screen.queryByTestId("capsule-mobile-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("expandable-content")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("capsule-expanded-content"), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("expandable-content"),
      ).not.toBeInTheDocument(),
    );
  });

  it("places the mobile button on the saved anchor side", () => {
    setViewport(true);
    localStorage.setItem("capsule-anchor", "bottom-left");
    renderCapsule();

    const capsule = screen.getByTestId("actions-capsule");
    expect(window.getComputedStyle(capsule).left).toBe("16px");
    localStorage.removeItem("capsule-anchor");
  });

  it("keeps the desktop toolbar at its existing height and controls", () => {
    setViewport(false);
    renderCapsule();

    expect(
      window.getComputedStyle(screen.getByTestId("actions-capsule-toolbar"))
        .height,
    ).toBe("82px");
    expect(screen.getByTestId("capsule-position-button")).toBeInTheDocument();
    expect(screen.getByTestId("capsule-minimize-button")).toBeInTheDocument();
  });

  it("keeps an unavailable action clickable and anchors retryable feedback on desktop", async () => {
    setViewport(false);
    render(
      <MemoryRouter>
        <ActionsCapsuleProvider>
          <FeedbackActionRegistrar
            feedback={buildFeedback(
              "The selected machine is unavailable.",
              "failure-1",
            )}
          />
          <ActionsCapsule />
        </ActionsCapsuleProvider>
      </MemoryRouter>,
    );

    const action = screen.getByTestId("capsule-action-feedback-action");
    expect(action).toBeEnabled();
    fireEvent.click(action);

    expect(
      screen.getByTestId("capsule-action-feedback-surface"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The selected machine is unavailable."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("capsule-action-feedback-retry"));
    expect(feedbackRetry).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId("capsule-action-feedback-hide"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("capsule-action-feedback-surface"),
      ).not.toBeInTheDocument(),
    );
  });

  it("renders the same feedback in the mobile bottom-sheet position", async () => {
    setViewport(true);
    render(
      <MemoryRouter>
        <ActionsCapsuleProvider>
          <FeedbackActionRegistrar
            feedback={buildFeedback(
              "The protected read timed out.",
              "failure-1",
            )}
          />
          <ActionsCapsule />
        </ActionsCapsuleProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("capsule-toggle"));
    fireEvent.click(screen.getByTestId("capsule-action-feedback-action"));
    expect(
      screen.getByTestId("capsule-action-feedback-surface"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The protected read timed out."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("capsule-action-feedback-hide"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("capsule-action-feedback-surface"),
      ).not.toBeInTheDocument(),
    );
  });

  it("reopens feedback when the failure identity changes", async () => {
    setViewport(false);
    const rendered = render(
      <MemoryRouter>
        <ActionsCapsuleProvider>
          <FeedbackActionRegistrar
            feedback={buildFeedback("The first read failed.", "failure-1")}
          />
          <ActionsCapsule />
        </ActionsCapsuleProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("capsule-action-feedback-action"));
    fireEvent.click(screen.getByTestId("capsule-action-feedback-hide"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("capsule-action-feedback-surface"),
      ).not.toBeInTheDocument(),
    );

    rendered.rerender(
      <MemoryRouter>
        <ActionsCapsuleProvider>
          <FeedbackActionRegistrar
            feedback={buildFeedback(
              "The retry failed differently.",
              "failure-2",
            )}
          />
          <ActionsCapsule />
        </ActionsCapsuleProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("capsule-action-feedback-surface"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The retry failed differently."),
    ).toBeInTheDocument();
  });
});
