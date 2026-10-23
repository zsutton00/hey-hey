import { CreateReportProxy } from './submission-tools/create-report-proxy';
import { ReportEmissionEvents } from './submission-tools/report-emission-events';
import { SubmissionToolAuth } from './submission-tools/submission-tool-auth';
import type { PromptTypeRegistryDependencies } from './prompt-type-registry';
import { NOOP_LOGGER } from '../server/logger';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../auth/oauth-client.test-support';
import { PlanSubmissionAdmissionClient } from './plan-shaping/plan-submission-admission.client';

const unusedAuth = new SubmissionToolAuth(
  createProviderTestOAuthClient({
    success: false,
    error: 'Prompt-type registry test auth was called unexpectedly.',
  }),
);

const apiBaseUrl = 'https://api.example.test/api/v1';
const unusedFetch = (() =>
  Promise.reject(
    new Error('Prompt-type registry test fetch was called unexpectedly.'),
  )) as typeof fetch;

export const PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES = {
  createReportProxy: new CreateReportProxy({
    auth: unusedAuth,
    apiBaseUrl,
    reportEmissionEvents: new ReportEmissionEvents(),
  }),
  entityConversation: {
    auth: unusedAuth,
    apiBaseUrl,
    fetchImpl: unusedFetch,
    logger: NOOP_LOGGER,
  },
  planSubmissionAdmissionClient: new PlanSubmissionAdmissionClient({
    auth: unusedAuth,
    apiBaseUrl,
    createClient: () =>
      ({
        admitPlanSubmission: () =>
          Promise.reject(new Error('Test admission client was called unexpectedly.')),
      }) as never,
  }),
} satisfies PromptTypeRegistryDependencies;
