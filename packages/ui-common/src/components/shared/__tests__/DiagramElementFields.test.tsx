import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DiagramElementPolicy } from "../../../api";
import {
  DiagramElementFields,
  isValidDiagramElementMetadata,
} from "../DiagramFields";

const policy = {
  roles: [
    { key: "PERSON", label: "Person", notation: "person" },
    { key: "AGENT", label: "Agent", notation: "box" },
  ],
  referenceTargets: [],
} satisfies DiagramElementPolicy;

describe("Diagram element role selection", () => {
  it("selects Agent from the effective policy while retaining Person", () => {
    const onChange = vi.fn();
    render(
      <DiagramElementFields
        value={{ role: "PERSON" }}
        policy={policy}
        organizationId={null}
        projectId={null}
        onChange={onChange}
      />
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Element role" }));
    expect(
      screen.getByRole("option", { name: "Person (person)" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Agent (box)" }));
    expect(onChange).toHaveBeenCalledWith({ role: "AGENT" });
    expect(isValidDiagramElementMetadata({ role: "AGENT" }, policy)).toBe(true);
  });

  it("does not inject Agent into a policy that omits it", () => {
    const override = { ...policy, roles: [policy.roles[0]] };
    render(
      <DiagramElementFields
        value={{ role: "PERSON" }}
        policy={override}
        organizationId={null}
        projectId={null}
        onChange={vi.fn()}
      />
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Element role" }));
    expect(
      screen.queryByRole("option", { name: "Agent (box)" })
    ).not.toBeInTheDocument();
    expect(isValidDiagramElementMetadata({ role: "AGENT" }, override)).toBe(
      false
    );
  });
});
