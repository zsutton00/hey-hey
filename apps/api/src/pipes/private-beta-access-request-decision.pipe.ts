import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv';
import type { PrivateBetaAccessRequestDecisionInputDto } from '../generated';
import { privateBetaAccessRequestDecisionInputJsonSchema } from '../generated/private-beta-access-request-decision.schema';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});

const validateDecision: ValidateFunction<PrivateBetaAccessRequestDecisionInputDto> =
  ajv.compile<PrivateBetaAccessRequestDecisionInputDto>(
    privateBetaAccessRequestDecisionInputJsonSchema,
  );

@Injectable()
export class PrivateBetaAccessRequestDecisionPipe
  implements PipeTransform<unknown, PrivateBetaAccessRequestDecisionInputDto>
{
  transform(value: unknown): PrivateBetaAccessRequestDecisionInputDto {
    if (!validateDecision(value)) {
      throw new BadRequestException(
        'Private-beta decision input does not match the API contract.',
      );
    }
    return value;
  }
}
