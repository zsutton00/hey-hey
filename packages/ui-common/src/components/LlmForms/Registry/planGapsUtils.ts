import type { PlanGapItemPayload, RelatedEntityDto } from "../../../api";
import type {
  PlanGapDiscoveryNextAction,
  PlanGapReview,
  PlanGapCoverageReview,
  PlanGapClarifyingAnswer,
  PlanGapsDesignDocsValue,
  PlanGapsServicesValue,
  PlanGapsTasksValue,
} from "./types";
import {
  PlanGapDiscoveryNextAction as PlanGapDiscoveryNextActionValues,
  PlanGapDiscoveryMessageType,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isPlanGapReviewAction = (
  value: unknown
): value is "accept" | "reject" | "pending" =>
  value === "accept" || value === "reject" || value === "pending";

const isRelatedEntityDto = (value: unknown): value is RelatedEntityDto =>
  isRecord(value) &&
  typeof value.entityId === "string" &&
  typeof value.entityType === "string" &&
  typeof value.entityName === "string";

const isRelatedEntityDtoArray = (value: unknown): value is RelatedEntityDto[] =>
  Array.isArray(value) && value.every(isRelatedEntityDto);

export const getPotentialCoverageForGap = (
  gap: PlanGapItemPayload
): RelatedEntityDto[] => {
  return isRelatedEntityDtoArray(gap.potentialCoverage)
    ? gap.potentialCoverage
    : [];
};

const isPlanGapCoverageReview = (
  value: unknown
): value is PlanGapCoverageReview =>
  isRecord(value) &&
  typeof value.entityId === "string" &&
  isPlanGapReviewAction(value.action);

const isPlanGapReview = (value: unknown): value is PlanGapReview =>
  isRecord(value) &&
  typeof value.title === "string" &&
  isPlanGapReviewAction(value.action) &&
  Array.isArray(value.coverageReviews);

const isPlanGapClarifyingAnswer = (
  value: unknown
): value is PlanGapClarifyingAnswer =>
  isRecord(value) &&
  typeof value.question === "string" &&
  typeof value.answer === "string";

const isPlanGapNextAction = (
  value: unknown
): value is PlanGapDiscoveryNextAction =>
  value === PlanGapDiscoveryNextActionValues.ReadyForNextStep ||
  value === PlanGapDiscoveryNextActionValues.ContinueRevising;

const isPlanGapDiscoveryMessageType = (
  value: unknown
): value is PlanGapDiscoveryMessageType =>
  value === PlanGapDiscoveryMessageType.PlanGaps;

const mergeCoverageReviews = (
  gap: PlanGapItemPayload,
  reviews: PlanGapCoverageReview[] | undefined
): PlanGapCoverageReview[] => {
  const coverage = getPotentialCoverageForGap(gap);
  const reviewMap = new Map(
    (reviews ?? []).map((review) => [review.entityId, review])
  );
  return coverage.map((entity) => ({
    entityId: entity.entityId,
    action: reviewMap.get(entity.entityId)?.action ?? "pending",
    comment: reviewMap.get(entity.entityId)?.comment,
  }));
};

export const mergeGapReviews = (
  gaps: PlanGapItemPayload[],
  reviews: PlanGapReview[]
): PlanGapReview[] => {
  const reviewMap = new Map(reviews.map((review) => [review.title, review]));
  return gaps.map((gap) => {
    const review = reviewMap.get(gap.title);
    return {
      title: gap.title,
      action: review?.action ?? "pending",
      comment: review?.comment,
      coverageReviews: mergeCoverageReviews(gap, review?.coverageReviews),
    };
  });
};

export const mergeClarifyingAnswers = (
  questions: string[],
  answers: PlanGapClarifyingAnswer[]
): PlanGapClarifyingAnswer[] => {
  const answerMap = new Map(
    answers.map((answer) => [answer.question, answer.answer])
  );
  return questions.map((question) => ({
    question,
    answer: answerMap.get(question) ?? "",
  }));
};

export const createPlanGapsServicesValue = (
  gaps: PlanGapItemPayload[],
  questions: string[]
): PlanGapsServicesValue => ({
  type: PlanGapDiscoveryMessageType.PlanGaps,
  nextAction: PlanGapDiscoveryNextActionValues.ContinueRevising,
  gapReviews: gaps.map((gap) => ({
    title: gap.title,
    action: "pending",
    coverageReviews: getPotentialCoverageForGap(gap).map((entity) => ({
      entityId: entity.entityId,
      action: "pending",
    })),
  })),
  manuallyAdded: [],
  clarifyingAnswers: questions.map((question) => ({
    question,
    answer: "",
  })),
});

export const createPlanGapsDesignDocsValue = (
  gaps: PlanGapItemPayload[],
  questions: string[]
): PlanGapsDesignDocsValue => ({
  type: PlanGapDiscoveryMessageType.PlanGaps,
  nextAction: PlanGapDiscoveryNextActionValues.ContinueRevising,
  gapReviews: gaps.map((gap) => ({
    title: gap.title,
    action: "pending",
    coverageReviews: getPotentialCoverageForGap(gap).map((entity) => ({
      entityId: entity.entityId,
      action: "pending",
    })),
  })),
  manuallyAdded: [],
  clarifyingAnswers: questions.map((question) => ({
    question,
    answer: "",
  })),
});

export const createPlanGapsTasksValue = (
  gaps: PlanGapItemPayload[],
  questions: string[]
): PlanGapsTasksValue => ({
  type: PlanGapDiscoveryMessageType.PlanGaps,
  nextAction: PlanGapDiscoveryNextActionValues.ContinueRevising,
  gapReviews: gaps.map((gap) => ({
    title: gap.title,
    action: "pending",
    coverageReviews: getPotentialCoverageForGap(gap).map((entity) => ({
      entityId: entity.entityId,
      action: "pending",
    })),
  })),
  manuallyAdded: [],
  clarifyingAnswers: questions.map((question) => ({
    question,
    answer: "",
  })),
});

const normalizeCoverageReviews = (
  value: unknown,
  fallback: PlanGapCoverageReview[]
): PlanGapCoverageReview[] => {
  if (!Array.isArray(value) || !value.some(isPlanGapCoverageReview)) {
    return fallback;
  }

  const reviewMap = new Map(
    value
      .filter(isPlanGapCoverageReview)
      .map((review) => [review.entityId, review])
  );
  return fallback.map((fallbackReview) => ({
    entityId: fallbackReview.entityId,
    action: reviewMap.get(fallbackReview.entityId)?.action ?? "pending",
    comment: reviewMap.get(fallbackReview.entityId)?.comment,
  }));
};

const normalizeGapReviews = (
  value: unknown,
  fallback: PlanGapReview[]
): PlanGapReview[] => {
  if (!Array.isArray(value) || !value.some(isPlanGapReview)) {
    return fallback;
  }

  const reviewMap = new Map(
    value.filter(isPlanGapReview).map((review) => [review.title, review])
  );
  return fallback.map((fallbackReview) => {
    const review = reviewMap.get(fallbackReview.title);
    return {
      title: fallbackReview.title,
      action: review?.action ?? fallbackReview.action,
      comment:
        typeof review?.comment === "string"
          ? review.comment
          : fallbackReview.comment,
      coverageReviews: normalizeCoverageReviews(
        review?.coverageReviews,
        fallbackReview.coverageReviews
      ),
    };
  });
};

const normalizeClarifyingAnswers = (
  value: unknown,
  fallback: PlanGapClarifyingAnswer[]
): PlanGapClarifyingAnswer[] =>
  Array.isArray(value) && value.some(isPlanGapClarifyingAnswer)
    ? value.filter(isPlanGapClarifyingAnswer).map((answer) => ({
        question: answer.question,
        answer: answer.answer,
      }))
    : fallback;

const normalizeServiceAdditions = (
  value: unknown,
  fallback: PlanGapsServicesValue["manuallyAdded"]
): PlanGapsServicesValue["manuallyAdded"] => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    if (
      item.kind === "existing" &&
      item.entityType === "services" &&
      typeof item.entityId === "string" &&
      typeof item.name === "string"
    ) {
      return [
        {
          source: "user_added",
          kind: "existing",
          entityType: "services",
          entityId: item.entityId,
          name: item.name,
          description:
            typeof item.description === "string" ? item.description : undefined,
        },
      ];
    }

    if (typeof item.serviceId === "string" && typeof item.name === "string") {
      return [
        {
          source: "user_added",
          kind: "existing",
          entityType: "services",
          entityId: item.serviceId,
          name: item.name,
        },
      ];
    }

    return [];
  });
};

