import { constants, accessSync } from 'node:fs';
import { delimiter, join } from 'node:path';

// Run an isolated Redis process using an installed binary when available.
// Pin the source-build fallback: Redis "stable" can introduce new build tools.
process.env.REDISMS_VERSION ??= '7.2.5';
if (!process.env.REDISMS_SYSTEM_BINARY) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const binary = join(directory, 'redis-server');
    try {
      accessSync(binary, constants.X_OK);
      process.env.REDISMS_SYSTEM_BINARY = binary;
      break;
    } catch {
      // Continue looking on PATH; redis-memory-server can build the pinned version.
    }
  }
}

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
