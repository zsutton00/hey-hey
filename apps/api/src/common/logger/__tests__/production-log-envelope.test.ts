import {
  buildProductionLogEnvelope,
  serializeProductionLogEnvelope,
} from '../production-log-envelope';
import { CustomLoggerService } from '../logger.service';
import { machineEnrollmentDiagnostic } from '../../../services/machine-pairing/machine-enrollment-diagnostics';

describe('production log envelope', () => {
  it('uses deployment environment instead of NODE_ENV for telemetry identity', () => {
    const previousDeploymentEnvironment = process.env.DEPLOYMENT_ENVIRONMENT;
    const previousNodeEnvironment = process.env.NODE_ENV;
    process.env.DEPLOYMENT_ENVIRONMENT = 'staging';
    process.env.NODE_ENV = 'production';

    try {
      expect(
        buildProductionLogEnvelope({
          level: 'info',
          message: 'Staging request completed',
        }).environment,
      ).toBe('staging');
    } finally {
      if (previousDeploymentEnvironment === undefined) {
        delete process.env.DEPLOYMENT_ENVIRONMENT;
      } else {
        process.env.DEPLOYMENT_ENVIRONMENT = previousDeploymentEnvironment;
      }
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnvironment;
      }
    }
  });

  it('preserves exception messages and bounded causes while redacting credentials', () => {
    const cause = new Error('database rejected password=hidden');
    const error = new Error('stage outside canonical plan');
    Object.defineProperty(error, 'cause', { value: cause });
    Object.defineProperty(cause, 'cause', { value: error });
    const record = JSON.parse(
      serializeProductionLogEnvelope({
        level: 'error',
        message: 'Activity failed',
        attributes: { includeErrorDetails: true },
        error,
      }),
    );
    expect(record.errorMessage).toBe('stage outside canonical plan');
    expect(record.errorCause).toContain('database rejected');
    expect(record.errorCause).toContain('[circular cause]');
    expect(record.errorCause).not.toContain('hidden');
    expect(record.errorStack).toContain('at ');
  });

  it('keeps request correlation and a distinct diagnostic correlation', () => {
    const record = JSON.parse(
      serializeProductionLogEnvelope({
        level: 'error',
        message: 'Generic change-set checkpoint failed',
        context: { correlationId: 'request-correlation' },
        attributes: { diagnosticCorrelationId: 'diagnostic-correlation' },
      }),
    ) as Record<string, unknown>;

    expect(record.correlationId).toBe('request-correlation');
    expect(record.diagnosticCorrelationId).toBe('diagnostic-correlation');
  });

  it('emits parseable JSON with stable context and bounded fields', () => {
    const line = serializeProductionLogEnvelope({
      level: 'info',
      message: 'HTTP request completed',
      timestamp: '2026-08-13T20:00:00.000Z',
      source: 'http',
      context: {
        requestId: 'request-1',
        correlationId: 'correlation-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        agentSessionId: 'session-1',
      },
      attributes: {
        method: 'GET',
        path: '/api/v1/projects/project-1',
        statusCode: 200,
        responseTimeMs: 14,
        payload: { privateMessage: 'do not emit' },
      },
    });

    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record).toMatchObject({
      schemaVersion: 1,
      timestamp: '2026-08-13T20:00:00.000Z',
      level: 'info',
      source: 'http',
      requestId: 'request-1',
      correlationId: 'correlation-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: 'session-1',
      method: 'GET',
      statusCode: 200,
      responseTimeMs: 14,
    });
    expect(record.payload).toBeUndefined();
    expect(record.path).toBe('/api/v1/projects/project-1');
  });

  it('redacts credentials and omits private structured payloads', () => {
    const record = buildProductionLogEnvelope({
      level: 'error',
      message:
        'Request failed with authorization: Bearer secret-token password=hunter2',
      attributes: {
        requestBody: { message: 'private user message' },
        prompt: 'private source code prompt',
        error: { message: 'private payload' },
      },
    });

    expect(record.message).not.toContain('secret-token');
    expect(record.message).not.toContain('hunter2');
    expect(record).not.toHaveProperty('requestBody');
    expect(record).not.toHaveProperty('prompt');
    expect(record).not.toHaveProperty('error');
  });

  it('retains bounded primitive metadata as queryable envelope fields', () => {
    const record = buildProductionLogEnvelope({
      level: 'info',
      message: 'Webhook decision recorded',
      attributes: {
        reasonCode: 'duplicate_delivery',
        entityId: 'entity-1',
        decision: 'ignored',
        attemptCount: 2,
        retryable: false,
        promptType: 'workflow_kickoff',
      },
    });

    expect(record).toMatchObject({
      reasonCode: 'duplicate_delivery',
      entityId: 'entity-1',
      decision: 'ignored',
      attemptCount: 2,
      retryable: false,
      promptType: 'workflow_kickoff',
    });
  });

  it('retains structured diagnostic issues across the shared envelope serializer', () => {
    const record = buildProductionLogEnvelope({
      level: 'warn',
      message: 'Rejecting invalid change set',
      attributes: {
        issueCount: 1,
        issues: [
          {
            field: 'operations[0].name',
            code: 'required',
            reason: 'Name is required',
            layer: 'structural',
            suggestion: 'Provide a name',
            metadata: {
              operationIndex: 0,
              entityId: 'temporary:root',
              requestBody: 'private payload',
              authorization: 'Bearer private-token',
            },
          },
        ],
      },
    });

    expect(record.issues).toEqual([
      {
        field: 'operations[0].name',
        code: 'required',
        reason: 'Name is required',
        layer: 'structural',
        suggestion: 'Provide a name',
        metadata: {
          operationIndex: 0,
          entityId: 'temporary:root',
        },
      },
    ]);
    expect(record.issueCount).toBe(1);
    expect(record.issuesTruncated).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('private payload');
    expect(JSON.stringify(record)).not.toContain('private-token');
  });

  it('bounds oversized diagnostic issue arrays and records truncation', () => {
    const record = buildProductionLogEnvelope({
      level: 'warn',
      message: 'Validation failed',
      attributes: {
        issues: Array.from({ length: 40 }, (_, index) => ({
          field: `operations[${index}].name`,
          code: 'invalid',
          reason: 'Invalid value',
        })),
      },
    });

    expect(record.issues).toHaveLength(32);
    expect(record.issuesTruncated).toBe(true);
    expect(record.issuesTotalCount).toBe(40);
    expect(
      Buffer.byteLength(JSON.stringify(record.issues), 'utf8'),
    ).toBeLessThanOrEqual(16_384);
  });

  it('preserves the privacy-bounded enrollment lifecycle envelope', () => {
    const attributes = machineEnrollmentDiagnostic('begin_claim', {
      enrollmentId: 'enrollment-1',
      machineId: 'machine-1',
      organizationId: 'organization-1',
      state: 'browser_claimed',
      decision: 'resume',
      reasonCode: 'claim_state_decision',
      userCode: 'BCDFG-HJKLM',
      deviceSecret: 'private-device-secret',
      signature: 'private-signature',
      credential: 'private-webauthn-credential',
    });
    const record = buildProductionLogEnvelope({
      level: 'info',
      message: 'Machine enrollment begin claim decided',
      attributes,
    });

    expect(record).toMatchObject({
      event: 'machine_enrollment.begin_claim',
      operation: 'machine_enrollment',
      protocolVersion: 2,
      contractVersion: 'machine-enrollment-v2',
      enrollmentId: 'enrollment-1',
      machineId: 'machine-1',
      organizationId: 'organization-1',
      state: 'browser_claimed',
      decision: 'resume',
      reasonCode: 'claim_state_decision',
    });
    expect(record).not.toHaveProperty('userCode');
    expect(record).not.toHaveProperty('deviceSecret');
    expect(record).not.toHaveProperty('signature');
    expect(record).not.toHaveProperty('credential');
  });

  it('filters private metadata keys and nested values', () => {
    const record = buildProductionLogEnvelope({
      level: 'info',
      message: 'Request decision recorded',
      attributes: {
        accessToken: 'secret-token',
        requestHeaders: 'authorization=secret-token',
        requestPayload: 'private payload',
        prompt: 'private prompt',
        boundedDecision: {
          accepted: true,
          reasons: ['safe diagnostic context'],
        },
        reason: 'authorization: Bearer secret-token',
      },
    });

    expect(record).not.toHaveProperty('accessToken');
    expect(record).not.toHaveProperty('requestHeaders');
    expect(record).not.toHaveProperty('requestPayload');
    expect(record).not.toHaveProperty('prompt');
    expect(record.boundedDecision).toEqual({
      accepted: true,
      reasons: ['safe diagnostic context'],
    });
    expect(record.reason).toContain('[REDACTED]');
    expect(record.reason).not.toContain('secret-token');
  });

  it('retains arbitrary arrays and objects under their original attribute names', () => {
    const circular: Record<string, unknown> = { name: 'cycle' };
    circular.self = circular;
    const record = buildProductionLogEnvelope({
      level: 'debug',
      message: 'Structured decision recorded',
      attributes: {
        decision: {
          accepted: true,
          reasons: ['matched_rule', 'within_limit'],
          metadata: {
            operationIndex: 2,
            authorization: 'Bearer private-token',
          },
        },
        candidates: ['alpha', { id: 'candidate-2', score: 0.9 }],
        circular,
      },
    });

    expect(record.decision).toEqual({
      accepted: true,
      reasons: ['matched_rule', 'within_limit'],
      metadata: { operationIndex: 2 },
    });
    expect(record.candidates).toEqual([
      'alpha',
      { id: 'candidate-2', score: 0.9 },
    ]);
    expect(record.circular).toEqual({ name: 'cycle', self: '[Circular]' });
    expect(record.structuredAttributesTruncated).toEqual(['circular']);
    expect(JSON.stringify(record)).not.toContain('private-token');
  });

  it('bounds arbitrary structured arrays and records which fields were truncated', () => {
    const record = buildProductionLogEnvelope({
      level: 'debug',
      message: 'Candidate list recorded',
      attributes: {
        candidateIds: Array.from(
          { length: 40 },
          (_, index) => `candidate-${index}`,
        ),
      },
    });

    expect(record.candidateIds).toHaveLength(32);
    expect(record.structuredAttributesTruncated).toEqual(['candidateIds']);
    expect(
      Buffer.byteLength(JSON.stringify(record.candidateIds), 'utf8'),
    ).toBeLessThanOrEqual(16_384);
  });

  it('does not emit untrusted error text as a message or stack', () => {
    const record = buildProductionLogEnvelope({
      level: 'error',
      message: 'Application error',
      attributes: {
        error: 'private message body',
        stack: 'Error: private message body\n    at handler (service.js:1:1)',
      },
    });

    expect(record.message).toBe('Application error');
    expect(record.errorStack).toBe('at handler (service.js:1:1)');
    expect(record.caller_error).toBe('private message body');
  });

  it('adds a valid traceId only from the active context fields', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const record = buildProductionLogEnvelope({
      level: 'info',
      message: 'Request completed',
      context: { traceId, traceSampled: false },
      attributes: { traceId: 'caller-provided-trace-id', traceSampled: true },
    });

    expect(record.traceId).toBe(traceId);
    expect(record.traceSampled).toBe(false);
    expect(record.caller_traceId).toBe('caller-provided-trace-id');
  });

  it('omits malformed and all-zero trace identifiers', () => {
    const malformed = buildProductionLogEnvelope({
      level: 'info',
      message: 'Request completed',
      context: { traceId: 'trace-123' },
    });
    const unset = buildProductionLogEnvelope({
      level: 'info',
      message: 'Request completed',
      context: { traceId: '00000000000000000000000000000000' },
    });

    expect(malformed.traceId).toBeUndefined();
    expect(unset.traceId).toBeUndefined();
  });
});

