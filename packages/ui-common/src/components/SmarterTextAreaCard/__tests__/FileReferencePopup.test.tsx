import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";
import { FileReferencePopup } from "../fileReferences/FileReferencePopup";

const position = { top: 10, left: 20 };
const renderPopup = (
  state: React.ComponentProps<typeof FileReferencePopup>["state"]
) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <FileReferencePopup state={state} position={position} />
    </ThemeProvider>
  );

describe("FileReferencePopup", () => {
  it("renders distinct loading, empty, and error states", () => {
    const { rerender } = renderPopup({
      status: "loading",
      candidates: [],
      isFetching: true,
    });
    expect(screen.getByText("Loading touched files…")).toBeInTheDocument();

    rerender(
      <ThemeProvider theme={createTheme()}>
        <FileReferencePopup
          position={position}
          state={{ status: "empty", candidates: [], isFetching: false }}
        />
      </ThemeProvider>
    );
    expect(
      screen.getByText(
        "No indexed touched-file evidence exists for this scope."
      )
    ).toBeInTheDocument();

    rerender(
      <ThemeProvider theme={createTheme()}>
        <FileReferencePopup
          position={position}
          state={{
            status: "error",
            candidates: [],
            isFetching: false,
            error: new Error("failed"),
          }}
        />
      </ThemeProvider>
    );
    expect(
      screen.getByText("Couldn’t load touched-file history.")
    ).toBeInTheDocument();
  });

  it("shows candidate identity and commits selectable rows", () => {
    const onSelect = vi.fn();
    render(
      <ThemeProvider theme={createTheme()}>
        <FileReferencePopup
          position={position}
          selectable
          highlightedCandidateKey="service-1:src/components/Editor.tsx"
          onSelect={onSelect}
          state={{
            status: "ready",
            isFetching: false,
            candidates: [
              {
                serviceId: "service-1",
                serviceName: "UI Common",
                normalizedPath: "src/components/Editor.tsx",
              },
            ],
          }}
        />
      </ThemeProvider>
    );

    expect(screen.getByText("Touched-file history")).toBeInTheDocument();
    expect(screen.getByText("UI Common")).toBeInTheDocument();
    expect(screen.getByText("src/components/Editor.tsx")).toBeInTheDocument();
    const row = screen.getByTestId("file-reference-candidate-row");
    expect(row).toHaveAttribute("aria-selected", "true");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
