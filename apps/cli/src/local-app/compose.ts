import type { Installation, InstallationSecrets } from './installation-store';

export const LOCAL_PROJECT = 'heyhey-local';
/** The browser, not the API, is the WebAuthn origin: passkeys are bound to the local web app. */
export const LOCAL_WEB_ORIGIN = 'http://localhost:5173';
export const LOCAL_WEB_RP_ID = 'localhost';
export const LOCAL_BROWSER_TOKEN_ISSUER = 'urn:heyhey:local';
/** UI container variable the web app reads at runtime to find the bridge. */
export const LOCAL_AGENT_PORT_VARIABLE = 'VITE_LOCAL_AGENT_PORT';
export const SERVICE_IMAGES = {
  api: 'api',
  ui: 'ui',
  'graph-search': 'graphSearch',
  postgres: 'postgres',
  redis: 'redis',
} as const;

/** Internal Compose document. Every image comes exclusively from the validated release. */
export function composeConfiguration(
  installation: Installation,
  secrets: InstallationSecrets,
  bridgePort: number,
) {
  const { release, modelDirectory } = installation;
  const image = (name: keyof typeof release.images) => release.images[name].reference;
  const labels = { 'dev.heyhey.cli-version': release.cliVersion };
  const apiEnvironment = localApiEnvironment(secrets, CONTAINER_ENDPOINTS);
  const ready = (url: string) => ({
    test: [
      'CMD',
      'node',
      '-e',
      `fetch('${url}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
    ],
    interval: '3s',
    timeout: '5s',
    retries: 40,
    start_period: '10s',
  });
  return {
    name: LOCAL_PROJECT,
    services: {
      postgres: {
        image: image('postgres'),
        labels,
        restart: 'unless-stopped',
        environment: { POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: secrets.admin },
        volumes: ['postgres-data:/var/lib/postgresql/data'],
        healthcheck: {
          test: ['CMD-SHELL', 'pg_isready -U postgres'],
          interval: '3s',
          timeout: '5s',
          retries: 30,
        },
      },
      redis: {
        image: image('redis'),
        labels,
        restart: 'unless-stopped',
        command: ['redis-server', '--appendonly', 'yes'],
        volumes: ['redis-data:/data'],
        healthcheck: {
          test: ['CMD', 'redis-cli', 'ping'],
          interval: '3s',
          timeout: '5s',
          retries: 30,
        },
      },
      api: {
        image: image('api'),
        labels,
        restart: 'unless-stopped',
        environment: apiEnvironment,
        ports: ['127.0.0.1:3000:3000'],
        volumes: ['api-keys:/app/config/keys'],
        healthcheck: ready('http://127.0.0.1:3000/api/v1/auth/jwks'),
      },
      ui: {
        image: image('ui'),
        labels,
        restart: 'unless-stopped',
        ports: ['127.0.0.1:5173:5173'],
        environment: {
          API_HOST: 'localhost',
          API_PORT: '3000',
          API_PROTOCOL: 'http',
          [LOCAL_AGENT_PORT_VARIABLE]: String(bridgePort),
        },
        healthcheck: ready('http://127.0.0.1:5173/'),
      },
      'graph-search': {
        image: image('graphSearch'),
        labels,
        restart: 'unless-stopped',
        environment: {
          GRAPH_SEARCH_DATABASE_URL: `postgres://graph_search:${secrets.graph}@postgres:5432/heyhey_graph_search`,
          GRAPH_SEARCH_BIND: '0.0.0.0:8090',
          GRAPH_SEARCH_JWKS_URL: 'http://api:3000/api/v1/auth/jwks',
          GRAPH_SEARCH_GRAPH_AUDIENCE: 'graph-service',
          GRAPH_SEARCH_SEARCH_AUDIENCE: 'embeddings-service',
          REDIS_URL: 'redis://redis:6379',
          GRAPH_ENABLED: 'true',
          SEARCH_ENABLED: 'true',
          SEARCH_EMBEDDING_MODEL_DIR: '/models/snowflake-arctic-embed-s',
        },
        volumes: [
          {
            type: 'bind',
            source: modelDirectory,
            target: '/models/snowflake-arctic-embed-s',
            read_only: true,
            bind: { create_host_path: false },
          },
        ],
      },
    },
    volumes: { 'postgres-data': {}, 'redis-data': {}, 'api-keys': {} },
  };
}

/** Where the API reaches its infrastructure. Containers use service names; a host process uses published ports. */
export interface InfrastructureEndpoints {
  postgres: { host: string; port: number };
  redis: { host: string; port: number };
  graphSearchUrl: string;
}

const CONTAINER_ENDPOINTS: InfrastructureEndpoints = {
  postgres: { host: 'postgres', port: 5432 },
  redis: { host: 'redis', port: 6379 },
  graphSearchUrl: 'http://graph-search:8090',
};

