import { BadRequestException } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { ProposalReviewNoteDto } from '@hey-hey/contracts/api/models';
import { proposalReviewNoteSchema } from '@hey-hey/contracts/api/custom/proposal-reconciliation.schema';

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile<ProposalReviewNoteDto>(proposalReviewNoteSchema);

export function parseProposalReviewNote(input: unknown): ProposalReviewNoteDto {
  if (!validate(input)) {
    throw new BadRequestException({
      message: 'Review note violates the OpenAPI contract',
      errors: validate.errors,
    });
  }
  return input;
}
