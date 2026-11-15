import { fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  FeatureSyncReportSourceType,
  ReportAudience,
  ReportType,
  type FeatureSyncDecisionReportPayloadV1,
  type FeatureSyncDecisionReportPayloadV2,
  type ReportDtoFeatureSyncDecisionV1,
  type ReportDtoFeatureSyncDecisionV2,
} from "../../../api";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import {
  FeatureSyncDecisionReport,
  parseFeatureSyncDecisionResponse,
  serializeFeatureSyncDecisionResponse,
} from "./FeatureSyncDecisionReport";

vi.mock("../../SmarterTextAreaCard", () => ({
  SmarterTextAreaCard: ({
    disabled,
    mentionConversationId,
    onChange,
    placeholder,
    value,
  }: {
    disabled?: boolean;
    mentionConversationId?: string;
    onChange: (value: string) => void;
    placeholder?: string;
    value: string;
  }) => (
    <textarea
      data-testid="smarter-textarea-input"
      data-conversation-id={mentionConversationId}
      disabled={disabled}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const sharedEntity = {
  entityType: "task" as const,
  entityId: "task-shared",
  title: "Shared task",
};

const payload: FeatureSyncDecisionReportPayloadV2 = {
  reportType: "FEATURE_SYNC_DECISION",
  summary: "Review the independent Feature Sync decisions.",
  decisionGroups: [
    {
      id: "group-one",
      affectedEntities: [
        sharedEntity,
        sharedEntity,
        {
          entityType: "feature",
          entityId: "feature-one",
          title: "Reports",
        },
      ],
      title: "Reports presentation",
      summary: "Choose how the report surface should evolve.",
      choices: [
        {
          id: "group-one-update",
          label: "Update the presentation",
          description: "Keep the existing report contract.",
          isNoChange: false,
        },
        {
          id: "group-one-no-change",
          label: "Leave unchanged",
          isNoChange: true,
        },
      ],
    },
    {
      id: "group-two",
      affectedEntities: [sharedEntity],
      title: "Reports interaction",
      summary: "Choose whether the response should continue conversationally.",
      choices: [
        {
          id: "group-two-conversation",
          label: "Continue in conversation",
          description:
            "Reply with @[task:task-shared|Shared task] context when needed.",
          isNoChange: false,
        },
        {
          id: "group-two-no-change",
          label: "No change",
          isNoChange: true,
        },
      ],
    },
  ],
};

const report: ReportDtoFeatureSyncDecisionV2 = {
  id: "feature-sync-decision-v2",
  organizationId: "org-1",
  audience: ReportAudience.ProjectVisible,
  title: "Feature Sync decision",
  version: 1,
  schemaVersion: 2,
  createdAt: "2026-09-04T00:00:00.000Z",
  expiresAt: "2026-10-04T00:00:00.000Z",
  entities: [],
  reportType: ReportType.FeatureSyncDecision,
  payload,
};

const legacyPayload: FeatureSyncDecisionReportPayloadV1 = {
  reportType: "FEATURE_SYNC_DECISION",
  summary: "Review the legacy Feature Sync discrepancies.",
  discrepancies: [
    {
      sourceType: FeatureSyncReportSourceType.Task,
      source: {
        entityType: FeatureSyncReportSourceType.Task,
        entityId: "legacy-task",
        title: "Legacy renderer task",
      },
      description: "The legacy renderer still needs a review.",
    },
  ],
  reconciliationOptions: [
    {
      description: "Update the legacy renderer task.",
      discrepancyIndices: [0],
    },
  ],
};

const legacyReport: ReportDtoFeatureSyncDecisionV1 = {
  ...report,
  id: "feature-sync-decision-v1",
  payload: legacyPayload,
  schemaVersion: 1,
};

const REASON_SHARED = "Both groups change how this task is scoped.";
const REASON_REPORTS = "The feature promises the current report contract.";

// A V2 report as written after the reason field was added: some entities
// carry a reason, others do not.
const payloadWithReasons: FeatureSyncDecisionReportPayloadV2 = {
  ...payload,
  decisionGroups: payload.decisionGroups.map((group) => ({
    ...group,
    affectedEntities: group.affectedEntities.map((entity) => {
      if (entity.entityId === "task-shared") {
        return { ...entity, reason: REASON_SHARED };
      }
      if (entity.entityId === "feature-one") {
        return { ...entity, reason: REASON_REPORTS };
      }
      return entity;
    }),
  })),
};

const themed =
  (mode: "light" | "dark" = "light") =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <ThemeProvider theme={createHeyTheme(mode)}>{children}</ThemeProvider>
    </MemoryRouter>
  );

const renderReport = (
  interaction?: ComponentProps<typeof FeatureSyncDecisionReport>["interaction"],
  reportPayload: FeatureSyncDecisionReportPayloadV2 = payload,
  mode: "light" | "dark" = "light",
) =>
  render(
    <FeatureSyncDecisionReport
      interaction={interaction}
      payload={reportPayload}
      report={{ ...report, payload: reportPayload }}
      reportTestId="feature-sync-decision-test"
    />,
    { wrapper: themed(mode) },
  );

describe("FeatureSyncDecisionReport", () => {
  it("renders the card hierarchy with each group summary before its affected entities", () => {
    renderReport();

    const prefix = "feature-sync-decision-test-feature-sync-decision";
    expect(screen.getByTestId(`${prefix}-summary`)).toHaveTextContent(
      "Review the independent Feature Sync decisions.",
    );
    expect(screen.queryByTestId(`${prefix}-overview`)).not.toBeInTheDocument();

    const groups = screen.getAllByTestId(`${prefix}-group-card`);
    expect(groups).toHaveLength(2);
    expect(
      within(groups[0]).getByTestId(`${prefix}-group-title`),
    ).toHaveTextContent("Reports presentation");
    expect(
      within(groups[1]).getByTestId(`${prefix}-group-title`),
    ).toHaveTextContent("Reports interaction");

    expect(
      within(groups[0]).getAllByTestId(`${prefix}-group-entities`)[0],
    ).toHaveTextContent("Shared task");
    expect(within(groups[0]).getByText("Reports")).toBeInTheDocument();
    expect(
      within(groups[1]).getByTestId(`${prefix}-group-entities`),
    ).toHaveTextContent("Shared task");
    const affectedEntities = within(groups[0]).getByTestId(
      `${prefix}-group-entities`,
    );
    const groupSummary = within(groups[0]).getByTestId(
      `${prefix}-group-summary`,
    );
    expect(groupSummary).toHaveTextContent(
      "Choose how the report surface should evolve.",
    );
    expect(
      groupSummary.compareDocumentPosition(affectedEntities) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const firstChoice = within(groups[0]).getAllByTestId(`${prefix}-choice`)[0];
    const choiceDescription = within(firstChoice).getByTestId(
      `${prefix}-choice-description`,
    );
    const choiceLabel = within(firstChoice).getByTestId(
      `${prefix}-choice-label`,
    );
    expect(
      choiceDescription.compareDocumentPosition(choiceLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const groupEntityBadges = within(
      within(groups[0]).getByTestId(`${prefix}-group-entities`),
    ).getAllByTestId("mention-badge");
    expect(groupEntityBadges).toHaveLength(2);
    expect(
      groupEntityBadges.every((badge) => badge.querySelector("svg") !== null),
    ).toBe(true);
    expect(
      groupEntityBadges.map((badge) => ({
        entityId: badge.getAttribute("data-entity-id"),
        entityName: badge.getAttribute("data-entity-name"),
        entityType: badge.getAttribute("data-entity-type"),
      })),
    ).toEqual([
      {
        entityId: "task-shared",
        entityName: "Shared task",
        entityType: "task",
      },
      {
        entityId: "feature-one",
        entityName: "Reports",
        entityType: "feature",
      },
    ]);
    expect(
      within(
        within(groups[1]).getByTestId(`${prefix}-group-entities`),
      ).getAllByTestId("mention-badge"),
    ).toHaveLength(1);
    expect(
      within(groups[0])
        .getAllByTestId(`${prefix}-choice-label`)
        .map((label) => label.textContent),
    ).toEqual(["Update the presentation", "Leave unchanged"]);
    expect(
      within(groups[0])
        .getAllByTestId(`${prefix}-choice-description`)
        .map((description) => description.textContent),
    ).toEqual(["Keep the existing report contract."]);
    expect(
      within(groups[0])
        .getAllByTestId(`${prefix}-choice`)
        .map((choice) => choice.getAttribute("data-choice-index")),
    ).toEqual(["0", "1"]);
  });

  it("renders no controls in a standalone viewer while preserving mention-aware prose", () => {
    renderReport();

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(
      screen.queryByTestId(
        "feature-sync-decision-test-feature-sync-decision-submit-button",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("mention-badge")
        .filter(
          (badge) => badge.getAttribute("data-entity-id") === "task-shared",
        ),
    ).toHaveLength(3);
    expect(screen.getByText("No change")).toBeInTheDocument();
  });

  it("centers label-only options at body size and keeps described options top-aligned with a caption label", () => {
    renderReport({
      conversationId: "feature-sync-conversation",
      disabled: false,
      parentMessageId: "feature-sync-message",
      submit: vi.fn(),
    });

    const prefix = "feature-sync-decision-test-feature-sync-decision";
    const [described, labelOnly] = screen
      .getAllByTestId(`${prefix}-choice`)
      .slice(0, 2);

    expect(getComputedStyle(described).alignItems).toBe("flex-start");
    expect(
      within(described).getByTestId(`${prefix}-choice-description`),
    ).toBeInTheDocument();
    expect(
      within(described).getByTestId(`${prefix}-choice-label`).className,
    ).toContain("MuiTypography-caption");

    expect(getComputedStyle(labelOnly).alignItems).toBe("center");
    expect(
      within(labelOnly).queryByTestId(`${prefix}-choice-description`),
    ).not.toBeInTheDocument();
    expect(
      within(labelOnly).getByTestId(`${prefix}-choice-label`).className,
    ).toContain("MuiTypography-body2");
  });

  it("stages one choice per group, validates all groups, and submits one ordered response", () => {
    const submit = vi.fn();
    renderReport({
      conversationId: "feature-sync-conversation",
      disabled: false,
      parentMessageId: "feature-sync-message",
      submit,
    });

    const prefix = "feature-sync-decision-test-feature-sync-decision";
    const submitButton = screen.getByTestId(`${prefix}-submit-button`);
    const radios = screen.getAllByRole("radio");
    const writableGroupEntityBadges = within(
      screen.getAllByTestId(`${prefix}-group-card`)[0],
    ).getAllByTestId("mention-badge");

    expect(radios).toHaveLength(4);
    expect(writableGroupEntityBadges).toHaveLength(2);
    expect(
      writableGroupEntityBadges.every(
        (badge) => badge.querySelector("svg") !== null,
      ),
    ).toBe(true);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(
      true,
    );
    expect(submitButton).toBeDisabled();
    expect(
      screen.getByTestId(`${prefix}-free-form-guidance`),
    ).toHaveTextContent("free-form guidance");

    fireEvent.click(radios[0]);
    expect(submitButton).toBeDisabled();
    fireEvent.click(radios[3]);
    expect(submitButton).toBeEnabled();

    fireEvent.click(submitButton);

    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith(
      "Reports presentation: Update the presentation\nReports interaction: No change",
      "feature-sync-message",
    );
  });

  it("serializes only complete, valid selections without changing producer order", () => {
    expect(
      serializeFeatureSyncDecisionResponse(payload.decisionGroups, {
        "group-one": "group-one-no-change",
      }),
    ).toBeNull();
    expect(
      serializeFeatureSyncDecisionResponse(payload.decisionGroups, {
        "group-one": "unknown-choice",
        "group-two": "group-two-no-change",
      }),
    ).toBeNull();
    expect(
      serializeFeatureSyncDecisionResponse(payload.decisionGroups, {
        "group-one": "group-one-no-change",
        "group-two": "group-two-conversation",
      }),
    ).toBe(
      "Reports presentation: Leave unchanged\nReports interaction: Continue in conversation",
    );
    expect(
      serializeFeatureSyncDecisionResponse(
        payload.decisionGroups,
        {
          "group-one": "group-one-no-change",
          "group-two": "group-two-conversation",
        },
        "  Keep the existing response wording.  ",
      ),
    ).toBe(
      "Reports presentation: Leave unchanged\nReports interaction: Continue in conversation\n\nGeneral notes:\nKeep the existing response wording.",
    );
    expect(
      serializeFeatureSyncDecisionResponse(
        payload.decisionGroups,
        {
          "group-one": "group-one-no-change",
          "group-two": "group-two-conversation",
        },
        "   ",
      ),
    ).toBe(
      "Reports presentation: Leave unchanged\nReports interaction: Continue in conversation",
    );
  });

  it("keeps notes optional, uses the conversation editor context, and submits notes with the selections", () => {
    const submit = vi.fn();
    renderReport({
      conversationId: "feature-sync-conversation",
      disabled: false,
      parentMessageId: "feature-sync-message-with-notes",
      submit,
    });

    const prefix = "feature-sync-decision-test-feature-sync-decision";
    const summary = screen.getByTestId(`${prefix}-summary`);
    const decisions = screen.getByTestId(`${prefix}-groups-list`);
    const notes = screen.getByTestId(`${prefix}-notes`);
    const guidance = screen.getByTestId(`${prefix}-free-form-guidance`);
    const submitButton = screen.getByTestId(`${prefix}-submit-button`);

    expect(
      summary.compareDocumentPosition(decisions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      decisions.compareDocumentPosition(notes) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      notes.compareDocumentPosition(guidance) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId(`${prefix}-notes-label`)).toHaveTextContent(
      "General notes (optional)",
    );
    expect(screen.getByTestId("smarter-textarea-input")).toHaveAttribute(
      "data-conversation-id",
      "feature-sync-conversation",
    );
    expect(
      notes.compareDocumentPosition(submitButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      guidance.compareDocumentPosition(submitButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[0]);
    fireEvent.click(radios[3]);
    fireEvent.change(screen.getByTestId("smarter-textarea-input"), {
      target: { value: "  Keep this conversational.  " },
    });
    fireEvent.click(submitButton);

    expect(submit).toHaveBeenCalledWith(
      "Reports presentation: Update the presentation\nReports interaction: No change\n\nGeneral notes:\nKeep this conversational.",
      "feature-sync-message-with-notes",
    );
  });

  it("keeps disabled writable controls visible but prevents submission", () => {
    const submit = vi.fn();
    renderReport({
      conversationId: "feature-sync-conversation",
      disabled: true,
      parentMessageId: "disabled-feature-sync-message",
      submit,
    });

    const radios = screen.getAllByRole("radio");
    expect(radios.every((radio) => (radio as HTMLInputElement).disabled)).toBe(
      true,
    );
    expect(
      screen.getByTestId(
        "feature-sync-decision-test-feature-sync-decision-submit-button",
      ),
    ).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps same-named groups independent across separate reports", () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={createHeyTheme("light")}>
          <FeatureSyncDecisionReport
            interaction={{
              conversationId: "first-conversation",
              disabled: false,
              parentMessageId: "first-message",
              submit: vi.fn(),
            }}
            payload={payload}
            report={report}
            reportTestId="first-report"
          />
          <FeatureSyncDecisionReport
            interaction={{
              conversationId: "second-conversation",
              disabled: false,
              parentMessageId: "second-message",
              submit: vi.fn(),
            }}
            payload={payload}
            report={{ ...report, id: "second-feature-sync-decision-v2" }}
            reportTestId="second-report"
          />
        </ThemeProvider>
      </MemoryRouter>,
    );

    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[0]);
    fireEvent.click(radios[4]);

    expect(radios[0]).toBeChecked();
    expect(radios[4]).toBeChecked();
  });

  it("renders the project-sync card shell with its header, chip and the decision title as lead", () => {
    const [firstGroup] = payload.decisionGroups;
    renderReport(undefined, { ...payload, decisionGroups: [firstGroup] });

    const card = screen.getByTestId(
      "feature-sync-decision-test-feature-sync-decision-card",
    );
    expect(card).toHaveAttribute("data-tone", "projectSync");
    expect(
      within(card).getByTestId("conversation-card-header"),
    ).toHaveTextContent("Project sync · Decision");
    expect(within(card).getByText("Before implementation")).toBeInTheDocument();
    expect(
      within(card).getByTestId("conversation-card-lead"),
    ).toHaveTextContent("Reports presentation");
    expect(within(card).getAllByText("Reports presentation")).toHaveLength(1);
    expect(
      within(card).getByTestId(
        "feature-sync-decision-test-feature-sync-decision-group-summary",
      ),
    ).toHaveTextContent("Choose how the report surface should evolve.");
    expect(
      within(card)
        .getAllByTestId("conversation-card-section-label")
        .map((label) => label.textContent),
    ).toEqual(["Overview", "Summary", "Affected", "Choose one"]);
    expect(screen.queryByText("Affected entities")).not.toBeInTheDocument();
  });

  it("gives each decision title the lead treatment when a report holds several decisions", () => {
    renderReport();

    const prefix = "feature-sync-decision-test-feature-sync-decision";
    expect(
      screen.queryByTestId("conversation-card-lead"),
    ).not.toBeInTheDocument();
    const titles = screen.getAllByTestId(`${prefix}-group-title`);
    expect(titles.map((title) => title.textContent)).toEqual([
      "Reports presentation",
      "Reports interaction",
    ]);
    expect(
      screen
        .getByTestId(`${prefix}-summary`)
        .compareDocumentPosition(titles[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each(["light", "dark"] as const)(
    "renders the project-sync card in %s mode",
    (mode) => {
      renderReport(undefined, payloadWithReasons, mode);

      expect(
        screen.getByTestId(
          "feature-sync-decision-test-feature-sync-decision-card",
        ),
      ).toHaveAttribute("data-tone", "projectSync");
      expect(
        screen.getAllByTestId("conversation-card-related-row"),
      ).toHaveLength(3);
    },
  );

  it("shows one related row per unique entity with its reason when the report supplies one", () => {
    renderReport(undefined, payloadWithReasons);

    const rows = screen.getAllByTestId("conversation-card-related-row");
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0]).getByTestId("conversation-card-row-reason"),
    ).toHaveTextContent(REASON_SHARED);
    expect(
      within(rows[1]).getByTestId("conversation-card-row-reason"),
    ).toHaveTextContent(REASON_REPORTS);
    expect(
      within(rows[2]).getByTestId("conversation-card-row-reason"),
    ).toHaveTextContent(REASON_SHARED);
  });

  it("renders chip-only rows for a stored report written before reasons existed", () => {
    renderReport();

    const rows = screen.getAllByTestId("conversation-card-related-row");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(within(row).getAllByTestId("mention-badge")).toHaveLength(1);
      expect(
        within(row).queryByTestId("conversation-card-row-reason"),
      ).not.toBeInTheDocument();
    }
  });

  it("submits the same response with or without reasons and never includes a reason", () => {
    const submitWith = (reportPayload: FeatureSyncDecisionReportPayloadV2) => {
      const submit = vi.fn();
      const { unmount } = renderReport(
        {
          conversationId: "feature-sync-conversation",
          disabled: false,
          parentMessageId: "feature-sync-message",
          submit,
        },
        reportPayload,
      );
      const radios = screen.getAllByRole("radio");
      fireEvent.click(radios[0]);
      fireEvent.click(radios[3]);
      fireEvent.click(
        screen.getByTestId(
          "feature-sync-decision-test-feature-sync-decision-submit-button",
        ),
      );
      unmount();
      return submit.mock.calls[0][0] as string;
    };

    const withoutReasons = submitWith(payload);
    const withReasons = submitWith(payloadWithReasons);

    expect(withReasons).toBe(withoutReasons);
    expect(withReasons).not.toContain(REASON_SHARED);
    expect(withReasons).not.toContain(REASON_REPORTS);
  });

  it("labels the single green action for one decision and keeps read-only cards footer-free", () => {
    const [firstGroup] = payload.decisionGroups;
    renderReport(
      {
        conversationId: "feature-sync-conversation",
        disabled: false,
        parentMessageId: "feature-sync-message",
        submit: vi.fn(),
      },
      { ...payload, decisionGroups: [firstGroup] },
    );
    expect(
      screen.getByRole("button", { name: "Submit decision" }),
    ).toBeInTheDocument();
  });

  it("renders no footer and no radios when read-only", () => {
    renderReport(undefined, payloadWithReasons);

    expect(
      screen.queryByTestId("conversation-card-footer"),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  describe("restoring a recorded answer", () => {
    const answer =
      "Reports presentation: Update the presentation\nReports interaction: No change";

    it("restores the chosen options after a submit and a remount", () => {
      const submit = vi.fn();
      const interaction = {
        conversationId: "feature-sync-conversation",
        disabled: false,
        parentMessageId: "feature-sync-message",
        submit,
      };
      const first = renderReport(interaction);
      const radios = screen.getAllByRole("radio");
      fireEvent.click(radios[0]);
      fireEvent.click(radios[3]);
      fireEvent.click(
        screen.getByTestId(
          "feature-sync-decision-test-feature-sync-decision-submit-button",
        ),
      );
      const recorded = submit.mock.calls[0][0] as string;
      first.unmount();

      // Reload: the conversation is answered, so controls are disabled and the
      // persisted reply is all the card has to go on.
      render(
        <FeatureSyncDecisionReport
          interaction={{ ...interaction, disabled: true }}
          payload={payload}
          recordedResponse={recorded}
          report={report}
          reportTestId="feature-sync-decision-test"
        />,
        { wrapper: themed() },
      );

      const reloaded = screen.getAllByRole("radio");
      expect(
        reloaded.map((radio) => (radio as HTMLInputElement).checked),
      ).toEqual([true, false, false, true]);
      expect(
        reloaded.every((radio) => (radio as HTMLInputElement).disabled),
      ).toBe(true);
    });

    it("marks the chosen option on a read-only card", () => {
      render(
        <FeatureSyncDecisionReport
          payload={payload}
          recordedResponse={answer}
          report={report}
          reportTestId="feature-sync-decision-test"
        />,
        { wrapper: themed() },
      );

      const choices = screen.getAllByTestId(
        "feature-sync-decision-test-feature-sync-decision-choice",
      );
      expect(
        choices.map((choice) => choice.getAttribute("data-selected")),
      ).toEqual(["true", "false", "false", "true"]);
      expect(
        screen.getAllByTestId(
          "feature-sync-decision-test-feature-sync-decision-choice-selected",
        ),
      ).toHaveLength(2);
    });

    it("restores nothing from a free-form reply or an unanswered report", () => {
      for (const recordedResponse of [
        undefined,
        "Let's keep everything as it is for now.",
        "Reports presentation: A label nobody offered",
      ]) {
        const { unmount } = render(
          <FeatureSyncDecisionReport
            payload={payload}
            recordedResponse={recordedResponse}
            report={report}
            reportTestId="feature-sync-decision-test"
          />,
          { wrapper: themed() },
        );
        expect(
          screen.queryByTestId(
            "feature-sync-decision-test-feature-sync-decision-choice-selected",
          ),
        ).not.toBeInTheDocument();
        unmount();
      }
    });

    it("keeps repeated titles apart by reading the reply in producer order", () => {
      const repeated = {
        ...payload,
        decisionGroups: payload.decisionGroups.map((group) => ({
          ...group,
          title: "Same title",
          choices: [
            { id: `${group.id}-a`, label: "Option A", isNoChange: false },
            { id: `${group.id}-keep`, label: "Option B", isNoChange: true },
          ],
        })),
      };

      expect(
        parseFeatureSyncDecisionResponse(
          repeated.decisionGroups,
          "Same title: Option B\nSame title: Option A\n\nGeneral notes:\nSame title: Option A",
        ),
      ).toEqual({ "group-one": "group-one-keep", "group-two": "group-two-a" });
    });
  });

  it("keeps the V1 fallback readable without exposing V2 controls", () => {
    render(
      <FeatureSyncDecisionReport
        payload={legacyPayload}
        report={legacyReport}
        reportTestId="feature-sync-decision-v1-test"
      />,
      { wrapper: MemoryRouter },
    );

    const prefix = "feature-sync-decision-v1-test-feature-sync-decision";
    expect(screen.getByTestId(`${prefix}-groups-list`)).toBeInTheDocument();
    expect(screen.getByText("Legacy renderer task")).toBeInTheDocument();
    expect(
      screen.getByTestId(`${prefix}-group-option-title`),
    ).toHaveTextContent("Update the legacy renderer task.");
    expect(screen.getByTestId(`${prefix}-group-option-card`)).toHaveAttribute(
      "data-option-number",
      "1",
    );
    expect(screen.queryByTestId(`${prefix}-summary`)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});
