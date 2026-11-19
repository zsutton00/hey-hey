import { InternalServerErrorException } from '@nestjs/common';

/** Stable machine-readable codes for faults in our own stored data or state. */
export type ServerStateErrorCode =
  | 'SESSION_MONITOR_DECISION_RESULT_INVALID'
  | 'ENTITY_PROMPT_TEMPLATE_STATE_INCONSISTENT'
  | 'PAYMENT_PROVIDER_BINDING_AMBIGUOUS'
  | 'ORGANIZATION_ACCOUNT_STATE_INCONSISTENT'
  | 'AGENT_SESSION_STATE_INCONSISTENT'
  | 'WORK_ITEM_CONFIG_STATE_INCONSISTENT';

export const SERVER_STATE_CALLER_MESSAGE =
  'The server could not complete the request because of an internal error.';

/**
 * Our own stored data or state is inconsistent; the caller cannot fix it.
 * The response is generic. `diagnostic` holds the specific cause and is
 * logged by the HTTP exception filter, never sent to the caller.
 */
export class ServerStateException extends InternalServerErrorException {
  constructor(
    readonly errorCode: ServerStateErrorCode,
    readonly diagnostic: string,
  ) {
    super({ code: errorCode, message: SERVER_STATE_CALLER_MESSAGE });
  }
}
