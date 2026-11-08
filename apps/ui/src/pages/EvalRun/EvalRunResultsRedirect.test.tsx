import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { EvalRunResultsRedirect } from "./EvalRunResultsRedirect";

const RunPage = () => {
  const { pathname, search } = useLocation();
  return <div data-testid="run-page">{`${pathname}${search}`}</div>;
};

describe("EvalRunResultsRedirect", () => {
  it("sends an old results link to the run page, keeping the chosen attempt", () => {
    render(
      <MemoryRouter
        initialEntries={["/projects/p1/evals/e1/runs/r1/results?attempt=a1"]}
      >
        <Routes>
          <Route
            path="projects/:projectId/evals/:evalId/runs/:runId/results"
            element={<EvalRunResultsRedirect />}
          />
          <Route
            path="projects/:projectId/evals/:evalId/runs/:runId"
            element={<RunPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("run-page")).toHaveTextContent(
      "/projects/p1/evals/e1/runs/r1?attempt=a1",
    );
  });
});
