import { ConfigModule } from '@nestjs/config';

export {
  assertDeploymentEnvironmentConfigured,
  DEPLOYMENT_ENVIRONMENTS,
  getDeploymentEnvironment,
  type DeploymentEnvironment,
} from './deployment-environment';

// Load local overrides before modules import Prisma Client. Prisma reads .env
// during module evaluation, before the application module is initialized.
ConfigModule.forRoot({
  envFilePath: ['.env.local', '.env'],
});
