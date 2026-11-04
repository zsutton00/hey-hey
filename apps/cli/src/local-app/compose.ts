import type { Installation, InstallationSecrets } from './installation-store';

export const LOCAL_PROJECT = 'heyhey-local';
/** The browser, not the API, is the WebAuthn origin: passkeys are bound to the local web app. */
export const LOCAL_WEB_ORIGIN = 'http://localhost:5173';
export const LOCAL_WEB_RP_ID = 'localhost';
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
  const apiDatabase = `postgresql://heyhey:${secrets.api}@postgres:5432/heyhey`;
  const apiEnvironment = {
    HEYHEY_LOCAL_APPLICATION: 'true',
    LOCAL_INSTALLATION_SECRET: secrets.admin,
    NODE_ENV: 'production',
    DEPLOYMENT_ENVIRONMENT: 'local',
    PROJECT_DATABASE_URL: `${apiDatabase}?schema=public`,
    FLYWAY_URL: 'jdbc:postgresql://postgres:5432/heyhey',
    FLYWAY_USER: 'heyhey',
    FLYWAY_PASSWORD: secrets.api,
    REDIS_URL: 'redis://redis:6379',
    REDIS_HOST: 'redis',
    REDIS_PORT: '6379',
    GRAPH_SERVICE_URL: 'http://graph-search:8090',
    EMBEDDINGS_SERVICE_URL: 'http://graph-search:8090',
    JWT_SECRET: secrets.jwt,
    TRIGGER_SIGNING_PRIVATE_KEY: secrets.signingKey,
    SECRET_KEY: secrets.encryption,
    INTEGRATION_ENCRYPTION_KEY: secrets.encryption,
    MACHINE_ENROLLMENT_CODE_HMAC_KEY: secrets.enrollmentCodeHmac,
    // Pairing passkeys are bound to the local UI origin, not the hosted production one.
    MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: LOCAL_WEB_RP_ID,
    MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: LOCAL_WEB_ORIGIN,
    // The api refuses to start unless these match its reviewed browser-session policy.
    BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
    BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
    BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
    PASSWORD_CHANGE_TOKEN_TTL_SECONDS: '900',
    CORS_WHITELIST: LOCAL_WEB_ORIGIN,
  };
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
