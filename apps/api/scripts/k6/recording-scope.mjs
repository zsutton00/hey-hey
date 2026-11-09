// Deployment names come from the checked-in staging and production profiles.
// Keep the environment selection fixed before constructing remote commands.
export function recordingScope() {
  const environment = process.env.API_DIAGNOSTIC_ENVIRONMENT || 'staging';
  if (!['staging', 'production'].includes(environment)) {
    throw new Error('API_DIAGNOSTIC_ENVIRONMENT must be staging or production');
  }
  return {
    environment,
    project: environment === 'production' ? 'hey-hey' : 'hey-hey-staging',
    remoteEnvironment: `API_DIAGNOSTIC_ENVIRONMENT=${environment}`,
    neo4jPort: environment === 'production' ? 7474 : 17474,
  };
}
