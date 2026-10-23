/**
 * Canonical renderers for startup-plan content (`responseType: startup_plan_v1`).
 *
 * One module so ui-common, the CLI, and any future consumer share the same
 * markdown output for: the one-line summary, the plan body, and the
 * approval/improvement review feedback.
 *
 * The input types are intentionally structural (the LCD of
 * `CodingPromptStartupPlanPayload` from the platform API and
 * `LocalStartupSessionPlanResponse` from the local-agent API), so callers
 * can pass either without converting.
 */

import type {
  CodingPromptStartupPlanReference,
  CodingPromptStartupPrimaryImplementation,
} from "../../api";

export interface StartupPlanRenderableStep {
  stepId: string;
  title: string;
  description: string;
  targetFiles?: readonly string[] | null;
  references?: ReadonlyArray<CodingPromptStartupPlanReference> | null;
  /**
   * Relative effort of the step. Only `medium` and `hard` are surfaced;
   * trivial work is never its own step, so `undefined` renders no label.
   */
  difficulty?: "medium" | "hard";
  /** 1-based phase this step belongs to. Contiguous same-phase steps group together. */
  phase: number;
}

export interface StartupPlanRenderableDiscrepancy {
  discrepancyText: string;
  reasoning: string;
  severity: string;
  sourceField?: string | null;
  sourceRef: { sourceType: string; sourceId: string };
}

export interface StartupPlanRenderableClarificationQuestion {
  question: string;
  reason?: string | null;
}

export interface StartupPlanRenderableMissedStep {
  title: string;
  description: string;
  missingPrecondition?: string | null;
  referencedArtifact?: string | null;
  suggestedResolution: {
    type: string;
    description: string;
    targetStageId?: string | null;
    proposalId?: string | null;
  };
}

export interface StartupPlanRenderable {
  sessionTitle: string;
  executionPlan: ReadonlyArray<StartupPlanRenderableStep>;
  discrepancies: ReadonlyArray<StartupPlanRenderableDiscrepancy>;
  clarificationQuestions: ReadonlyArray<StartupPlanRenderableClarificationQuestion>;
  missedSteps?: ReadonlyArray<StartupPlanRenderableMissedStep> | null;
  primaryImplementations?: ReadonlyArray<CodingPromptStartupPrimaryImplementation> | null;
}

export interface StartupPlanStepFeedbackEntry {
  stepId: string;
  note: string;
}

export interface StartupPlanDiscrepancyFeedbackEntry {
  discrepancyIndex: number;
  note: string;
}

export interface StartupPlanQuestionAnswerEntry {
  /** Either resolve the question text via index into `plan.clarificationQuestions`… */
  questionIndex?: number;
  /** …or pass the question text directly (used by callers that don't have indices). */
  question?: string;
  answer: string;
}

export interface StartupPlanDiscrepancyDispositionEntry {
  discrepancyIndex: number;
  disposition: "acknowledged" | "blocker";
  note?: string | null;
}

export interface StartupPlanReviewFeedback {
  generalFeedback?: string | null;
  stepFeedback?: ReadonlyArray<StartupPlanStepFeedbackEntry>;
  discrepancyFeedback?: ReadonlyArray<StartupPlanDiscrepancyFeedbackEntry>;
  questionAnswers?: ReadonlyArray<StartupPlanQuestionAnswerEntry>;
  discrepancyDispositions?: ReadonlyArray<StartupPlanDiscrepancyDispositionEntry>;
}

const trimToString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * Per-step difficulty label appended to the step title. Omitted entirely when
 * absent; `hard` is rendered bold so it stands out from `medium`.
 */
const formatDifficultyLabel = (
  difficulty: StartupPlanRenderableStep["difficulty"]
): string => {
  if (difficulty === "hard") {
    return " **[hard]**";
  }
  if (difficulty === "medium") {
    return " _[medium]_";
  }
  return "";
};