/** The one definition of the local API's configuration, shared by the installed stack and dev mode. */
export function localApiEnvironment(
  secrets: InstallationSecrets,
  endpoints: InfrastructureEndpoints,
) {
  const { postgres, redis, graphSearchUrl } = endpoints;
  const postgresAddress = `${postgres.host}:${postgres.port}`;
  const apiDatabase = `postgresql://heyhey:${secrets.api}@${postgresAddress}/heyhey`;
  return {
    HEYHEY_LOCAL_APPLICATION: 'true',
    LOCAL_INSTALLATION_SECRET: secrets.admin,
    NODE_ENV: 'production',
    DEPLOYMENT_ENVIRONMENT: 'local',
    PROJECT_DATABASE_URL: `${apiDatabase}?schema=public`,
    FLYWAY_URL: `jdbc:postgresql://${postgresAddress}/heyhey`,
    FLYWAY_USER: 'heyhey',
    FLYWAY_PASSWORD: secrets.api,
    REDIS_URL: `redis://${redis.host}:${redis.port}`,
    REDIS_HOST: redis.host,
    REDIS_PORT: String(redis.port),
    GRAPH_SERVICE_URL: graphSearchUrl,
    EMBEDDINGS_SERVICE_URL: graphSearchUrl,
    JWT_SECRET: secrets.jwt,
    TRIGGER_SIGNING_PRIVATE_KEY: secrets.signingKey,
    SECRET_KEY: secrets.encryption,
    INTEGRATION_ENCRYPTION_KEY: secrets.encryption,
    MACHINE_ENROLLMENT_CODE_HMAC_KEY: secrets.enrollmentCodeHmac,
    // Pairing passkeys are bound to the local UI origin, not the hosted production one.
    MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: LOCAL_WEB_RP_ID,
    MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: LOCAL_WEB_ORIGIN,
    // Account sign-in passkeys use the same local UI origin.
    ACCOUNT_PASSKEY_RP_ID: LOCAL_WEB_RP_ID,
    ACCOUNT_PASSKEY_ORIGIN: LOCAL_WEB_ORIGIN,
    // Local browser credentials carry a local-only issuer, so hosted
    // deployments reject them and this API rejects hosted credentials.
    BROWSER_TOKEN_ISSUER: LOCAL_BROWSER_TOKEN_ISSUER,
    BROWSER_TOKEN_AUDIENCE: LOCAL_WEB_ORIGIN,
    // The api refuses to start unless these match its reviewed browser-session policy.
    BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
    BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
    BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
    PASSWORD_CHANGE_TOKEN_TTL_SECONDS: '900',
    CORS_WHITELIST: LOCAL_WEB_ORIGIN,
  };
}

/**
 * Developer-only: infrastructure ports published on loopback so an API run from source can
 * reach them. Off the usual 5432/6379 so a developer's own databases keep their ports.
 */
export const DEV_INFRASTRUCTURE_ENDPOINTS: InfrastructureEndpoints = {
  postgres: { host: '127.0.0.1', port: 55432 },
  redis: { host: '127.0.0.1', port: 56379 },
  graphSearchUrl: 'http://127.0.0.1:58090',
};

/**
 * Developer-only Compose document for `heyhey local dev`: the same pinned infrastructure and
 * volumes as the installed stack, with loopback-published ports. There is no UI service, and the
 * API service exists only to run Flyway against the checkout's migrations; it is never started.
 * Graph/search reaches the API on the host for its signing keys.
 */
export function devComposeConfiguration(
  installation: Installation,
  secrets: InstallationSecrets,
  bridgePort: number,
  flywayDirectory: string,
) {
  const installed = composeConfiguration(installation, secrets, bridgePort);
  const { postgres, redis, api } = installed.services;
  const graphSearch = installed.services['graph-search'];
  const dev = DEV_INFRASTRUCTURE_ENDPOINTS;
  const graphSearchPort = new URL(dev.graphSearchUrl).port;
  return {
    ...installed,
    services: {
      postgres: { ...postgres, ports: [`127.0.0.1:${dev.postgres.port}:5432`] },
      redis: { ...redis, ports: [`127.0.0.1:${dev.redis.port}:6379`] },
      api: {
        image: api.image,
        labels: api.labels,
        environment: api.environment,
        volumes: [
          { type: 'bind', source: flywayDirectory, target: '/app/db/flyway', read_only: true },
        ],
      },
      'graph-search': {
        ...graphSearch,
        environment: {
          ...graphSearch.environment,
          GRAPH_SEARCH_JWKS_URL: 'http://host.docker.internal:3000/api/v1/auth/jwks',
        },
        extra_hosts: ['host.docker.internal:host-gateway'],
        ports: [`127.0.0.1:${graphSearchPort}:8090`],
      },
    },
  };
}

/** Idempotent administrative provisioning; application migrations remain owned by their services. */
export function provisioningSql(apiPassword: string, graphPassword: string): string {
  return `SELECT 'CREATE ROLE heyhey LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='heyhey')\n\\gexec
ALTER ROLE heyhey PASSWORD '${apiPassword}';
SELECT 'CREATE DATABASE heyhey OWNER heyhey' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='heyhey')\n\\gexec
SELECT 'CREATE ROLE graph_search LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='graph_search')\n\\gexec
ALTER ROLE graph_search PASSWORD '${graphPassword}';
SELECT 'CREATE DATABASE heyhey_graph_search OWNER graph_search' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='heyhey_graph_search')\n\\gexec
\\connect heyhey_graph_search
CREATE EXTENSION IF NOT EXISTS vector VERSION '0.8.7';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
`;
}
