/** Dedicated bridge port for local Hey Hey; production uses 3847, staging 3849, `--local` dev 3848. */
export const DEFAULT_LOCAL_BRIDGE_PORT = 3851;

/** The effective local bridge port: an explicit HEYHEY_SERVER_PORT wins, otherwise the dedicated default. */
export function resolveLocalBridgePort(env: NodeJS.ProcessEnv = process.env): number {
  const requested = Number(env['HEYHEY_SERVER_PORT']);
  return Number.isInteger(requested) && requested > 0 && requested <= 65535
    ? requested
    : DEFAULT_LOCAL_BRIDGE_PORT;
}
