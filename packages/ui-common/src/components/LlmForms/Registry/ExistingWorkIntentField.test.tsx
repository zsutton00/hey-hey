import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExistingWorkIntentField } from "./ExistingWorkIntentField";
import type { FieldConfig } from "./types";

const config: FieldConfig = {
  field: "repository_grounding_intent",
  description:
    "Do you have an existing body of work you’d like Hey Hey to use to understand this project?",
  type: "repository_grounding_intent",
  required: true,
};

const context = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "organization-1",
  interaction: {},
};

describe("ExistingWorkIntentField", () => {
  it("renders the two setup paths and their explanatory copy", () => {
    render(
      <ExistingWorkIntentField
        config={config}
        context={context}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByRole("heading", {
        name: "How would you like to setup your project? You can answer questions (this takes 5-10 minutes) and we will generate a bootstrapped set of Features for you. Or can you start your project now, then import your existing service(s) and we'll analyze them for Features *",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Import existing work" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Describe your project" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create your project immediately. After you've completed your local setup, Hey Hey can import your project and help you create your features"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Hey Hey asks questions and uses your answers to bootstrap your project's initial features."
      )
    ).toBeInTheDocument();
  });

  it("emits the typed choice and supports keyboard navigation", () => {
    const onChange = vi.fn();
    render(
      <ExistingWorkIntentField
        config={config}
        context={context}
        onChange={onChange}
        isSubmitted={false}
      />
    );

    const importOption = screen.getByRole("radio", {
      name: "Import existing work",
    });
    expect(importOption).toHaveAttribute(
      "aria-describedby",
      "existing-work-intent-description-yes"
    );
    fireEvent.click(importOption);
    expect(onChange).toHaveBeenCalledWith({ choice: "yes" });
    expect(importOption).toHaveAttribute("aria-checked", "false");

    fireEvent.keyDown(importOption, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ choice: "no" });
  });

  it("keeps a submitted selection read-only", () => {
    const onChange = vi.fn();
    render(
      <ExistingWorkIntentField
        config={config}
        context={context}
        value={{ choice: "yes" }}
        onChange={onChange}
        isSubmitted
      />
    );

    const importOption = screen.getByRole("radio", {
      name: "Import existing work",
    });
    expect(importOption).toHaveAttribute("aria-checked", "true");
    expect(importOption).toBeDisabled();
    fireEvent.click(importOption);
    expect(onChange).not.toHaveBeenCalled();
  });
});
