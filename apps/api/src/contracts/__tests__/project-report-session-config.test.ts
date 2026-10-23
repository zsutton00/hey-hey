import { parseProjectReportSessionConfig } from '../project-report-session-config';

describe('Project report session config boundary', () => {
  const config = {
    type: 'PROJECT_REPORT',
    version: 'v1',
    model: 'configured-model',
    requestId: '87b3c597-22f9-40ee-84a4-e028c2174109',
    attemptId: '62d8d42c-a788-4356-8ce9-ebfeec603b31',
    fastMode: false,
  };
  it('preserves actual request and attempt identities and explicit false preference', () => {
    expect(parseProjectReportSessionConfig(config)).toBe(config);
  });
  it.each([
    { ...config, attemptId: undefined },
    { ...config, version: 'v2' },
    { ...config, serviceId: 'not-a-graph-only-session' },
  ])('rejects malformed config using the generated schema', (value) => {
    expect(() => parseProjectReportSessionConfig(value)).toThrow(
      'Invalid PROJECT_REPORT session config',
    );
  });
});
