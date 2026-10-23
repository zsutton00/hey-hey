import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { CreateProposalReconciliationCandidate } from '../generated';
import { proposalReconciliationCandidateSchema } from '../generated/proposal-reconciliation.schema';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);
const validate = ajv.compile<CreateProposalReconciliationCandidate>(
  proposalReconciliationCandidateSchema,
);

@Injectable()
export class ProposalReconciliationCandidatePipe
  implements PipeTransform<unknown, CreateProposalReconciliationCandidate>
{
  transform(value: unknown): CreateProposalReconciliationCandidate {
    if (!validate(value))
      throw new BadRequestException(
        'Reconciliation input does not match the API contract.',
      );
    return value;
  }
}