const renderPrimaryImplementation = (
  item: CodingPromptStartupPrimaryImplementation
): string => {
  // A longer fence keeps embedded Markdown/code fences inside the full source.
  const runs = item.content.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  const lines = [`#### ${item.title}`];
  if (item.location) lines.push(`Location: ${item.location}`);
  lines.push(`Rationale: ${item.rationale}`);
  lines.push(`${fence}${item.language ?? ""}\n${item.content}\n${fence}`);
  if (item.connections?.length) {
    lines.push(
      `Connections:\n${item.connections
        .map((connection) =>
          [
            `- ${connection.relationship}: ${connection.entityType}:${connection.entityId} — ${connection.entityTitle}`,
            `  Source field: ${connection.sourceField}`,
            `  Source excerpt: ${connection.sourceExcerpt}`,
            `  Rationale: ${connection.rationale}`,
          ].join("\n")
        )
        .join("\n\n")}`
    );
  }
  return lines.join("\n\n");
};

/**
 * One-line summary used in conversation timelines and execution-update
 * system messages: `"Startup Plan: <title> | N execution steps | ..."`.
 */
export const renderStartupPlanSummary = (
  plan: StartupPlanRenderable
): string => {
  const parts: string[] = [`Startup Plan: ${plan.sessionTitle}`];
  parts.push(`${String(plan.executionPlan.length)} execution steps`);
  if (plan.discrepancies.length > 0) {
    parts.push(`${String(plan.discrepancies.length)} discrepancies`);
  }
  if (plan.clarificationQuestions.length > 0) {
    parts.push(
      `${String(plan.clarificationQuestions.length)} clarification questions`
    );
  }
  const missedSteps = plan.missedSteps ?? [];
  if (missedSteps.length > 0) {
    parts.push(`${String(missedSteps.length)} missed steps`);
  }
  return parts.join(" | ");
};

/**
 * Full plan body as markdown — session title, execution plan, discrepancies,
 * clarification questions. Empty sections are omitted entirely.
 *
 * Suitable for the displayed user-message comment on approval, the
 * subagent's "approved plan" context block, and the body of the
 * plan-execution prompt.
 *
 * `sessionTitlePrefix`, when supplied, is prepended to the H2 title:
 * `"## <prefix><sessionTitle>"` — used for example to label an approved
 * plan as `"## Plan approved: My Title"`.
 */
export const renderStartupPlanMarkdown = (
  plan: StartupPlanRenderable,
  options?: { sessionTitlePrefix?: string }
): string => {
  const titlePrefix = options?.sessionTitlePrefix ?? "";
  const sections: string[] = [`## ${titlePrefix}${plan.sessionTitle}`];

  if (plan.executionPlan.length > 0) {
    const blocks: string[] = [];
    let previousPhase: number | null = null;
    plan.executionPlan.forEach((step, index) => {
      if (step.phase !== previousPhase) {
        blocks.push(`#### Phase ${String(step.phase)}`);
        previousPhase = step.phase;
      }
      const targetFiles = step.targetFiles ?? [];
      const targetLine =
        targetFiles.length > 0
          ? `\n   Target files: ${targetFiles
              .map((path) => `\`${path}\``)
              .join(", ")}`
          : "";
      const difficultyLabel = formatDifficultyLabel(step.difficulty);
      const referencesLine = step.references?.length
        ? `\n   References: ${step.references
            .map(
              (reference) =>
                `${reference.sourceType}:${reference.sourceId} — ${reference.rationale}`
            )
            .join("; ")}`
        : "";
      blocks.push(
        `${String(index + 1)}. \`${step.stepId}\` — **${
          step.title
        }**${difficultyLabel}\n   ${
          step.description
        }${targetLine}${referencesLine}`
      );
    });
    sections.push(`### Execution Plan\n${blocks.join("\n\n")}`);
  }

  if (plan.primaryImplementations?.length) {
    sections.push(
      `### Primary Implementations\n${plan.primaryImplementations
        .map(renderPrimaryImplementation)
        .join("\n\n")}`
    );
  }

  if (plan.discrepancies.length > 0) {
    const lines = plan.discrepancies.map((discrepancy, index) => {
      const sourceField = discrepancy.sourceField
        ? ` (${discrepancy.sourceField})`
        : "";
      const source = `${discrepancy.sourceRef.sourceType}:${discrepancy.sourceRef.sourceId}${sourceField}`;
      return `${String(index + 1)}. **[${discrepancy.severity}]** ${
        discrepancy.discrepancyText
      }\n   ${discrepancy.reasoning}\n   Source: ${source}`;
    });
    sections.push(`### Discrepancies\n${lines.join("\n\n")}`);
  }

  if (plan.clarificationQuestions.length > 0) {
    const lines = plan.clarificationQuestions.map((question, index) => {
      const reason = question.reason ? `\n   _${question.reason}_` : "";
      return `${String(index + 1)}. ${question.question}${reason}`;
    });
    sections.push(`### Clarification Questions\n${lines.join("\n\n")}`);
  }

  return sections.join("\n\n");
};

