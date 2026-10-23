import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createNavigationLineageEntry } from "../../types/userTracking";
import {
  CanonicalPageBoundary,
  CanonicalPageProvider,
  createCanonicalPageDescriptor,
  useCurrentCanonicalPage,
  type CanonicalPageComposition,
} from "../CanonicalPageContext";
import { EntityActivationProvider } from "../EntityActivationContext";

const OBSERVATIONAL_COMPOSITION = { kind: "observational" } as const;

const CurrentPageProbe = () => {
  const current = useCurrentCanonicalPage();
  return (
    <div
      data-testid="canonical-page-current"
      data-entity-type={current?.entityType ?? ""}
      data-entity-id={current?.entityId ?? ""}
    />
  );
};

interface TestTreeProps {
  composition: CanonicalPageComposition;
  onEntityActivated: ReturnType<typeof vi.fn>;
  strict?: boolean;
}

const TestTree = ({
  composition,
  onEntityActivated,
  strict = false,
}: TestTreeProps) => {
  const boundary = (
    <CanonicalPageBoundary composition={composition}>
      <div data-testid="canonical-page-boundary" />
    </CanonicalPageBoundary>
  );

  return (
    <EntityActivationProvider sink={{ onEntityActivated }}>
      <CanonicalPageProvider>
        <CurrentPageProbe />
        {strict ? <StrictMode>{boundary}</StrictMode> : boundary}
      </CanonicalPageProvider>
    </EntityActivationProvider>
  );
};

describe("CanonicalPageContext", () => {
  it("suppresses rerenders and data refreshes with equal descriptor values", () => {
    const onEntityActivated = vi.fn();
    const createComposition = (): CanonicalPageComposition => ({
      kind: "canonical",
      descriptor: createCanonicalPageDescriptor("agent_session", "session-1", [
        createNavigationLineageEntry("plan", "plan-1"),
        createNavigationLineageEntry("plan_step", "step-1"),
      ]),
    });
    const { rerender } = render(
      <TestTree
        composition={createComposition()}
        onEntityActivated={onEntityActivated}
      />
    );

    rerender(
      <TestTree
        composition={createComposition()}
        onEntityActivated={onEntityActivated}
      />
    );

    expect(onEntityActivated).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("canonical-page-current")).toHaveAttribute(
      "data-entity-id",
      "session-1"
    );
  });

  it("publishes exactly once for a semantic identity or lineage change", () => {
    const onEntityActivated = vi.fn();
    const initial: CanonicalPageComposition = {
      kind: "canonical",
      descriptor: createCanonicalPageDescriptor("task", "task-1", null),
    };
    const changed: CanonicalPageComposition = {
      kind: "canonical",
      descriptor: createCanonicalPageDescriptor("agent_session", "session-1", [
        createNavigationLineageEntry("task", "task-1"),
      ]),
    };
    const { rerender } = render(
      <TestTree composition={initial} onEntityActivated={onEntityActivated} />
    );

    rerender(
      <TestTree composition={changed} onEntityActivated={onEntityActivated} />
    );

    expect(onEntityActivated).toHaveBeenCalledTimes(2);
    expect(onEntityActivated).toHaveBeenLastCalledWith(changed.descriptor);
  });

  it("republishes when canonical presentation metadata changes", () => {
    const onEntityActivated = vi.fn();
    const composition = (label: string): CanonicalPageComposition => ({
      kind: "canonical",
      descriptor: createCanonicalPageDescriptor(
        "agent_session",
        "session-1",
        null,
        {
          kind: "agent_session",
          label,
          sessionType: "CODING",
        }
      ),
    });
    const { rerender } = render(
      <TestTree
        composition={composition("Old title")}
        onEntityActivated={onEntityActivated}
      />
    );

    rerender(
      <TestTree
        composition={composition("New title")}
        onEntityActivated={onEntityActivated}
      />
    );

    expect(onEntityActivated).toHaveBeenCalledTimes(2);
    expect(onEntityActivated).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presentation: expect.objectContaining({ label: "New title" }),
      })
    );
  });

  it("keeps observational composition out of activation and route identity", () => {
    const onEntityActivated = vi.fn();
    render(
      <TestTree
        composition={OBSERVATIONAL_COMPOSITION}
        onEntityActivated={onEntityActivated}
      />
    );

    expect(onEntityActivated).not.toHaveBeenCalled();
    expect(screen.getByTestId("canonical-page-current")).toHaveAttribute(
      "data-entity-id",
      ""
    );
  });

  it("does not duplicate activation during Strict Mode effect replay", () => {
    const onEntityActivated = vi.fn();
    render(
      <TestTree
        strict
        composition={{
          kind: "canonical",
          descriptor: createCanonicalPageDescriptor("plan", "plan-1", null),
        }}
        onEntityActivated={onEntityActivated}
      />
    );

    expect(onEntityActivated).toHaveBeenCalledTimes(1);
  });

  it("publishes the same descriptor again after a completed canonical lifecycle", async () => {
    const onEntityActivated = vi.fn();
    const canonicalComposition: CanonicalPageComposition = {
      kind: "canonical",
      descriptor: createCanonicalPageDescriptor("task", "task-1", null),
    };
    const { rerender } = render(
      <TestTree
        composition={canonicalComposition}
        onEntityActivated={onEntityActivated}
      />
    );

    rerender(
      <TestTree
        composition={OBSERVATIONAL_COMPOSITION}
        onEntityActivated={onEntityActivated}
      />
    );
    await Promise.resolve();
    rerender(
      <TestTree
        composition={canonicalComposition}
        onEntityActivated={onEntityActivated}
      />
    );

    expect(onEntityActivated).toHaveBeenCalledTimes(2);
  });

  it("prevents stale cleanup from clearing a newer owner", () => {
    const onEntityActivated = vi.fn();
    const first = createCanonicalPageDescriptor("task", "task-1", null);
    const second = createCanonicalPageDescriptor("plan", "plan-2", null);
    const renderOwners = (showFirst: boolean, showSecond: boolean) => (
      <EntityActivationProvider sink={{ onEntityActivated }}>
        <CanonicalPageProvider>
          <CurrentPageProbe />
          {showFirst ? (
            <CanonicalPageBoundary
              composition={{ kind: "canonical", descriptor: first }}
            >
              <div data-testid="first-canonical-owner" />
            </CanonicalPageBoundary>
          ) : null}
          {showSecond ? (
            <CanonicalPageBoundary
              composition={{ kind: "canonical", descriptor: second }}
            >
              <div data-testid="second-canonical-owner" />
            </CanonicalPageBoundary>
          ) : null}
        </CanonicalPageProvider>
      </EntityActivationProvider>
    );
    const { rerender } = render(renderOwners(true, false));

    rerender(renderOwners(true, true));
    rerender(renderOwners(false, true));

    expect(onEntityActivated).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("canonical-page-current")).toHaveAttribute(
      "data-entity-id",
      "plan-2"
    );

    rerender(renderOwners(false, false));
    expect(screen.getByTestId("canonical-page-current")).toHaveAttribute(
      "data-entity-id",
      ""
    );
  });
});
