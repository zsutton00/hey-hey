import { render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import type {
  JourneyMap,
  JourneyStep,
  ServiceNote,
} from "../../api";
import { PLAN_PROPOSAL_BORDER } from "../ProposalDispatchers/proposalRenderOverrides";
import { JourneyView } from "./JourneyView";

const buildNote = (overrides: Partial<ServiceNote> = {}): ServiceNote => ({
  text: "Implementation note",
  serviceId: "service-1",
  serviceName: "Service One",
  ...overrides,
});

const buildStep = (
  overrides: Partial<JourneyStep> & { id: string; title: string }
): JourneyStep => ({
  description: "Step description",
  isUserInteractive: false,
  implementationNotes: [],
  ...overrides,
});

const buildJourneyMap = (steps: JourneyStep[]): JourneyMap => ({ steps });

describe("JourneyView", () => {
  it("renders cards in JourneyMap.steps order with connectors only between adjacent cards", () => {
    const journeyMap = buildJourneyMap([
      buildStep({ id: "step-a", title: "Step A" }),
      buildStep({ id: "step-b", title: "Step B" }),
      buildStep({ id: "step-c", title: "Step C" }),
    ]);

    render(<JourneyView journeyMap={journeyMap} />);

    const container = screen.getByTestId("journey-view");
    const cards = within(container).getAllByTestId(/journey-step-card-/);
    expect(cards.map((card) => card.getAttribute("data-testid"))).toEqual([
      "journey-step-card-step-a",
      "journey-step-card-step-b",
      "journey-step-card-step-c",
    ]);

    const connectors = within(container).getAllByTestId("journey-connector");
    expect(connectors).toHaveLength(2);
  });

  it("renders a single card with no connectors when the journey has one step", () => {
    const journeyMap = buildJourneyMap([
      buildStep({ id: "only", title: "Only" }),
    ]);

    render(<JourneyView journeyMap={journeyMap} />);

    expect(screen.queryAllByTestId("journey-connector")).toHaveLength(0);
    expect(screen.getByTestId("journey-step-card-only")).toBeInTheDocument();
  });

  it("renders the validation badge only when isUserInteractive is true", () => {
    const journeyMap = buildJourneyMap([
      buildStep({
        id: "interactive",
        title: "Interactive",
        isUserInteractive: true,
      }),
      buildStep({
        id: "passive",
        title: "Passive",
        isUserInteractive: false,
      }),
    ]);

    render(<JourneyView journeyMap={journeyMap} />);

    expect(
      screen.getByTestId("journey-step-validation-badge-interactive")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("journey-step-validation-badge-passive")
    ).not.toBeInTheDocument();
  });

  it("renders the service chip only when serviceName is non-null and always renders the note text", () => {
    const journeyMap = buildJourneyMap([
      buildStep({
        id: "step-1",
        title: "Step",
        implementationNotes: [
          buildNote({
            text: "Owned by a service",
            serviceId: "svc-1",
            serviceName: "API Service",
          }),
          buildNote({
            text: "Cross-cutting note",
            serviceId: null,
            serviceName: null,
          }),
        ],
      }),
    ]);

    render(<JourneyView journeyMap={journeyMap} />);

    expect(screen.getByText("Owned by a service")).toBeInTheDocument();
    expect(screen.getByText("API Service")).toBeInTheDocument();
    expect(screen.getByText("Cross-cutting note")).toBeInTheDocument();
  });

  it("applies the plan-generation accent border to each JourneyStepCard", () => {
    const journeyMap = buildJourneyMap([
      buildStep({ id: "border-1", title: "One" }),
      buildStep({ id: "border-2", title: "Two" }),
    ]);

    render(<JourneyView journeyMap={journeyMap} />);

    const cards = screen.getAllByTestId(/journey-step-card-/);
    cards.forEach((card) => {
      expect(card).toHaveStyle({ border: PLAN_PROPOSAL_BORDER });
    });
  });

  it("does not render edit, add, remove, or reorder affordances", () => {
    const journeyMap = buildJourneyMap([
      buildStep({ id: "step-1", title: "Step One" }),
      buildStep({ id: "step-2", title: "Step Two" }),
    ]);

    render(<JourneyView journeyMap={journeyMap} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});