const normalizeDesignDocAdditions = (
  value: unknown,
  fallback: PlanGapsDesignDocsValue["manuallyAdded"]
): PlanGapsDesignDocsValue["manuallyAdded"] => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    if (
      item.kind === "existing" &&
      item.entityType === "design_docs" &&
      typeof item.entityId === "string" &&
      typeof item.name === "string"
    ) {
      return [
        {
          source: "user_added",
          kind: "existing",
          entityType: "design_docs",
          entityId: item.entityId,
          name: item.name,
          description:
            typeof item.description === "string" ? item.description : undefined,
        },
      ];
    }

    if (typeof item.designDocId === "string" && typeof item.name === "string") {
      return [
        {
          source: "user_added",
          kind: "existing",
          entityType: "design_docs",
          entityId: item.designDocId,
          name: item.name,
        },
      ];
    }

    return [];
  });
};

const normalizeTaskAdditions = (
  value: unknown,
  fallback: PlanGapsTasksValue["manuallyAdded"]
): PlanGapsTasksValue["manuallyAdded"] => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const additions: PlanGapsTasksValue["manuallyAdded"] = [];

  value.forEach((item) => {
    if (!isRecord(item)) {
      return;
    }

    if (
      item.kind === "manual" &&
      item.entityType === "tasks" &&
      typeof item.title === "string"
    ) {
      additions.push({
        source: "user_added",
        kind: "manual",
        entityType: "tasks",
        title: item.title,
        description:
          typeof item.description === "string" ? item.description : undefined,
      });
      return;
    }

    if (
      item.kind === "existing" &&
      item.entityType === "tasks" &&
      typeof item.entityId === "string" &&
      typeof item.name === "string"
    ) {
      additions.push({
        source: "user_added",
        kind: "existing",
        entityType: "tasks",
        entityId: item.entityId,
        name: item.name,
        description:
          typeof item.description === "string" ? item.description : undefined,
      });
      return;
    }

    if (typeof item.taskId === "string" && typeof item.name === "string") {
      additions.push({
        source: "user_added",
        kind: "existing",
        entityType: "tasks",
        entityId: item.taskId,
        name: item.name,
        description:
          typeof item.description === "string" ? item.description : undefined,
      });
      return;
    }

    if (typeof item.title === "string") {
      additions.push({
        source: "user_added",
        kind: "manual",
        entityType: "tasks",
        title: item.title,
        description:
          typeof item.description === "string" ? item.description : undefined,
      });
    }
  });

  return additions;
};

