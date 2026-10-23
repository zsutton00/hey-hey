import { ControllerAuthorizationCadence } from '@prisma/client';

export const REMOVED_CONTROLLER_AUTHORIZATION_CADENCES =
  new Set<ControllerAuthorizationCadence>([
    ControllerAuthorizationCadence.EVERY_ACTION,
    ControllerAuthorizationCadence.CURRENT_BROWSER_SESSION,
  ]);

export function isRemovedControllerAuthorizationCadence(
  cadence: ControllerAuthorizationCadence,
): boolean {
  return REMOVED_CONTROLLER_AUTHORIZATION_CADENCES.has(cadence);
}
