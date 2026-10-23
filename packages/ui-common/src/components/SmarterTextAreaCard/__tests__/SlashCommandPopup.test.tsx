import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SlashCommandPopup } from "../slashCommands/SlashCommandPopup";
import type { Command } from "../slashCommands/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string>) =>
      fallback.replace("{{query}}", values?.query ?? ""),
  }),
}));

const searchCommand: Command = {
  id: "hey-hey-builtin:search",
  name: "search",
  description: "Open advanced search",
  kind: "open-modal",
  source: "hey-hey-builtin",
  argShape: "query",
  modal: "search",
};

describe("SlashCommandPopup", () => {
  it("renders compact command rows without the completion cue in the popup", () => {
    render(<SlashCommandPopup heyHey={[searchCommand]} query="search" />);

    expect(screen.getByTestId("slash-command-row-search")).toHaveTextContent(
      "/search"
    );
    expect(screen.getByTestId("slash-command-row-search")).toHaveTextContent(
      "Open advanced search"
    );
    expect(
      screen.queryByTestId("slash-command-tab-hint")
    ).not.toBeInTheDocument();
  });

  it("renders only the search arg-entry affordance in query mode", () => {
    render(
      <SlashCommandPopup
        heyHey={[searchCommand]}
        mode="arg-entry-query"
        query="billing plan"
      />
    );

    expect(screen.getByTestId("slash-arg-entry-search")).toHaveTextContent(
      "Press Enter to search for: billing plan"
    );
    expect(
      screen.queryByTestId("slash-command-section-hey-hey")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("slash-command-section-native")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("slash-command-row-search")
    ).not.toBeInTheDocument();
  });

  it("does not render a provider-native section", () => {
    render(<SlashCommandPopup heyHey={[searchCommand]} />);

    expect(
      screen.queryByTestId("slash-command-section-native")
    ).not.toBeInTheDocument();
  });

  it("renders unavailable commands as disabled with their explanation", () => {
    render(
      <SlashCommandPopup
        heyHey={[
          {
            id: "hey-hey-builtin:skill",
            name: "skill",
            description: "Use an installed Codex Skill",
            kind: "open-skill-picker",
            source: "hey-hey-builtin",
            argShape: "none",
            picker: "skill-picker",
            availability: {
              state: "disabled",
              reason: "Start a Codex conversation to browse installed Skills.",
            },
          },
        ]}
        query="skill"
      />
    );

    const row = screen.getByTestId("slash-command-row-skill");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveTextContent("Use an installed Codex Skill");
    expect(
      screen.getByTestId("slash-command-disabled-reason")
    ).toHaveTextContent("Start a Codex conversation");
  });
});
