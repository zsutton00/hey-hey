import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChangeEvent, ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import { setCapabilityCatalogForTests } from "../capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../../test/capabilityCatalogFixture";
import { FollowupActionModal } from "../FollowupActionModal";
import {
  CODE_REVIEW_SURFACE_ID,
  COMMIT_SURFACE_ID,
  type SurfaceSelection,
} from "../surfaceSelectionMemory";

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

interface MockTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

vi.mock("../../SmarterTextAreaCard", () => ({
  SmarterTextAreaCard: ({
    value,
    onChange,
    placeholder,
    disabled,
  }: MockTextAreaProps) => (
    <textarea
      aria-label="Additional instructions"
      data-testid="followup-instructions"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
        onChange(event.target.value)
      }
    />
  ),
}));

const storageKey = (surfaceId: string) =>
  `hey-hey:agent-selection:${surfaceId}`;

const writeStoredSelection = (
  surfaceId: string,
  selection: SurfaceSelection,
) => {
  localStorage.setItem(storageKey(surfaceId), JSON.stringify(selection));
};

const readStoredSelection = (surfaceId: string): SurfaceSelection =>
  JSON.parse(
    localStorage.getItem(storageKey(surfaceId)) ?? "null",
  ) as SurfaceSelection;

const renderModal = (
  overrides: Partial<ComponentProps<typeof FollowupActionModal>> = {},
) => {
  const props: ComponentProps<typeof FollowupActionModal> = {
    open: true,
    surfaceId: CODE_REVIEW_SURFACE_ID,
    catalogSource: null,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    submitting: false,
    title: "Code Review",
    submitLabel: "Review",
    submittingLabel: "Reviewing...",
    placeholder: "Focus areas",
    ...overrides,
  };
  return {
    ...render(<FollowupActionModal {...props} />),
    props,
  };
};

const openSelect = async (testId: string) => {
  const user = userEvent.setup();
  await user.click(within(screen.getByTestId(testId)).getByRole("combobox"));
  return user;
};

describe("FollowupActionModal", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewport(false);
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
  });

  afterEach(() => {
    cleanup();
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
  });

  it("reads the persisted surface selection when opened", () => {
    const { rerender, props } = renderModal({ open: false });
    writeStoredSelection(CODE_REVIEW_SURFACE_ID, {
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-sonnet-5-5",
      reasoningEffort: "high",
    });

    rerender(<FollowupActionModal {...props} open />);

    expect(
      within(screen.getByTestId("code-review-provider-select")).getByText(
        "Claude Code",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("code-review-model-select")).getByRole(
        "combobox",
      ),
    ).toHaveValue("Sonnet 5.5");
    expect(
      within(screen.getByTestId("code-review-effort-select")).getByText("High"),
    ).toBeInTheDocument();
  });

  it("uses a wide dialog for the coordinated selector row", () => {
    renderModal();

    expect(screen.getByRole("dialog")).toHaveClass("MuiDialog-paperWidthMd");
  });

  it("collapses the selector and opens its editor on mobile", async () => {
    setViewport(true);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "code-review-root" ? 320 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "code-review-full-measure") return 900;
        if (this.dataset.testid === "code-review-chips-measure") return 500;
        return 0;
      },
    );
    renderModal();

    expect(screen.getByTestId("code-review-minimal-summary")).toBeVisible();
    expect(
      screen.queryByTestId("code-review-provider-select"),
    ).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("code-review-minimal-edit"));

    expect(
      screen.getByRole("dialog", { name: "Edit model selection" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("code-review-provider-select")).toBeVisible();
  });

  it("writes selector changes to the surface selection memory", async () => {
    renderModal();

    const user = await openSelect("code-review-provider-select");
    await user.click(
      screen.getByTestId("code-review-provider-option-opencode"),
    );

    expect(readStoredSelection(CODE_REVIEW_SURFACE_ID)).toEqual({
      provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
      model: "glm-5.3",
      reasoningEffort: "low",
    });
  });

  it("forwards instructions and an explicit disabled Fast mode for a supported selection", async () => {
    const onSubmit = vi.fn();
    writeStoredSelection(COMMIT_SURFACE_ID, {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
    });
    renderModal({
      surfaceId: COMMIT_SURFACE_ID,
      title: "Commit Changes",
      submitLabel: "Commit",
      submittingLabel: "Committing...",
      onSubmit,
    });
    const user = userEvent.setup();

    await user.type(
      screen.getByTestId("followup-instructions"),
      " Please squash changes ",
    );
    await user.click(screen.getByRole("button", { name: "Commit" }));

    expect(onSubmit).toHaveBeenCalledWith({
      additionalInstructions: "Please squash changes",
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      fastMode: false,
    });
  });

  it("persists and submits enabled Fast mode for its own surface", async () => {
    const onSubmit = vi.fn();
    writeStoredSelection(CODE_REVIEW_SURFACE_ID, {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      fastMode: false,
    });
    writeStoredSelection(COMMIT_SURFACE_ID, {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      fastMode: false,
    });
    renderModal({ onSubmit });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("code-review-fast-mode-switch"));
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(readStoredSelection(CODE_REVIEW_SURFACE_ID).fastMode).toBe(true);
    expect(readStoredSelection(COMMIT_SURFACE_ID).fastMode).toBe(false);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ fastMode: true }),
    );
  });

  it("clears enabled Fast mode when support is lost and omits it on submit", async () => {
    const onSubmit = vi.fn();
    writeStoredSelection(CODE_REVIEW_SURFACE_ID, {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      fastMode: true,
    });
    renderModal({ onSubmit });

    const user = await openSelect("code-review-provider-select");
    await user.click(
      screen.getByTestId("code-review-provider-option-opencode"),
    );
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(
      screen.queryByTestId("code-review-fast-mode-switch"),
    ).not.toBeInTheDocument();
    expect(readStoredSelection(CODE_REVIEW_SURFACE_ID)).toEqual({
      provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
      model: "glm-5.3",
      reasoningEffort: "low",
      fastMode: false,
    });
    expect(onSubmit).toHaveBeenCalledWith({
      additionalInstructions: undefined,
      provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
      model: "glm-5.3",
      reasoningEffort: "low",
    });
  });

  it("disables the selector and Fast mode while submitting", () => {
    writeStoredSelection(CODE_REVIEW_SURFACE_ID, {
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      fastMode: true,
    });
    renderModal({ submitting: true });

    expect(
      within(screen.getByTestId("code-review-provider-select")).getByRole(
        "combobox",
      ),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(screen.getByTestId("code-review-fast-mode-switch")).getByRole(
        "checkbox",
      ),
    ).toBeDisabled();
  });
});
