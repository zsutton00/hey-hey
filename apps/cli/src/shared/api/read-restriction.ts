import { ReadRestriction } from './generated/api';
import { Configuration, type ConfigurationParameters } from './generated/configuration';

/** Header the platform API reads to decide which records a request may discover and read. */
export const READ_RESTRICTION_HEADER = 'X-Read-Restriction';

/**
 * The restriction an execution's platform reads run under. An inert Run is an evaluated attempt
 * and cannot find grading material; the judge of an attempt cannot read live grading reports.
 * Derived from the Run, never chosen by the model.
 */
export const readRestrictionFor = (execution: {
  readonly inert?: boolean | undefined;
  readonly judge?: boolean | undefined;
}): ReadRestriction | undefined => {
  if (execution.inert === true) {
    return ReadRestriction.EvalTarget;
  }

  return execution.judge === true ? ReadRestriction.EvalJudge : undefined;
};

export const readRestrictionHeaders = (
  restriction: ReadRestriction | undefined,
): Record<string, string> => (restriction ? { [READ_RESTRICTION_HEADER]: restriction } : {});

/** A client configuration whose every request carries the execution's read restriction. */
export const restrictedConfiguration = (
  parameters: ConfigurationParameters,
  restriction: ReadRestriction | undefined,
): Configuration =>
  new Configuration({
    ...parameters,
    ...(restriction
      ? {
          baseOptions: {
            ...parameters.baseOptions,
            headers: {
              ...parameters.baseOptions?.headers,
              ...readRestrictionHeaders(restriction),
            },
          },
        }
      : {}),
  });
