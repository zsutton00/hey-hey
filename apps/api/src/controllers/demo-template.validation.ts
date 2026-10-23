import { BadRequestException, PipeTransform } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { SetDemoTemplateDto } from '../generated';
import { setDemoTemplateJsonSchema } from '../generated/demo-sandbox.schema';

const validate = addFormats(
  new Ajv({ allErrors: true }),
).compile<SetDemoTemplateDto>(setDemoTemplateJsonSchema);

export class SetDemoTemplatePipe
  implements PipeTransform<unknown, SetDemoTemplateDto>
{
  transform(value: unknown): SetDemoTemplateDto {
    if (!validate(value))
      throw new BadRequestException('Invalid demo template designation');
    return value;
  }
}
