import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  NavigationType,
} from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ArchiveHistory, workItemId } from "./archiveNavigation";
import {
  useArchiveHistory,
  useArchiveNavigation,
} from "./useArchiveNavigation";

function Page() {
  useArchiveHistory();
  const navigate = useNavigate();
  const archive = useArchiveNavigation("project");
  const location = useLocation();
  return (
    <>
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate("/projects/project/tasks/item")}>
        open
      </button>
      <button onClick={() => navigate("?conversation=other")}>
        conversation
      </button>
      <button onClick={() => navigate("/work-items/item")}>alias</button>
      <button
        onClick={() =>
          window.history.pushState(
            window.history.state,
            "",
            "?conversation=shallow",
          )
        }
      >
        shallow
      </button>
      <button onClick={() => navigate(-1)}>back</button>
      <button onClick={() => navigate(1)}>forward</button>
      <button onClick={() => navigate("/tasks/item", { replace: true })}>
        replace
      </button>
      <button onClick={() => archive("item")}>archive</button>
    </>
  );
}

async function setup(initialEntry: string) {
  window.history.replaceState({}, "", initialEntry);
  render(
    <BrowserRouter>
      <Page />
    </BrowserRouter>,
  );
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
async function at(url: string) {
  await waitFor(() =>
    expect(screen.getByTestId("location").textContent).toBe(url),
  );
}

describe("archive destination with real router history", () => {
  it("returns to the immediately preceding distinct page with its URL state", async () => {
    await setup("/projects/project/features?view=tree");
    click("open");
    await at("/projects/project/tasks/item");
    click("archive");
    await at("/projects/project/features?view=tree");
  });
  it("uses project home for direct entry", async () => {
    await setup("/projects/project/tasks/item");
    click("archive");
    await at("/projects/project");
  });
  it.each(["conversation", "alias"])(
    "rejects same-item %s entries",
    async (variant) => {
      await setup("/projects/project/tasks/item");
      click(variant);
      await at(
        variant === "alias"
          ? "/work-items/item"
          : "/projects/project/tasks/item?conversation=other",
      );
      click("archive");
      await at("/projects/project");
    },
  );
  it("rejects a shallow conversation history entry that bypasses the router", async () => {
    await setup("/projects/project/features");
    click("open");
    await at("/projects/project/tasks/item");
    click("shallow");
    click("archive");
    await at("/projects/project");
  });
  it.each([
    ["step", "/projects/project/plans/plan/stages/stage/steps/item"],
    ["stage", "/projects/project/plans/item/stages/stage"],
  ])(
    "rejects a %s route showing the archived item",
    async (_kind, previousUrl) => {
      await setup(previousUrl);
      click("open");
      await at("/projects/project/tasks/item");
      click("archive");
      await at("/projects/project");
    },
  );
  it("tracks back, forward and replace", async () => {
    await setup("/projects/project/features");
    click("open");
    await at("/projects/project/tasks/item");
    click("conversation");
    await at("/projects/project/tasks/item?conversation=other");
    click("back");
    await at("/projects/project/tasks/item");
    click("forward");
    await at("/projects/project/tasks/item?conversation=other");
    click("replace");
    await at("/tasks/item");
    click("archive");
    await at("/projects/project");
  });
});

describe("work-item identity", () => {
  it.each([
    "/projects/p/tasks/item",
    "/projects/p/features/item",
    "/tasks/item",
    "/work-items/item",
    "/projects/p/tasks/item/conversations/thread",
    "/projects/p/tasks/item/agent-sessions/session",
    "/projects/p/initiatives/i/tasks/item",
    "/projects/p/plans/item",
    "/projects/p/plans/item/stages/stage",
    "/projects/p/plans/plan/stages/stage/steps/item",
  ])("recognizes %s", (url) => expect(workItemId(url)).toBe("item"));
  it("preserves predecessor evidence across reload", () => {
    const history = new ArchiveHistory();
    history.record(
      { key: "a", pathname: "/projects/p", search: "", hash: "", state: null },
      NavigationType.Pop,
    );
    const location = {
      key: "b",
      pathname: "/tasks/item",
      search: "",
      hash: "",
      state: null,
    };
    history.record(location, NavigationType.Push);
    const restored = new ArchiveHistory(
      JSON.parse(JSON.stringify(history.snapshot())),
    );
    restored.record(location, NavigationType.Pop);
    expect(restored.previous("item")).toBe("/projects/p");
  });
});
