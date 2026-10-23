import { HttpException, HttpStatus } from '@nestjs/common';

export class VersionConflictException extends HttpException {
  constructor(
    message: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
    public readonly conflictingFields?: string[],
  ) {
    super(
      {
        code: 'VERSION_CONFLICT',
        message,
        expectedVersion,
        actualVersion,
        conflictingFields,
      },
      HttpStatus.CONFLICT,
    );
  }
}
