import { NotFoundException } from '@nestjs/common';

/** Stable machine-readable codes for requests that name a record that does not exist. */
export type MissingRecordErrorCode =
  | 'ORGANIZATION_NOT_FOUND'
  | 'AGENT_SESSION_NOT_FOUND'
  | 'ENTITY_PROMPT_TEMPLATE_NOT_FOUND';

export class MissingRecordException extends NotFoundException {
  constructor(code: MissingRecordErrorCode, message: string) {
    super({ code, message });
  }
}
