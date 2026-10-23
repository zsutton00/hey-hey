import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CliReadChangedFileInventoryEntryStatusEnum,
  type CliReadChangedFileDetail,
  type CliReadChangedFileInventoryEntry,
} from "../../../../api";
import { CollatedFileDiffModal } from "../CollatedFileDiffModal";

const fullFileSplitViewSpy = vi.hoisted(() => vi.fn());

vi.mock("../FullFileSplitView", () => ({
  DIFF_PRESENTATION_MODES: {
    sideBySide: "side-by-side",
    vertical: "vertical",
  },
  FullFileSplitView: (props: Record<string, unknown>) => {
    fullFileSplitViewSpy(props);
    return <div data-testid="full-file-split-view" />;
  },
}));

const originalMatchMedia = window.matchMedia;
const PRESENTATION_MODE_STORAGE_KEY = "diffViewer.presentationMode";
let phoneViewport = false;

const entries: CliReadChangedFileInventoryEntry[] = [
  {
    serviceId: "service-one",
    repoPath: "/workspace/service-one",
    filePath: "src/alpha.ts",
    status: CliReadChangedFileInventoryEntryStatusEnum.Modify,
  },
  {
    serviceId: "service-two",
    repoPath: "/workspace/service-two",
    filePath: "src/beta.ts",
    status: CliReadChangedFileInventoryEntryStatusEnum.Create,
  },
];

const detail: CliReadChangedFileDetail = {
  serviceId: "service-one",
  repoPath: "/workspace/service-one",
  filePath: "src/alpha.ts",
  preContent: "const value = 1;",
  postContent: "const value = 2;",
};

const serviceNamesState = {
  status: "ready" as const,
  serviceNamesById: new Map([
    ["service-one", "Service One"],
    ["service-two", "Service Two"],
  ]),
};

const renderModal = (overrides?: {
  open?: boolean;
  onSelect?: (identity: string) => void;
}) =>
  render(
    <CollatedFileDiffModal
      open={overrides?.open ?? true}
      onClose={vi.fn()}
      entries={entries}
      selectedIdentity={
        "service-one\u0000/workspace/service-one\u0000src/alpha.ts"
      }
      onSelect={overrides?.onSelect ?? vi.fn()}
      detail={detail}
      detailState={{ status: "ready" }}
      onRetryDetail={vi.fn()}
      readState={{ status: "ready" }}
      onRetry={vi.fn()}
      serviceNamesState={serviceNamesState}
    />
  );

