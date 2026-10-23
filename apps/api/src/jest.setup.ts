// Silence all application logging during tests.
// Winston logger respects LOG_LEVEL=silent.
// NestJS Logger respects Logger.overrideLogger([]).
process.env.LOG_LEVEL = 'silent';
process.env.LOG_TO_FILE = 'false';
process.env.LOGSTASH_ENABLED = 'false';
process.env.MACHINE_ENROLLMENT_CODE_HMAC_KEY ??= 'test-machine-enrollment-code-hmac-key';
process.env.MACHINE_ENROLLMENT_WEBAUTHN_RP_ID ??= 'localhost.test';
process.env.MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN ??= 'https://localhost.test';

// Silence NestJS built-in Logger (used as fallback in ContextAwareLogger)
import { Logger } from '@nestjs/common';
Logger.overrideLogger([]);
