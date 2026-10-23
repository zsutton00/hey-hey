export const DEPLOYMENT_ENVIRONMENTS = [
  'development',
  'test',
  'staging',
  'production',
  'local',
] as const;

export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export function getDeploymentEnvironment(): DeploymentEnvironment {
  const value = process.env.DEPLOYMENT_ENVIRONMENT?.trim().toLowerCase();
  if (
    !value ||
    !DEPLOYMENT_ENVIRONMENTS.includes(value as DeploymentEnvironment)
  ) {
    throw new Error(
      'DEPLOYMENT_ENVIRONMENT must be set to development, test, local, staging, or production.',
    );
  }
  return value as DeploymentEnvironment;
}

export function assertDeploymentEnvironmentConfigured(): void {
  getDeploymentEnvironment();
}
