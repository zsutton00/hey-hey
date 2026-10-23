import { describe, expect, it } from 'vitest';
import { messageWriteFailureSchema } from './message-write-diagnostics';

describe('message write failure diagnostics', () => {
  it('preserves attachment validation and correlation without exposing HTTP payloads', () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    const reason = 'One or more Proposal attachments are missing or outside the requested scope';
    const result = messageWriteFailureSchema.parse({
      config: { headers: { authorization: 'secret-token' }, data: 'private prompt' },
      response: {
        status: 400,
        headers: { 'x-request-id': requestId, 'set-cookie': 'private-cookie' },
        data: { message: [reason, 'Invalid input: private prompt'], payload: 'private payload' },
      },
    });
    expect(result).toEqual({
      statusCode: 400,
      requestId,
      correlationId: undefined,
      validationReasons: [reason],
    });
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
  });

  it('retains HTTP status when the response body or correlation fields are malformed', () => {
    const result = messageWriteFailureSchema.parse({
      response: {
        status: 502,
        data: '<html>private gateway body</html>',
        headers: { 'x-request-id': 'Bearer private-token' },
      },
    });
    expect(result).toEqual({
      statusCode: 502,
      requestId: undefined,
      correlationId: undefined,
      validationReasons: [],
    });
  });
});