/**
 * Markdown rendering of the user's review (general feedback, per-step
 * feedback, per-discrepancy feedback, clarification answers, dispositions).
 *
 * Returns `null` when the user supplied nothing (so callers can decide
 * whether to omit the section or print a placeholder).
 *
 * The optional `decision` field, when provided, prefixes a header — used by
 * the "improve" prompt path to label the review as approval vs. revision.
 */
export const renderStartupPlanReviewMarkdown = (input: {
  plan: StartupPlanRenderable;
  feedback: StartupPlanReviewFeedback;
  decision?: "approve" | "improve";
}): string | null => {
  const sections: string[] = [];

  if (input.decision) {
    sections.push(
      input.decision === "approve"
        ? "### Plan approved"
        : "### Continue revising plan"
    );
  }

  const general = trimToString(input.feedback.generalFeedback);
  if (general.length > 0) {
    sections.push(`#### General feedback\n${general}`);
  }

  const stepFeedback = input.feedback.stepFeedback ?? [];
  if (stepFeedback.length > 0) {
    const stepIndexById = new Map(
      input.plan.executionPlan.map((step, index) => [
        step.stepId,
        { step, index },
      ])
    );
    const lines = stepFeedback.map((entry) => {
      const found = stepIndexById.get(entry.stepId);
      const number = (found?.index ?? 0) + 1;
      const title = found?.step.title ?? entry.stepId;
      return `${String(number)}. _${title}_\n\n   ${entry.note}`;
    });
    sections.push(`#### Plan steps\n${lines.join("\n\n")}`);
  }

  const discrepancyFeedback = input.feedback.discrepancyFeedback ?? [];
  if (discrepancyFeedback.length > 0) {
    const lines = discrepancyFeedback.map((entry) => {
      const text =
        input.plan.discrepancies[entry.discrepancyIndex]?.discrepancyText ??
        `Discrepancy #${String(entry.discrepancyIndex + 1)}`;
      return `${String(entry.discrepancyIndex + 1)}. _${text}_\n\n   ${
        entry.note
      }`;
    });
    sections.push(`#### Discrepancies\n${lines.join("\n\n")}`);
  }

  const questionAnswers = input.feedback.questionAnswers ?? [];
  if (questionAnswers.length > 0) {
    const lines = questionAnswers.map((entry, fallbackIndex) => {
      const indexFromEntry =
        typeof entry.questionIndex === "number" ? entry.questionIndex : null;
      const resolvedIndex = indexFromEntry ?? fallbackIndex;
      const text =
        entry.question ??
        (indexFromEntry !== null
          ? input.plan.clarificationQuestions[indexFromEntry]?.question
          : undefined) ??
        `Question #${String(resolvedIndex + 1)}`;
      return `${String(resolvedIndex + 1)}. _${text}_\n\n   ${entry.answer}`;
    });
    sections.push(`#### Clarification answers\n${lines.join("\n\n")}`);
  }

  const dispositions = input.feedback.discrepancyDispositions ?? [];
  if (dispositions.length > 0) {
    const lines = dispositions.map((entry) => {
      const note = entry.note ? ` — note: ${entry.note}` : "";
      return `- Discrepancy [${String(entry.discrepancyIndex)}]: ${
        entry.disposition
      }${note}`;
    });
    sections.push(`#### Discrepancy dispositions\n${lines.join("\n")}`);
  }

  if (sections.length === 0) {
    return null;
  }

  return sections.join("\n\n");
};
