import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';

import { MachineEnrollmentError, toMachineEnrollmentError } from '../machine-enrollment';

const makeAxiosError = (status: number, body: object): AxiosError => {
  const response: AxiosResponse = {
    data: body,
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return new AxiosError(
    `Request failed with status code ${String(status)}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    response,
  );
};

describe('toMachineEnrollmentError', () => {
  it('passes a MachineEnrollmentError through unchanged', () => {
    const original = new MachineEnrollmentError('Slow down.', 'RATE_LIMITED');

    expect(toMachineEnrollmentError(original)).toBe(original);
  });

  it('maps invalid enrollment material and preserves the server message', () => {
    const error = toMachineEnrollmentError(
      makeAxiosError(400, {
        success: false,
        code: 'INVALID_MACHINE_MATERIAL',
        message: 'Invalid machine enrollment request.',
      }),
    );

    expect(error).toBeInstanceOf(MachineEnrollmentError);
    expect(error.code).toBe('INVALID_MACHINE_MATERIAL');
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Invalid machine enrollment request.');
  });

  it('maps enrollment creation rate limits and carries retryAfterSeconds', () => {
    const error = toMachineEnrollmentError(
      makeAxiosError(429, {
        success: false,
        code: 'ENROLLMENT_CREATION_RATE_LIMITED',
        message: 'Too many enrollment attempts. Try again later.',
        retryAfterSeconds: 540,
      }),
    );

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.statusCode).toBe(429);
    expect(error.retryAfterSeconds).toBe(540);
  });

  it('maps an axios error with no response to NETWORK_ERROR', () => {
    const error = toMachineEnrollmentError(new AxiosError('connection refused', 'ECONNREFUSED'));

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.statusCode).toBeUndefined();
  });

  it('names the attempted URL and transport cause in a network failure', () => {
    const error = toMachineEnrollmentError(
      new AxiosError('connect ECONNREFUSED 127.0.0.1:45063', 'ECONNREFUSED', {
        headers: new AxiosHeaders(),
        url: 'http://pro-rep.localhost:45063/api/v1/machines/enrollments',
      }),
    );

    expect(error.message).toBe(
      'Could not reach the Hey Hey API at http://pro-rep.localhost:45063/api/v1/machines/enrollments to open an enrollment (ECONNREFUSED).',
    );
  });

  it('maps a non-axios Error to UNEXPECTED and preserves its message', () => {
    const error = toMachineEnrollmentError(new Error('something broke'));

    expect(error.code).toBe('UNEXPECTED');
    expect(error.message).toBe('something broke');
  });
});
