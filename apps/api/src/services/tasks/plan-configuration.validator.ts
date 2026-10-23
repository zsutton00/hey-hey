import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { PlanConfigurationV1 } from '../../generated/model/planConfigurationV1';
import { PlanType } from '../../generated/model/planType';

export const PLAN_CONFIGURATION_SCHEMA_REF =
  '#/components/schemas/PlanConfigurationV1';
export const PLAN_CONFIGURATION_SCHEMA_VERSION = 'plan-configuration.v1';

const planConfigurationSchema: z.ZodType<PlanConfigurationV1> = z
  .object({
    schemaVersion: z.literal(PLAN_CONFIGURATION_SCHEMA_VERSION),
    planType: z.nativeEnum(PlanType),
    worktreeBranch: z.string().nullable(),
  })
  .strict();

export type PlanConfigurationValidationResult =
  | {
      success: true;
      value: PlanConfigurationV1;
      canonicalContent: string;
    }
  | {
      success: false;
      message: string;
    };

export function validatePlanConfigurationContent(
  content: unknown,
): PlanConfigurationValidationResult {
  const parsedJson =
    typeof content === 'string' ? parseJsonString(content) : { value: content };

  if ('error' in parsedJson) {
    return { success: false, message: parsedJson.error };
  }

  const result = planConfigurationSchema.safeParse(parsedJson.value);
  if (!result.success) {
    return {
      success: false,
      message: result.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
          return `${path}: ${issue.message}`;
        })
        .join('; '),
    };
  }

  return {
    success: true,
    value: result.data,
    canonicalContent: JSON.stringify(result.data),
  };
}

export function canonicalizePlanConfigurationContent(content: unknown): string {
  const result = validatePlanConfigurationContent(content);
  if (!result.success) {
    throw new BadRequestException(
      `Invalid plan configuration: ${result.message}`,
    );
  }
  return result.canonicalContent;
}

function parseJsonString(
  content: string,
): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(content) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `content is not valid JSON: ${error.message}`
          : 'content is not valid JSON',
    };
  }
}
