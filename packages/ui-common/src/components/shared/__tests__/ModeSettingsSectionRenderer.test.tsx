import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ModeSettingsSectionRenderer } from "../ModeSettingsSectionRenderer";
import {
  isModeSettingsSection,
  readModeProjectAssistantSetting,
  serializeModeSettings,
} from "../modeFilesSection";
import { taskContentToSectionInputs } from "../../../utils/workItemSections";

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: [
      { status: "ACTIVE", definition: { key: "STANDARD" } },
      { status: "ACTIVE", definition: { key: "BUG" } },
      { status: "ARCHIVED", definition: { key: "RETIRED" } },
    ],
  }),
}));

const settings = (enabled: boolean) =>
  JSON.stringify({
    schemaVersion: "project-mode-settings.v1",
    projectAssistant: { enabled },
  });

describe("ModeSettingsSectionRenderer", () => {
  it.each([
    [settings(true), "On", "true"],
    [settings(false), "Off", "false"],
    ["", "On", "true"],
    [undefined, "On", "true"],
  ])(
    "shows the stored Project Assistant choice for %s",
    (content, label, enabled) => {
      render(<ModeSettingsSectionRenderer content={content} />);

      const value = screen.getByTestId("mode-settings-project-assistant");
      expect(value).toHaveTextContent(`Project Assistant: ${label}`);
      expect(value).toHaveAttribute("data-enabled", enabled);
    }
  );

  it("shows the change when a proposal flips the setting", () => {
    render(
      <ModeSettingsSectionRenderer
        content={settings(false)}
        previousContent={settings(true)}
      />
    );

    expect(
      screen.getByTestId("mode-settings-project-assistant")
    ).toHaveTextContent("Project Assistant: On → Off");
  });

  it.each([
    ["not JSON", "{"],
    [
      "unknown version",
      '{"schemaVersion":"v9","projectAssistant":{"enabled":true}}',
    ],
    [
      "non-boolean value",
      '{"schemaVersion":"project-mode-settings.v1","projectAssistant":{"enabled":"yes"}}',
    ],
  ])("fails closed for %s", (_label, content) => {
    render(<ModeSettingsSectionRenderer content={content} />);

    expect(
      screen.getByTestId("mode-settings-section-unavailable")
    ).toBeInTheDocument();
  });

  it("emits the canonical settings value when toggled in the editor", () => {
    const onChange = vi.fn();
    render(<ModeSettingsSectionRenderer content="" onChange={onChange} />);

    const toggle = screen.getByLabelText("Run Project Assistant");
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith(settings(false));
  });
});

describe("ModeSettingsSectionRenderer eligible types", () => {
  const withTypes = (keys: string[]) =>
    JSON.stringify({
      schemaVersion: "project-mode-settings.v1",
      projectAssistant: { enabled: true },
      eligibleWorkItemTypeKeys: keys,
    });

  it("shows the default label when the mode has no list", () => {
    render(<ModeSettingsSectionRenderer content={settings(true)} />);

    expect(
      screen.getByTestId("mode-settings-eligible-types")
    ).toHaveTextContent("Eligible work-item types: Default for all modes");
  });

  it("shows a proposal change to the mode's list", () => {
    render(
      <ModeSettingsSectionRenderer
        content={withTypes(["STANDARD", "BUG"])}
        previousContent={settings(true)}
      />
    );

    expect(
      screen.getByTestId("mode-settings-eligible-types")
    ).toHaveTextContent(
      "Eligible work-item types: Default for all modes → BUG, STANDARD"
    );
  });

  it("keeps the eligible list when Project Assistant is toggled", () => {
    const onChange = vi.fn();
    render(
      <ModeSettingsSectionRenderer
        content={withTypes(["BUG", "STANDARD"])}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByLabelText("Run Project Assistant"));

    expect(onChange).toHaveBeenCalledWith(
      JSON.stringify({
        schemaVersion: "project-mode-settings.v1",
        projectAssistant: { enabled: false },
        eligibleWorkItemTypeKeys: ["BUG", "STANDARD"],
      })
    );
  });

  it("fails closed for an empty eligible list", () => {
    render(<ModeSettingsSectionRenderer content={withTypes([])} />);

    expect(
      screen.getByTestId("mode-settings-section-unavailable")
    ).toBeInTheDocument();
  });
});

describe("MODE settings helpers", () => {
  it("omits an empty eligible list so legacy eligibility is kept", () => {
    expect(serializeModeSettings(true, [])).toBe(settings(true));
    expect(serializeModeSettings(true, ["STANDARD", "BUG"])).toBe(
      JSON.stringify({
        schemaVersion: "project-mode-settings.v1",
        projectAssistant: { enabled: true },
        eligibleWorkItemTypeKeys: ["BUG", "STANDARD"],
      })
    );
  });

  it("only matches the MODE settings JSON section", () => {
    expect(
      isModeSettingsSection({ typeKey: "MODE", key: "settings", kind: "json" })
    ).toBe(true);
    expect(
      isModeSettingsSection({
        typeKey: "STANDARD",
        key: "settings",
        kind: "json",
      })
    ).toBe(false);
    expect(
      isModeSettingsSection({ typeKey: "MODE", key: "files", kind: "json" })
    ).toBe(false);
  });

  it("round-trips the serialized value", () => {
    expect(
      readModeProjectAssistantSetting(serializeModeSettings(false))
    ).toEqual({
      status: "valid",
      enabled: false,
      eligibleWorkItemTypeKeys: null,
    });
  });

  it("omits an unset JSON section from saved section inputs", () => {
    const inputs = taskContentToSectionInputs(
      { description: "A mode.", files: '{"x":1}', settings: "" },
      {
        selection: {
          status: "resolved",
          typeKey: "MODE",
          sections: [
            {
              key: "description",
              label: "Catalog description",
              kind: "markdown",
            },
            { key: "files", label: "Files", kind: "json" },
            { key: "settings", label: "Session settings", kind: "json" },
          ],
        } as never,
      }
    );

    expect(inputs.map(({ key }) => key)).toEqual(["description", "files"]);
  });
});
