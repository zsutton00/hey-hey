import type { NextFunction, Request, Response } from 'express';
import { ReportType as PrismaReportType } from '@prisma/client';
import { ReadRestriction } from '../../generated';
import {
  ReadPolicyContext,
  readPolicyFor,
  restrictReportWhere,
  restrictTaskWhere,
} from '../read-policy';
import { readRestrictionMiddleware } from '../read-restriction.middleware';

const serve = (header: string | string[] | undefined) => {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();
  const observed: { policy?: ReturnType<typeof ReadPolicyContext.current> } =
    {};
  const next: NextFunction = () => {
    observed.policy = ReadPolicyContext.current();
  };

  readRestrictionMiddleware(
    { headers: { 'x-read-restriction': header } } as unknown as Request,
    { status, json } as unknown as Response,
    next,
  );

  return { status, json, observed };
};

describe('read policy', () => {
  it('hides Eval definitions and grading reports from an evaluated attempt', () => {
    const policy = readPolicyFor(ReadRestriction.EvalTarget);

    expect(policy.excludedTaskTypes).toEqual(['EVAL', 'EVAL_CASE']);
    expect(policy.excludedReportTypes).toEqual([
      PrismaReportType.EVAL_RUN,
      PrismaReportType.EVAL_ATTEMPT,
      PrismaReportType.EVAL_HUMAN_REVIEW,
    ]);
  });

  it('hides only grading reports from the judge, which receives its case in its payload', () => {
    const policy = readPolicyFor(ReadRestriction.EvalJudge);

    expect(policy.excludedTaskTypes).toEqual([]);
    expect(policy.excludedReportTypes).toContain(PrismaReportType.EVAL_ATTEMPT);
  });

  it('hides nothing from ordinary sessions and eval authoring', () => {
    const policy = readPolicyFor(undefined);

    expect(policy.excludedTaskTypes).toEqual([]);
    expect(policy.excludedReportTypes).toEqual([]);
    expect(restrictTaskWhere({ id: 'task' })).toEqual({ id: 'task' });
    expect(restrictReportWhere({ id: 'report' })).toEqual({ id: 'report' });
  });

  it('gives every distinct set of exclusions its own cache scope', () => {
    const scopes = [
      undefined,
      ReadRestriction.EvalTarget,
      ReadRestriction.EvalJudge,
    ].map((restriction) => readPolicyFor(restriction).scope);

    expect(new Set(scopes).size).toBe(3);
  });

  it('narrows a query to visible records without displacing the caller’s own filter', () => {
    const restricted = ReadPolicyContext.run(
      readPolicyFor(ReadRestriction.EvalTarget),
      () => restrictTaskWhere({ type: 'EVAL_CASE', projectId: 'project' }),
    );

    expect(restricted).toEqual({
      AND: [
        { type: 'EVAL_CASE', projectId: 'project' },
        { type: { notIn: ['EVAL', 'EVAL_CASE'] } },
      ],
    });
  });
});

describe('read restriction header', () => {
  it('serves the request under the policy the header names, and only that request', () => {
    const { observed } = serve(ReadRestriction.EvalTarget);

    expect(observed.policy?.excludedTaskTypes).toEqual(['EVAL', 'EVAL_CASE']);
    // The restriction belongs to that request alone.
    expect(ReadPolicyContext.current().excludedTaskTypes).toEqual([]);
  });

  it('leaves a request without the header unrestricted', () => {
    const { observed, status } = serve(undefined);

    expect(status).not.toHaveBeenCalled();
    expect(observed.policy?.excludedTaskTypes).toEqual([]);
    expect(observed.policy?.excludedReportTypes).toEqual([]);
  });

  it('refuses an unknown restriction instead of reading unrestricted', () => {
    const { observed, status, json } = serve('NOT_A_RESTRICTION');

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalled();
    // The request is not served at all, so no policy was ever applied to it.
    expect(observed).toEqual({});
  });
});
