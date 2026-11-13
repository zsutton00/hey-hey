import { SAVED_POLICY_INVALID_CODE } from './approval-policy-read-diagnostic';
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { approvalPolicySchema } from 'src/generated/approval-policy.schema';
import type {
  ProjectApprovalPolicyReplaceRequest,
  ProjectApprovalPolicyRestoreRequest,
  ProjectApprovalPolicyRule,
  ProjectApprovalPolicyValidationIssue,
} from 'src/generated';
import { WorkItemTypeRegistryService } from 'src/services/tasks/work-item-type-registry.service';
import type { ProjectId } from 'src/types';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
function validator<T>(name: string): ValidateFunction<T> {
  return ajv.compile<T>({
    ...approvalPolicySchema,
    $ref: `#/definitions/${name}`,
  });
}
const replaceValidator = validator<ProjectApprovalPolicyReplaceRequest>(
  'ProjectApprovalPolicyReplaceRequest',
);
const restoreValidator = validator<ProjectApprovalPolicyRestoreRequest>(
  'ProjectApprovalPolicyRestoreRequest',
);

@Injectable()
export class ProjectApprovalPolicyValidation {
  private readonly logger = new Logger(ProjectApprovalPolicyValidation.name);
  constructor(
    @Inject(WorkItemTypeRegistryService)
    private readonly registry: Pick<
      WorkItemTypeRegistryService,
      'isTypeActiveForProject'
    >,
  ) {}

  replacement(
    value: unknown,
    projectId: ProjectId,
    storedRules: unknown,
  ): ProjectApprovalPolicyReplaceRequest {
    if (!replaceValidator(value)) {
      this.reject(projectId, this.schemaIssues(replaceValidator));
    }
    const issues = [
      ...this.countIssues(value.rules),
      ...this.topLevelIssues(value.rules),
      ...this.typeIssues(
        value.rules,
        projectId,
        this.storedTypeKeys(storedRules),
      ),
    ];
    if (issues.length > 0) {
      this.reject(projectId, issues);
    }
    return value;
  }

  restore(value: unknown): ProjectApprovalPolicyRestoreRequest {
    if (!restoreValidator(value)) {
      this.logger.warn('Project approval policy restore validation rejected');
      throw new BadRequestException({
        code: 'PROJECT_APPROVAL_POLICY_VALIDATION_FAILED',
        message: 'Invalid revision',
        issues: this.schemaIssues(restoreValidator),
      });
    }
    return value;
  }

  saved(rules: unknown, projectId: ProjectId): ProjectApprovalPolicyRule[] {
    const value = { expectedRevision: 0, rules };
    // A stored selector may name a type retired since it was saved; only the
    // document's structure decides whether it can be read.
    if (!replaceValidator(value) || this.countIssues(value.rules).length > 0) {
      this.logger.error('Malformed saved project approval policy', {
        projectId,
      });
      throw new InternalServerErrorException({
        code: SAVED_POLICY_INVALID_CODE,
        message: 'Saved project approval policy is invalid',
      });
    }
    return value.rules;
  }

  private reject(
    projectId: ProjectId,
    issues: ProjectApprovalPolicyValidationIssue[],
  ): never {
    this.logger.warn('Project approval policy validation rejected', {
      projectId,
      paths: issues.map((issue) => issue.path),
    });
    throw new BadRequestException({
      code: 'PROJECT_APPROVAL_POLICY_VALIDATION_FAILED',
      message: 'Invalid approval policy',
      issues,
    });
  }

  private schemaIssues<T>(
    validate: ValidateFunction<T>,
  ): ProjectApprovalPolicyValidationIssue[] {
    return (validate.errors ?? []).map((error) => ({
      path:
        `${error.instancePath}${error.keyword === 'additionalProperties' ? '/' + error.params.additionalProperty : error.keyword === 'required' ? '/' + error.params.missingProperty : ''}` ||
        '/',
      message: error.message ?? 'Invalid value',
    }));
  }

  // Selectors already saved may be kept even after their type is retired.
  private storedTypeKeys(storedRules: unknown): Set<string> {
    const stored = { expectedRevision: 0, rules: storedRules };
    if (!replaceValidator(stored)) {
      return new Set();
    }
    return new Set(
      stored.rules.flatMap((rule) => rule.conditions.typeKey ?? []),
    );
  }

  private typeIssues(
    rules: ProjectApprovalPolicyRule[],
    projectId: ProjectId,
    retained: Set<string>,
  ): ProjectApprovalPolicyValidationIssue[] {
    const issues: ProjectApprovalPolicyValidationIssue[] = [];
    rules.forEach((rule, index) => {
      const typeKey = rule.conditions.typeKey;
      if (
        typeKey !== undefined &&
        !retained.has(typeKey) &&
        !this.registry.isTypeActiveForProject(typeKey, projectId)
      ) {
        issues.push({
          path: `/rules/${index}/conditions/typeKey`,
          message: 'Select an active effective work-item type key',
        });
      }
    });
    return issues;
  }

  private topLevelIssues(
    rules: ProjectApprovalPolicyRule[],
  ): ProjectApprovalPolicyValidationIssue[] {
    return rules.flatMap((rule, index) =>
      rule.conditions.topLevel !== undefined &&
      rule.conditions.typeKey !== 'FEATURE'
        ? [
            {
              path: `/rules/${index}/conditions/topLevel`,
              message: 'Top-level can only be set on Feature rules',
            },
          ]
        : [],
    );
  }

  private countIssues(
    rules: ProjectApprovalPolicyRule[],
  ): ProjectApprovalPolicyValidationIssue[] {
    const issues: ProjectApprovalPolicyValidationIssue[] = [];
    rules.forEach((rule, index) => {
      const validCount =
        Number.isSafeInteger(rule.requiredApprovals) &&
        (rule.requirement === 'IMMEDIATE'
          ? rule.requiredApprovals === 0
          : rule.requiredApprovals > 0);
      if (!validCount) {
        issues.push({
          path: `/rules/${index}/requiredApprovals`,
          message:
            'IMMEDIATE requires zero; PROJECT_REQUIRED requires a positive supported integer',
        });
      }
    });
    return issues;
  }
}
