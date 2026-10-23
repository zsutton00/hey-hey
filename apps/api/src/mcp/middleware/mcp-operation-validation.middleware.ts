import { BadRequestException, Injectable } from '@nestjs/common';
import {
  McpOperationCatalogEntry,
  McpProposeValidationErrorEnvelope,
  ProposalValidationIssue,
} from '../../generated';
import {
  McpOperationInputPayload,
  McpScopeRequirement,
  getMcpOperationInputSchema,
} from '../schemas/mcp-operation-input.schema';
import {
  McpOperationId,
  getMcpOperationCatalogEntry,
} from '../operation-catalog';
import { z } from 'zod';

function toFieldPath(path: (string | number)[]): string {
  if (path.length === 0) {
    return '$';
  }

  return path.reduce<string>((fieldPath, segment) => {
    if (typeof segment === 'number') {
      return `${fieldPath}[${segment}]`;
    }
    return fieldPath.length === 0 ? segment : `${fieldPath}.${segment}`;
  }, '');
}

function toIssueCode(issue: z.ZodIssue): string {
  if (
    issue.code === z.ZodIssueCode.invalid_type &&
    issue.received === 'undefined'
  ) {
    return 'required';
  }

  if (issue.code === z.ZodIssueCode.invalid_enum_value) {
    return 'invalid_enum';
  }

  if (issue.code === z.ZodIssueCode.custom) {
    const customIssue = issue as z.ZodCustomIssue;
    const customCode = customIssue.params?.errorCode;
    if (typeof customCode === 'string' && customCode.length > 0) {
      return customCode;
    }
  }

  return issue.code;
}

function toValidationIssue(issue: z.ZodIssue): ProposalValidationIssue {
  return {
    field: toFieldPath(issue.path),
    code: toIssueCode(issue),
    reason: issue.message,
    layer: 'structural',
  };
}

export function createMcpValidationErrorEnvelope(
  issues: z.ZodIssue[],
): McpProposeValidationErrorEnvelope {
  return {
    error: {
      code: 'validation_error',
      message: 'MCP operation payload validation failed',
      details: {
        validationErrors: issues.map(toValidationIssue),
      },
    },
  };
}

@Injectable()
export class McpOperationValidationMiddleware {
  validateForOperation(
    operationId: McpOperationId,
    payload: unknown,
  ): McpOperationInputPayload {
    return this.validatePayload(
      getMcpOperationCatalogEntry(operationId),
      payload,
    );
  }

  validatePayload(
    operation: McpOperationCatalogEntry,
    payload: unknown,
  ): McpOperationInputPayload {
    const schema = getMcpOperationInputSchema(
      operation.requiredScope as ReadonlyArray<McpScopeRequirement>,
    );

    const parsed = schema.safeParse(payload);
    if (parsed.success) {
      return parsed.data;
    }

    throw new BadRequestException(
      createMcpValidationErrorEnvelope(parsed.error.issues),
    );
  }
}
