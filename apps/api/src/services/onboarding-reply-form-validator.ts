import { BadRequestException, Injectable } from '@nestjs/common';
import { ExtendedUIFieldType, UIElement } from '../generated';
import {
  OnboardingFeatureListReviewUserSubmissionSchema,
  OnboardingPlanStageProposalReviewUserSubmissionSchema,
} from '../generated/workflow-review.schemas';
import {
  parseRepositoryGroundingIntentAnswer,
  REPOSITORY_GROUNDING_FIELDS,
} from '../flows/nodes/onboarding/repository-grounding.contract';

@Injectable()
export class OnboardingReplyFormValidator {
  assertCompleteAnswers(
    uiElements: UIElement[] | undefined,
    answers: Record<string, unknown>,
  ): void {
    if (!uiElements?.length) {
      throw new BadRequestException('The current onboarding form is missing');
    }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new BadRequestException('Onboarding answers must be an object');
    }

    const fields = new Map(uiElements.map((field) => [field.id, field]));
    const allowedFieldIds = new Set(fields.keys());
    const unknown = Object.keys(answers).filter(
      (key) => !allowedFieldIds.has(key),
    );
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown onboarding answer fields: ${unknown.join(', ')}`,
      );
    }

    for (const field of uiElements) {
      const value = answers[field.id];
      if (field.required && this.isEmpty(value)) {
        throw new BadRequestException(
          `A value is required for onboarding field ${field.id}`,
        );
      }
      if (value === undefined || value === null) continue;
      this.assertFieldValue(field, value);
    }
  }

  private isEmpty(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0)
    );
  }

  private assertFieldValue(field: UIElement, value: unknown): void {
    if (field.id === REPOSITORY_GROUNDING_FIELDS.intent) {
      try {
        parseRepositoryGroundingIntentAnswer(value);
      } catch (error) {
        throw new BadRequestException(
          `Onboarding field ${field.id} must use a valid repository grounding intent: ${error instanceof Error ? error.message : 'invalid value'}`,
        );
      }
      return;
    }

    if (field.type === ExtendedUIFieldType.FeatureList) {
      this.assertCanonicalReviewValue(
        field,
        value,
        OnboardingFeatureListReviewUserSubmissionSchema,
      );
      return;
    }

    if (field.type === ExtendedUIFieldType.PlanStageProposal) {
      this.assertCanonicalReviewValue(
        field,
        value,
        OnboardingPlanStageProposalReviewUserSubmissionSchema,
      );
      return;
    }

    if (field.type === 'checkbox' && typeof value !== 'boolean') {
      throw new BadRequestException(
        `Onboarding field ${field.id} must be a boolean`,
      );
    }
    if (
      ['text', 'text_input', 'textarea', 'datepicker'].includes(field.type) &&
      typeof value !== 'string'
    ) {
      throw new BadRequestException(
        `Onboarding field ${field.id} must be a string`,
      );
    }
    if (field.options?.length) {
      const allowed = new Set(
        field.options.flatMap((option) => [option.value, option.label]),
      );
      const values = Array.isArray(value) ? value : [value];
      if (
        values.some(
          (candidate) =>
            typeof candidate !== 'string' || !allowed.has(candidate),
        )
      ) {
        throw new BadRequestException(
          `Onboarding field ${field.id} contains an invalid option`,
        );
      }
    }
  }

  private assertCanonicalReviewValue(
    field: UIElement,
    value: unknown,
    schema: {
      safeParse: (value: unknown) => {
        success: boolean;
        error?: { message: string };
      };
    },
  ): void {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException(
        `Onboarding field ${field.id} must use a canonical review action/payload: ${parsed.error?.message ?? 'invalid value'}`,
      );
    }
  }
}
