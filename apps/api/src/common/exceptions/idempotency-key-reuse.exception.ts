import { UnprocessableEntityException } from '@nestjs/common';

/**
 * 422 for an idempotency key or operation identity that was already recorded
 * for different input. A client mistake about the request, not a conflict with
 * a resource. The same key arriving while its first request is still running
 * stays a 409 with its own code (e.g. `AGENT_OPERATION_IN_PROGRESS`).
 */
export class IdempotencyKeyReusedException extends UnprocessableEntityException {
  constructor(message: string, code = 'IDEMPOTENCY_KEY_REUSED') {
    super({ code, message });
  }
}
