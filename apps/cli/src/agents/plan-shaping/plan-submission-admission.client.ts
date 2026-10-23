import {
  PlansApi,
  type PlanSubmissionAdmissionRequest,
  type PlanSubmissionAdmissionResponse,
} from '../../shared/api/generated/api';
import { Configuration } from '../../shared/api/generated/configuration';
import type { Run } from '../../run/run';
import { NOOP_LOGGER, type ServerLogger } from '../../server/logger';
import type { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';

export interface PlanSubmissionAdmissionClientOptions {
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  logger?: ServerLogger;
  createClient?: (accessToken: string) => Pick<PlansApi, 'admitPlanSubmission'>;
}

type AdmissionRequestWithoutContext = PlanSubmissionAdmissionRequest extends infer TRequest
  ? TRequest extends PlanSubmissionAdmissionRequest
    ? Omit<TRequest, 'conversationId' | 'triggerMessageId'>
    : never
  : never;

export class PlanSubmissionAdmissionClient {
  private readonly logger: ServerLogger;
  private readonly auth: SubmissionToolAuth;
  private readonly createClient: (accessToken: string) => Pick<PlansApi, 'admitPlanSubmission'>;

  constructor(options: PlanSubmissionAdmissionClientOptions) {
    this.auth = options.auth;
    this.logger = options.logger ?? NOOP_LOGGER;
    this.createClient =
      options.createClient ??
      ((accessToken) =>
        new PlansApi(new Configuration({ accessToken, basePath: options.apiBaseUrl })));
  }

  async admit(
    run: Run,
    request: AdmissionRequestWithoutContext,
  ): Promise<PlanSubmissionAdmissionResponse> {
    const turn = run.activeTurn;
    const payload = turn?.payload;
    const planId =
      payload !== null &&
      typeof payload === 'object' &&
      'planId' in payload &&
      typeof payload.planId === 'string'
        ? payload.planId
        : null;
    const triggerMessageId = turn?.triggerMessageId;
    const missing = [
      ...(!planId ? ['active turn payload.planId'] : []),
      ...(!triggerMessageId ? ['active turn triggerMessageId'] : []),
    ];
    this.logger.debug('plan_submission.admission.context', {
      runId: run.runId,
      turnId: turn?.turnId ?? null,
      planId,
      triggerMessageId: triggerMessageId ?? null,
      kind: request.kind,
      missing,
    });
    if (!planId || !triggerMessageId) {
      throw new Error(`Plan submission admission requires ${missing.join(' and ')}.`);
    }
    const accessToken = await this.auth.getAccessToken();
    const planSubmissionAdmissionRequest = {
      ...request,
      conversationId: run.conversationId,
      triggerMessageId,
    } satisfies PlanSubmissionAdmissionRequest;
    const response = await this.createClient(accessToken).admitPlanSubmission({
      organizationId: run.organizationId,
      projectId: run.projectId,
      taskId: planId,
      planSubmissionAdmissionRequest,
    });
    this.logger.debug('plan_submission.admission.result', {
      runId: run.runId,
      planId,
      triggerMessageId,
      status: response.data.status,
    });
    return response.data;
  }
}
