import { BadRequestException, Injectable } from '@nestjs/common';
import { ExtendedUIFieldType, UIElement } from '../generated';
import { OnboardingFeatureListReviewUserSubmissionSchema } from '../generated/workflow-review.schemas';
import {
  hasRepositoryGroundingTypedAnswers,
  parseRepositoryGroundingFormSubmission,
  REPOSITORY_GROUNDING_TYPED_FIELDS,
  parseRepositoryPlacementStrategy,
} from '../flows/nodes/onboarding/repository-grounding.contract';
import {
  FIRST_WORK_FOLLOW_UP_FIELD,
  firstWorkFollowUpAnswersSchema,
} from '../flows/nodes/repository-import/repository-import-first-work-follow-up.node';

@Injectable()
export class RepositoryImportReplyFormValidator {
  assertCompleteAnswers(
    uiElements: UIElement[] | undefined,
    answers: Record<string, unknown>,
  ): void {
    if (!uiElements?.length) {
      throw new BadRequestException(
        'The current repository import form is missing',
      );
    }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new BadRequestException(
        'Repository import answers must be an object',
      );
    }

    const fields = new Map(uiElements.map((field) => [field.id, field]));
    const repositoryGroundingField = uiElements.find(
      (field) => field.type === ExtendedUIFieldType.RepositoryGrounding,
    );
    const allowedFieldIds = new Set(fields.keys());
    if (repositoryGroundingField) {
      Object.values(REPOSITORY_GROUNDING_TYPED_FIELDS).forEach((fieldId) =>
        allowedFieldIds.add(fieldId),
      );
    }
    const unknown = Object.keys(answers).filter(
      (key) => !allowedFieldIds.has(key),
    );
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown repository import answer fields: ${unknown.join(', ')}`,
      );
    }

    if (repositoryGroundingField) {
      const hasTypedAnswers = hasRepositoryGroundingTypedAnswers(answers);
      if (hasTypedAnswers) {
        try {
          parseRepositoryGroundingFormSubmission(answers);
        } catch (error) {
          throw new BadRequestException(
            `Repository import answers are invalid: ${
              error instanceof Error ? error.message : 'invalid value'
            }`,
          );
        }
      } else if (repositoryGroundingField.required) {
        throw new BadRequestException(
          'Repository grounding requires its complete typed context',
        );
      }
    }

    for (const field of uiElements) {
      if (field.type === ExtendedUIFieldType.RepositoryGrounding) continue;
      const value = answers[field.id];
      if (field.required && this.isEmpty(value)) {
        throw new BadRequestException(
          `A value is required for repository import field ${field.id}`,
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
    if (field.type === ExtendedUIFieldType.FeatureList) {
      this.assertCanonicalReviewValue(
        field,
        value,
        OnboardingFeatureListReviewUserSubmissionSchema,
      );
      return;
    }

    if (field.id === FIRST_WORK_FOLLOW_UP_FIELD) {
      this.assertCanonicalReviewValue(
        field,
        value,
        firstWorkFollowUpAnswersSchema,
      );
      return;
    }

    if (field.type === ExtendedUIFieldType.RepositoryPlacementStrategy) {
      try {
        parseRepositoryPlacementStrategy(value);
      } catch (error) {
        throw new BadRequestException(
          `Repository import field ${field.id} must use a valid placement strategy: ${error instanceof Error ? error.message : 'invalid value'}`,
        );
      }
      return;
    }

    if (field.type === 'checkbox' && typeof value !== 'boolean') {
      throw new BadRequestException(
        `Repository import field ${field.id} must be a boolean`,
      );
    }
    if (
      ['text', 'text_input', 'textarea', 'datepicker'].includes(field.type) &&
      typeof value !== 'string'
    ) {
      throw new BadRequestException(
        `Repository import field ${field.id} must be a string`,
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
          `Repository import field ${field.id} contains an invalid option`,
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
        `Repository import field ${field.id} must use a canonical review action/payload: ${parsed.error?.message ?? 'invalid value'}`,
      );
    }
  }
}
