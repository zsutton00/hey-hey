import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { ControllerManagementOutcomeCode } from '../../generated';

const CONTROLLER_MANAGEMENT_MESSAGE =
  'Unable to complete controller management operation.' as const;

export class ControllerManagementException extends HttpException {
  constructor(
    readonly code: ControllerManagementOutcomeCode,
    status: HttpStatus.FORBIDDEN | HttpStatus.CONFLICT | HttpStatus.GONE,
  ) {
    super(
      {
        success: false,
        message: CONTROLLER_MANAGEMENT_MESSAGE,
        code,
        data: null,
        timestamp: new Date().toISOString(),
        statusCode: status,
        path: '',
      },
      status,
    );
  }
}

export class ControllerManagementWrongOwnerException extends ControllerManagementException {
  constructor() {
    super(ControllerManagementOutcomeCode.WrongOwner, HttpStatus.FORBIDDEN);
  }
}

export class ControllerManagementMachineRevokedException extends ControllerManagementException {
  constructor() {
    super(
      ControllerManagementOutcomeCode.MachineRevoked,
      HttpStatus.GONE,
    );
  }
}

export class ControllerManagementInvalidStateException extends ControllerManagementException {
  constructor() {
    super(ControllerManagementOutcomeCode.InvalidState, HttpStatus.CONFLICT);
  }
}

export class ControllerManagementAlreadyRevokedException extends ControllerManagementException {
  constructor() {
    super(
      ControllerManagementOutcomeCode.AlreadyRevoked,
      HttpStatus.CONFLICT,
    );
  }
}

export class ExistingMachineEnrollmentRejectedException extends ConflictException {
  constructor(readonly reason: 'INVALID_STATE' | 'MACHINE_REVOKED') {
    super({
      message: CONTROLLER_MANAGEMENT_MESSAGE,
      code: reason,
    });
  }
}
