import { vi } from 'vitest';
import { CreateReportProxy } from './create-report-proxy';
import { ReportEmissionEvents } from './report-emission-events';
import { SubmissionToolAuth } from './submission-tool-auth';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../auth/oauth-client.test-support';

export const makeCreateReportProxy = (): CreateReportProxy => {
  const proxy = new CreateReportProxy({
    auth: new SubmissionToolAuth(createProviderTestOAuthClient()),
    apiBaseUrl: 'https://api.test/v1',
    fetchImpl: (() =>
      Promise.reject(
        new Error('CreateReportProxy test fetch was called unexpectedly.'),
      )) as typeof fetch,
    reportEmissionEvents: new ReportEmissionEvents(),
  });
  vi.spyOn(proxy, 'create').mockRejectedValue(
    new Error('CreateReportProxy test create was called without a configured result.'),
  );
  return proxy;
};
