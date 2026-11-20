/** Dedicated browser-facing port for local Hey Hey; Vite's common 5173 stays free for the developer's own app. */
export const DEFAULT_LOCAL_WEB_PORT = 3850;

/**
 * The effective local web port: an explicit HEYHEY_WEB_PORT wins, otherwise the dedicated default.
 * An invalid explicit value is rejected rather than replaced, so the address the user asked for is
 * never silently swapped for another.
 */
export function resolveLocalWebPort(env: NodeJS.ProcessEnv = process.env): number {
  const requested = env['HEYHEY_WEB_PORT']?.trim();
  if (!requested) {
    return DEFAULT_LOCAL_WEB_PORT;
  }

  const port = Number(requested);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`HEYHEY_WEB_PORT must be a port number from 1 to 65535, got "${requested}".`);
  }
  return port;
}

/** The port the packaged web server listens on inside its container. */
export const LOCAL_WEB_CONTAINER_PORT = 5173;

/** Dedicated bridge port for local Hey Hey; production uses 3847, staging 3849, `--local` dev 3848. */
export const DEFAULT_LOCAL_BRIDGE_PORT = 3851;

/** The effective local bridge port: an explicit HEYHEY_SERVER_PORT wins, otherwise the dedicated default. */
export function resolveLocalBridgePort(env: NodeJS.ProcessEnv = process.env): number {
  const requested = Number(env['HEYHEY_SERVER_PORT']);
  return Number.isInteger(requested) && requested > 0 && requested <= 65535
    ? requested
    : DEFAULT_LOCAL_BRIDGE_PORT;
}