export const normalizePlanGapsServicesValue = (
  value: unknown,
  fallback: PlanGapsServicesValue
): PlanGapsServicesValue => {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    type: isPlanGapDiscoveryMessageType(value.type)
      ? value.type
      : fallback.type,
    nextAction: isPlanGapNextAction(value.nextAction)
      ? value.nextAction
      : fallback.nextAction,
    gapReviews: normalizeGapReviews(value.gapReviews, fallback.gapReviews),
    manuallyAdded: normalizeServiceAdditions(
      value.manuallyAdded,
      fallback.manuallyAdded
    ),
    clarifyingAnswers: normalizeClarifyingAnswers(
      value.clarifyingAnswers,
      fallback.clarifyingAnswers
    ),
  };
};

export const normalizePlanGapsDesignDocsValue = (
  value: unknown,
  fallback: PlanGapsDesignDocsValue
): PlanGapsDesignDocsValue => {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    type: isPlanGapDiscoveryMessageType(value.type)
      ? value.type
      : fallback.type,
    nextAction: isPlanGapNextAction(value.nextAction)
      ? value.nextAction
      : fallback.nextAction,
    gapReviews: normalizeGapReviews(value.gapReviews, fallback.gapReviews),
    manuallyAdded: normalizeDesignDocAdditions(
      value.manuallyAdded,
      fallback.manuallyAdded
    ),
    clarifyingAnswers: normalizeClarifyingAnswers(
      value.clarifyingAnswers,
      fallback.clarifyingAnswers
    ),
  };
};

export const normalizePlanGapsTasksValue = (
  value: unknown,
  fallback: PlanGapsTasksValue
): PlanGapsTasksValue => {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    type: isPlanGapDiscoveryMessageType(value.type)
      ? value.type
      : fallback.type,
    nextAction: isPlanGapNextAction(value.nextAction)
      ? value.nextAction
      : fallback.nextAction,
    gapReviews: normalizeGapReviews(value.gapReviews, fallback.gapReviews),
    manuallyAdded: normalizeTaskAdditions(
      value.manuallyAdded,
      fallback.manuallyAdded
    ),
    clarifyingAnswers: normalizeClarifyingAnswers(
      value.clarifyingAnswers,
      fallback.clarifyingAnswers
    ),
  };
};
