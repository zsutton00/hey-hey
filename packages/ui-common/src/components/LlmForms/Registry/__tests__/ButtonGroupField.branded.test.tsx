import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandedAppearanceProvider } from "../../../BrandedFrame";
import { SubmitButton } from "../../../SubmitButton";
import { ButtonGroupField } from "../ButtonGroupField";
import type { FieldConfig } from "../types";

const config: FieldConfig = {
  field: "team_size",
  description: "What is your team size for this project?",
  type: "button_group",
  required: true,
  options: ["Solo (1 person)", "Small team (2–5 people)"],
};

const context = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "organization-1",
};

describe("onboarding answer chips on the branded frame", () => {
  it("exposes the selected answer to assistive technology and fills it white", () => {
    render(
      <BrandedAppearanceProvider value>
        <ButtonGroupField
          config={config}
          value="Small team (2–5 people)"
          context={context}
          isSubmitted={false}
        />
      </BrandedAppearanceProvider>,
    );

    const selected = screen.getByRole("button", {
      name: "Small team (2–5 people)",
    });
    const other = screen.getByRole("button", { name: "Solo (1 person)" });

    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(getComputedStyle(selected).backgroundColor).toBe(
      "rgb(255, 255, 255)",
    );
    expect(getComputedStyle(other).backgroundColor).not.toBe(
      "rgb(255, 255, 255)",
    );
  });

  it("renders Send as the white primary button", () => {
    render(
      <BrandedAppearanceProvider value>
        <SubmitButton>Send</SubmitButton>
      </BrandedAppearanceProvider>,
    );

    expect(
      getComputedStyle(screen.getByRole("button", { name: "Send" }))
        .backgroundColor,
    ).toBe("rgb(255, 255, 255)");
  });
});
