import { BadRequestException } from '@nestjs/common';

export class JobNonRetryableException extends BadRequestException {
  constructor(
    message: string,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'JobNonRetryableException';
  }
}
