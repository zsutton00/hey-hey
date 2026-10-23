import { Injectable } from '@nestjs/common';

export const readHintsEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.HINTS_ENABLED === 'true';

// Deployment-wide trial switch, deliberately not stored on the project.
@Injectable()
export class HintsConfig {
  readonly enabled = readHintsEnabled();
}
