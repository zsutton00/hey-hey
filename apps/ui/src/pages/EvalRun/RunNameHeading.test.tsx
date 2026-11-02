import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalRunReport } from "@hey-hey/ui-common/data";

const mockMutate = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  evalRunName: (run: EvalRunReport) => run.payload.name ?? "generated name",
  useRenameEvalRun: () => ({ mutate: mockMutate, isPending: false }),
}));

import { RunNameHeading } from "./RunNameHeading";

const run = (status: string, name?: string): EvalRunReport =>
  ({
    id: "run-1",
    payload: { reportType: "EVAL_RUN", status, ...(name ? { name } : {}) },
  }) as unknown as EvalRunReport;

const renderHeading = (report: EvalRunReport) =>
  render(<RunNameHeading organizationId="org" projectId="p1" run={report} />);

describe("RunNameHeading", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockMutate.mockResolvedValue(undefined);
  });

  it.each(["RUNNING", "FINISHED"])(
    "renames a run that is %s and returns to the generated name when cleared",
    async (status) => {
      renderHeading(run(status, "Baseline"));
      expect(screen.getByTestId("eval-run-title")).toHaveTextContent(
        "Baseline",
      );

      fireEvent.click(screen.getByTestId("eval-run-rename"));
      const input = screen.getByTestId("eval-run-rename-input");
      expect(input).toHaveValue("Baseline");

      fireEvent.change(input, { target: { value: "  Opus retry  " } });
      fireEvent.click(screen.getByTestId("eval-run-rename-save"));
      await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
      expect(mockMutate.mock.calls[0]![0]).toMatchObject({
        organizationId: "org",
        projectId: "p1",
        name: "  Opus retry  ",
      });

      fireEvent.click(screen.getByTestId("eval-run-rename"));
      fireEvent.change(screen.getByTestId("eval-run-rename-input"), {
        target: { value: "" },
      });
      fireEvent.click(screen.getByTestId("eval-run-rename-save"));
      await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(2));
      expect(mockMutate.mock.calls[1]![0].name).toBe("");
    },
  );

  it("shows the generated name for an unnamed run and leaves the run alone on cancel", () => {
    renderHeading(run("RUNNING"));
    expect(screen.getByTestId("eval-run-title")).toHaveTextContent(
      "generated name",
    );

    fireEvent.click(screen.getByTestId("eval-run-rename"));
    fireEvent.click(screen.getByTestId("eval-run-rename-cancel"));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("eval-run-title")).toBeInTheDocument();
  });

  it("keeps the editor open and shows the error when saving fails", async () => {
    mockMutate.mockRejectedValue(new Error("boom"));
    renderHeading(run("FINISHED", "Baseline"));

    fireEvent.click(screen.getByTestId("eval-run-rename"));
    fireEvent.click(screen.getByTestId("eval-run-rename-save"));

    expect(
      await screen.findByTestId("eval-run-rename-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("eval-run-rename-input")).toBeInTheDocument();
  });
});