describe('production Nest logger argument normalization', () => {
  const previousLogLevel = process.env.LOG_LEVEL;
  let logger: CustomLoggerService;

  beforeAll(() => {
    process.env.LOG_LEVEL = 'silent';
    logger = new CustomLoggerService();
  });

  afterAll(() => {
    if (previousLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previousLogLevel;
    }
  });

  it('keeps ordinary messages separate from Nest context strings', () => {
    const record = logger.buildEnvelopeForTest(
      'info',
      'Service started',
      'ExampleService',
    );

    expect(record.message).toBe('Service started');
    expect(record.component).toBe('ExampleService');
    expect(record.message).not.toContain('[object Object]');
  });

  it('retains metadata followed by a Nest context string', () => {
    const record = logger.buildEnvelopeForTest(
      'info',
      'Access decision recorded',
      {
        reasonCode: 'private_beta_required',
        organizationId: 'organization-1',
        approved: false,
        candidateCount: 3,
      },
      'AccessDecisionService',
    );

    expect(record).toMatchObject({
      message: 'Access decision recorded',
      component: 'AccessDecisionService',
      reasonCode: 'private_beta_required',
      organizationId: 'organization-1',
      approved: false,
      candidateCount: 3,
    });
    expect(JSON.stringify(record)).not.toContain('[object Object]');
  });

  it('does not let metadata replace or extend the canonical message', () => {
    const record = logger.buildEnvelopeForTest(
      'info',
      'Access decision recorded',
      {
        message: 'private metadata message',
        reasonCode: 'access_denied',
      },
      'AccessDecisionService',
    );

    expect(record).toMatchObject({
      message: 'Access decision recorded',
      component: 'AccessDecisionService',
      reasonCode: 'access_denied',
    });
    expect(record.caller_message).toBe('private metadata message');
  });

  it('normalizes Error objects, metadata, stacks, and Nest context together', () => {
    const error = new TypeError('private failure detail');
    error.stack =
      'TypeError: private failure detail\n    at handler (service.js:1:1)';

    const record = logger.buildEnvelopeForTest(
      'error',
      'Operation failed',
      error,
      { reasonCode: 'operation_failed', entityId: 'entity-1' },
      'OperationService',
    );

    expect(record).toMatchObject({
      message: 'Application error',
      component: 'OperationService',
      reasonCode: 'operation_failed',
      entityId: 'entity-1',
      errorName: 'TypeError',
      errorStack: 'at handler (service.js:1:1)',
    });
    expect(JSON.stringify(record)).not.toContain('private failure detail');
  });

  it('preserves supplied Error details through the Winston formatter', () => {
    const previousLevel = process.env.LOG_LEVEL;
    const stderr = (console as unknown as { _stderr: NodeJS.WriteStream })
      ._stderr;
    const stderrWrite = jest
      .spyOn(stderr, 'write')
      .mockImplementation((() => true) as typeof stderr.write);
    process.env.LOG_LEVEL = 'error';

    try {
      const activeLogger = new CustomLoggerService();
      const error = new TypeError('private runtime failure detail');
      error.stack =
        'TypeError: private runtime failure detail\n    at runtimeHandler (runtime.js:1:1)';

      activeLogger.error(
        'Runtime operation failed',
        error,
        'RuntimeOperationService',
      );

      const line = String(stderrWrite.mock.calls.at(-1)?.[0] ?? '').trim();
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(record).toMatchObject({
        message: 'Application error',
        component: 'RuntimeOperationService',
        errorName: 'TypeError',
        errorStack: 'at runtimeHandler (runtime.js:1:1)',
      });
      expect(line).not.toContain('private runtime failure detail');
    } finally {
      process.env.LOG_LEVEL = previousLevel;
      stderrWrite.mockRestore();
    }
  });

  it('recognizes the standard message, stack, and context error shape', () => {
    const record = logger.buildEnvelopeForTest(
      'error',
      'Operation failed',
      'Error: private detail\n    at handler (service.js:2:2)',
      'OperationService',
    );

    expect(record).toMatchObject({
      message: 'Application error',
      component: 'OperationService',
      errorStack: 'at handler (service.js:2:2)',
    });
    expect(JSON.stringify(record)).not.toContain('private detail');
  });

  it('distinguishes a stack from context when no Nest context is present', () => {
    const record = logger.buildEnvelopeForTest(
      'error',
      'Static logger failed',
      'Error: private detail\n    at handler (service.js:3:3)',
    );

    expect(record).toMatchObject({
      message: 'Application error',
      errorStack: 'at handler (service.js:3:3)',
    });
    expect(record.component).toBeUndefined();
  });
});