describe("CollatedFileDiffModal responsive composition", () => {
  beforeEach(() => {
    fullFileSplitViewSpy.mockClear();
    localStorage.removeItem(PRESENTATION_MODE_STORAGE_KEY);
    phoneViewport = false;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: phoneViewport && query.includes("max-width"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(PRESENTATION_MODE_STORAGE_KEY);
    window.matchMedia = originalMatchMedia;
  });

  it("starts with a full-width file list on a phone and reveals one detail surface", async () => {
    phoneViewport = true;
    const onSelect = vi.fn();
    renderModal({ onSelect });

    expect(
      screen.getByTestId("collated-file-diff-modal-paper")
    ).toHaveAttribute("data-layout", "phone");
    expect(
      screen.getByTestId("collated-file-diff-modal-file-list")
    ).toBeVisible();
    expect(
      screen.queryByTestId("collated-file-diff-modal-diff-view")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("collated-file-diff-modal-resize-handle")
    ).not.toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getAllByTestId("collated-file-diff-modal-file-row")[0]);

    expect(onSelect).toHaveBeenCalledWith(
      "service-one\u0000/workspace/service-one\u0000src/alpha.ts"
    );
    expect(
      screen.queryByTestId("collated-file-diff-modal-file-list")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("collated-file-diff-modal-diff-view")
    ).toBeVisible();
    expect(screen.getByTestId("full-file-split-view")).toBeVisible();
    expect(
      screen.queryByTestId("collated-file-diff-modal-presentation-selector")
    ).not.toBeInTheDocument();
    expect(fullFileSplitViewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentationMode: "vertical" })
    );

    await userEvent
      .setup()
      .click(screen.getByTestId("collated-file-diff-modal-back-to-files"));
    expect(
      screen.getByTestId("collated-file-diff-modal-file-list")
    ).toBeVisible();
  });

  it("uses the same keyboard selection outcome after filtering", async () => {
    phoneViewport = true;
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderModal({ onSelect });

    await user.type(screen.getByLabelText("Filter files"), "beta");
    const filteredRow = screen.getByTestId("collated-file-diff-modal-file-row");
    expect(filteredRow).toHaveAttribute("data-service-id", "service-two");
    act(() => filteredRow.focus());
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith(
      "service-two\u0000/workspace/service-two\u0000src/beta.ts"
    );
    expect(
      screen.getByTestId("collated-file-diff-modal-diff-view")
    ).toBeVisible();
  });

  it("keeps file labels and file actions separate from row activation", () => {
    phoneViewport = true;
    renderModal();

    expect(screen.getByText("alpha.ts")).toBeVisible();
    expect(screen.getByText("src/alpha.ts")).toBeVisible();
    expect(screen.getAllByTestId("file-reference")).toHaveLength(2);
    expect(screen.queryByTestId("file-reference-link")).not.toBeInTheDocument();
  });

  it("preserves the desktop two-pane composition and resize control", () => {
    renderModal();

    expect(
      screen.getByTestId("collated-file-diff-modal-paper")
    ).toHaveAttribute("data-layout", "desktop");
    expect(
      screen.getByTestId("collated-file-diff-modal-file-list")
    ).toBeVisible();
    expect(
      screen.getByTestId("collated-file-diff-modal-diff-view")
    ).toBeVisible();
    expect(
      screen.getByTestId("collated-file-diff-modal-resize-handle")
    ).toBeVisible();
    expect(
      screen.queryByTestId("collated-file-diff-modal-back-to-files")
    ).not.toBeInTheDocument();
    const presentationSelector = screen.getByTestId(
      "collated-file-diff-modal-presentation-selector"
    );
    expect(presentationSelector).toBeVisible();
    const presentationButtons = Array.from(
      presentationSelector.querySelectorAll("button")
    );
    expect(presentationButtons.map((button) => button.textContent)).toEqual([
      "Inline",
      "Side-by-side",
    ]);
    expect(presentationButtons.every((button) => button.querySelector("svg"))).toBe(
      true
    );
    expect(fullFileSplitViewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentationMode: "side-by-side" })
    );
  });

  it("restores the validated desktop presentation across modal remounts", () => {
    localStorage.setItem(PRESENTATION_MODE_STORAGE_KEY, "vertical");

    const firstRender = renderModal();
    expect(fullFileSplitViewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentationMode: "vertical" })
    );

    firstRender.unmount();
    fullFileSplitViewSpy.mockClear();
    renderModal();

    expect(fullFileSplitViewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentationMode: "vertical" })
    );
  });

  it("falls back to side-by-side when the stored presentation is invalid", () => {
    localStorage.setItem(PRESENTATION_MODE_STORAGE_KEY, "unsupported");

    renderModal();

    expect(fullFileSplitViewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentationMode: "side-by-side" })
    );
    expect(
      screen.getByTestId("collated-file-diff-modal-presentation-side-by-side")
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps phone presentation inline regardless of the stored desktop mode", async () => {
    localStorage.setItem(PRESENTATION_MODE_STORAGE_KEY, "side-by-side");
    phoneViewport = true;

    renderModal();
    await userEvent
      .setup()
      .click(screen.getAllByTestId("collated-file-diff-modal-file-row")[0]);

    expect(fullFileSplitViewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentationMode: "vertical" })
    );
  });

  it("switches desktop presentation without selecting or reading another file", async () => {
    const onSelect = vi.fn();
    renderModal({ onSelect });

    const inlineMode = screen.getByTestId(
      "collated-file-diff-modal-presentation-inline"
    );
    await userEvent.setup().click(inlineMode);

    expect(inlineMode).toHaveAttribute("aria-pressed", "true");
    expect(fullFileSplitViewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filePath: detail.filePath,
        preContent: detail.preContent,
        postContent: detail.postContent,
        presentationMode: "vertical",
      })
    );
    expect(localStorage.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe(
      "vertical"
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps storage failures from breaking presentation rendering or changes", async () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(() => renderModal()).not.toThrow();
    expect(fullFileSplitViewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentationMode: "side-by-side" })
    );

    getItemSpy.mockRestore();
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    await expect(
      userEvent
        .setup()
        .click(screen.getByTestId("collated-file-diff-modal-presentation-inline"))
    ).resolves.toBeUndefined();
    expect(fullFileSplitViewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentationMode: "vertical" })
    );
    expect(setItemSpy).toHaveBeenCalled();
  });

  it("resets phone navigation and filtering after the dialog closes", async () => {
    phoneViewport = true;
    const { rerender } = renderModal();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Filter files"), "beta");
    await user.click(screen.getByTestId("collated-file-diff-modal-file-row"));

    rerender(
      <CollatedFileDiffModal
        open={false}
        onClose={vi.fn()}
        entries={entries}
        selectedIdentity={
          "service-one\u0000/workspace/service-one\u0000src/alpha.ts"
        }
        onSelect={vi.fn()}
        detail={detail}
        detailState={{ status: "ready" }}
        onRetryDetail={vi.fn()}
        readState={{ status: "ready" }}
        onRetry={vi.fn()}
        serviceNamesState={serviceNamesState}
      />
    );
    rerender(
      <CollatedFileDiffModal
        open
        onClose={vi.fn()}
        entries={entries}
        selectedIdentity={
          "service-one\u0000/workspace/service-one\u0000src/alpha.ts"
        }
        onSelect={vi.fn()}
        detail={detail}
        detailState={{ status: "ready" }}
        onRetryDetail={vi.fn()}
        readState={{ status: "ready" }}
        onRetry={vi.fn()}
        serviceNamesState={serviceNamesState}
      />
    );

    expect(screen.getByLabelText("Filter files")).toHaveValue("");
    expect(
      screen.getByTestId("collated-file-diff-modal-file-list")
    ).toBeVisible();
  });
});
