import {
  getDeploymentEnvironment,
  assertDeploymentEnvironmentConfigured,
} from '../load-environment';

describe('deployment environment configuration', () => {
  const originalValue = process.env.DEPLOYMENT_ENVIRONMENT;
  const originalNodeValue = process.env.NODE_ENV;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.DEPLOYMENT_ENVIRONMENT;
    } else {
      process.env.DEPLOYMENT_ENVIRONMENT = originalValue;
    }
    if (originalNodeValue === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeValue;
    }
  });

  it('uses the deployment-owned staging value independently of NODE_ENV', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEPLOYMENT_ENVIRONMENT = ' StAgInG ';

    expect(getDeploymentEnvironment()).toBe('staging');
    expect(() => assertDeploymentEnvironmentConfigured()).not.toThrow();
  });

  it.each([undefined, '', 'preview'])(
    'fails fast for an absent or invalid deployment environment: %s',
    (value) => {
      if (value === undefined) {
        delete process.env.DEPLOYMENT_ENVIRONMENT;
      } else {
        process.env.DEPLOYMENT_ENVIRONMENT = value;
      }

      expect(() => assertDeploymentEnvironmentConfigured()).toThrow(
        'DEPLOYMENT_ENVIRONMENT must be set',
      );
    },
  );
});
