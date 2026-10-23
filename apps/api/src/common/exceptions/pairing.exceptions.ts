import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';

export const PAIRING_CODE_EXPIRED = 'PAIRING_CODE_EXPIRED' as const;
export const PAIRING_CODE_ALREADY_USED = 'PAIRING_CODE_ALREADY_USED' as const;
export const PAIRING_ATTEMPTS_EXCEEDED = 'PAIRING_ATTEMPTS_EXCEEDED' as const;
export const LEGACY_MACHINE_PAIRING_RETIRED =
  'LEGACY_MACHINE_PAIRING_RETIRED' as const;
export const INVALID_MACHINE_MATERIAL = 'INVALID_MACHINE_MATERIAL' as const;
export const ENROLLMENT_CREATION_RATE_LIMITED =
  'ENROLLMENT_CREATION_RATE_LIMITED' as const;
export const MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE =
  'MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE' as const;
export const MACHINE_ENROLLMENT_CLAIM_EXPIRED =
  'MACHINE_ENROLLMENT_CLAIM_EXPIRED' as const;
export const MACHINE_ENROLLMENT_CLAIM_TERMINAL =
  'MACHINE_ENROLLMENT_CLAIM_TERMINAL' as const;
export const MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE =
  'MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE' as const;
export const MACHINE_ENROLLMENT_CLAIM_RATE_LIMITED =
  'MACHINE_ENROLLMENT_CLAIM_RATE_LIMITED' as const;
export const MACHINE_ENROLLMENT_AUTHENTICATION_FAILED =
  'MACHINE_ENROLLMENT_AUTHENTICATION_FAILED' as const;
export const MACHINE_ENROLLMENT_INVALID_TRANSITION =
  'MACHINE_ENROLLMENT_INVALID_TRANSITION' as const;
export const MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH =
  'MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH' as const;
export const MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH_MESSAGE =
  'The pairing attempt originated from a different account.' as const;

export type PairingErrorCode =
  | typeof PAIRING_CODE_EXPIRED
  | typeof PAIRING_CODE_ALREADY_USED
  | typeof PAIRING_ATTEMPTS_EXCEEDED
  | typeof LEGACY_MACHINE_PAIRING_RETIRED
  | typeof INVALID_MACHINE_MATERIAL
  | typeof ENROLLMENT_CREATION_RATE_LIMITED
  | typeof MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE
  | typeof MACHINE_ENROLLMENT_CLAIM_EXPIRED
  | typeof MACHINE_ENROLLMENT_CLAIM_TERMINAL
  | typeof MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE
  | typeof MACHINE_ENROLLMENT_CLAIM_RATE_LIMITED
  | typeof MACHINE_ENROLLMENT_AUTHENTICATION_FAILED
  | typeof MACHINE_ENROLLMENT_INVALID_TRANSITION;

export interface PairingExceptionPayload {
  message: string;
  code: PairingErrorCode;
  retryAfterSeconds?: number;
}

export class PairingCodeExpiredException extends HttpException {
  constructor(message = 'Pairing code has expired') {
    const payload: PairingExceptionPayload = {
      message,
      code: PAIRING_CODE_EXPIRED,
    };
    super(payload, HttpStatus.GONE);
  }
}

export class PairingCodeAlreadyUsedException extends HttpException {
  constructor(message = 'Pairing code has already been redeemed') {
    const payload: PairingExceptionPayload = {
      message,
      code: PAIRING_CODE_ALREADY_USED,
    };
    super(payload, HttpStatus.CONFLICT);
  }
}

export class PairingAttemptsExceededException extends HttpException {
  constructor(
    retryAfterSeconds: number,
    message = 'Too many failed pairing attempts for this code',
  ) {
    const payload: PairingExceptionPayload = {
      message,
      code: PAIRING_ATTEMPTS_EXCEEDED,
      retryAfterSeconds,
    };
    super(payload, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export class LegacyMachinePairingRetiredException extends HttpException {
  constructor() {
    super(
      {
        message: 'Legacy machine pairing is retired.',
        code: LEGACY_MACHINE_PAIRING_RETIRED,
        data: null,
      },
      HttpStatus.GONE,
    );
  }
}

export class InvalidMachineEnrollmentMaterialException extends BadRequestException {
  constructor() {
    super({
      message: 'Invalid machine enrollment request.',
      code: INVALID_MACHINE_MATERIAL,
    });
  }
}

export class MachineEnrollmentCreationRateLimitException extends HttpException {
  constructor(retryAfterSeconds: number) {
    super(
      {
        message: 'Too many enrollment attempts. Try again later.',
        code: ENROLLMENT_CREATION_RATE_LIMITED,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class MachineEnrollmentClaimFailedException extends BadRequestException {
  constructor(
    code:
      | typeof MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE
      | typeof MACHINE_ENROLLMENT_CLAIM_EXPIRED
      | typeof MACHINE_ENROLLMENT_CLAIM_TERMINAL
      | typeof MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE =
      MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
  ) {
    const messages = {
      [MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE]:
        'Unable to claim this enrollment.',
      [MACHINE_ENROLLMENT_CLAIM_EXPIRED]:
        'This enrollment has expired. Start a fresh enrollment from the CLI.',
      [MACHINE_ENROLLMENT_CLAIM_TERMINAL]:
        'This enrollment can no longer be claimed. Start a fresh enrollment from the CLI.',
      [MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE]:
        'This browser is not compatible with the current enrollment contract. Refresh Hey Hey and try again.',
    } as const;
    super({
      message: messages[code],
      code,
    });
  }
}

export class MachineEnrollmentClaimRateLimitException extends HttpException {
  constructor(retryAfterSeconds: number) {
    super(
      {
        message:
          'Too many enrollment claim attempts. Wait before retrying this enrollment.',
        code: MACHINE_ENROLLMENT_CLAIM_RATE_LIMITED,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class MachineEnrollmentAuthenticationFailedException extends UnauthorizedException {
  constructor() {
    super({
      message: 'Unable to authenticate this enrollment.',
      code: MACHINE_ENROLLMENT_AUTHENTICATION_FAILED,
    });
  }
}

export class MachineEnrollmentInvalidTransitionException extends ConflictException {
  constructor() {
    super({
      message: 'Unable to transition this enrollment.',
      code: MACHINE_ENROLLMENT_INVALID_TRANSITION,
    });
  }
}
