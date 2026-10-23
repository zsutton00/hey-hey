const PRODUCTION_WEB_ORIGIN = 'https://heyhey.dev';
const LOCAL_API_ORIGIN = 'http://localhost:3000';
const LOCAL_WEB_ORIGIN = 'http://localhost:5173';

export type PairingWebRoute = 'pairing' | 'add-controller';

export const resolvePairingWebOrigin = (env: NodeJS.ProcessEnv = process.env): string => {
  const override = env['HEYHEY_WEB_ORIGIN']?.trim();
  if (override) return new URL(override).origin;

  const apiUrl = env['HEYHEY_API_URL']?.trim();
  if (apiUrl && new URL(apiUrl).origin === LOCAL_API_ORIGIN) return LOCAL_WEB_ORIGIN;

  return PRODUCTION_WEB_ORIGIN;
};

export const resolvePairingUrl = (
  userCode: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  route: PairingWebRoute = 'pairing',
): string => {
  const pairingUrl = new URL(
    route === 'add-controller' ? '/add-controller' : '/pairing',
    resolvePairingWebOrigin(env),
  );
  if (userCode !== undefined) {
    pairingUrl.searchParams.set('code', userCode);
  }
  return pairingUrl.toString();
};
