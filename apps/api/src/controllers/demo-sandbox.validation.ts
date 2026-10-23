import { BadRequestException, PipeTransform } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type {
  DemoSandboxProgramDto,
  ProvisionDemoSandboxDto,
} from '../generated';
import {
  demoSandboxProgramJsonSchema,
  provisionDemoSandboxJsonSchema,
} from '../generated/demo-sandbox.schema';

const ajv = addFormats(new Ajv({ allErrors: true }));
const validateProvision = ajv.compile<ProvisionDemoSandboxDto>(
  provisionDemoSandboxJsonSchema,
);
const validateProgram = ajv.compile<DemoSandboxProgramDto>(
  demoSandboxProgramJsonSchema,
);

export class ProvisionDemoSandboxPipe
  implements PipeTransform<unknown, ProvisionDemoSandboxDto>
{
  transform(value: unknown): ProvisionDemoSandboxDto {
    if (!validateProvision(value))
      throw new BadRequestException('Invalid demo sandbox request');
    return value;
  }
}

export class DemoSandboxProgramPipe
  implements PipeTransform<unknown, DemoSandboxProgramDto>
{
  transform(value: unknown): DemoSandboxProgramDto {
    if (!validateProgram(value))
      throw new BadRequestException('Invalid demo sandbox program');
    return value;
  }
}
