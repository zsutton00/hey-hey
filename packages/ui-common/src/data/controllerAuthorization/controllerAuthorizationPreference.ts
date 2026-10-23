import {
  ControllerAuthorizationCadence,
  type ControllerAuthorizationCadence as ControllerAuthorizationCadenceValue,
} from "../../api";

export interface ControllerAuthorizationPreference {
  cadence: ControllerAuthorizationCadenceValue;
}

interface PreferenceOwnerDependencies {
  storage?: Storage;
}

const STORAGE_PREFIX = "hey-hey:controller-authorization:v2";
const CADENCES = new Set<ControllerAuthorizationCadenceValue>(
  Object.values(ControllerAuthorizationCadence)
);

const requireStorage = (storage: Storage | undefined): Storage => {
  const resolved =
    storage ??
    (typeof window === "undefined" ? undefined : window.localStorage);
  if (!resolved) {
    throw new Error(
      "Controller authorization preferences require browser storage."
    );
  }
  return resolved;
};

const cadenceKey = (organizationId: string): string =>
  `${STORAGE_PREFIX}:${encodeURIComponent(organizationId)}:cadence`;

const readCadence = (
  storage: Storage,
  key: string
): ControllerAuthorizationCadenceValue => {
  const value = storage.getItem(key);
  if (value && CADENCES.has(value as ControllerAuthorizationCadenceValue)) {
    return value as ControllerAuthorizationCadenceValue;
  }
  if (value) storage.removeItem(key);
  return ControllerAuthorizationCadence.FiveMinutes;
};

export const readControllerAuthorizationPreference = (
  organizationId: string,
  dependencies: PreferenceOwnerDependencies = {}
): ControllerAuthorizationPreference => {
  const storage = requireStorage(dependencies.storage);
  return { cadence: readCadence(storage, cadenceKey(organizationId)) };
};

export const writeControllerAuthorizationCadence = (
  organizationId: string,
  cadence: ControllerAuthorizationCadenceValue,
  dependencies: PreferenceOwnerDependencies = {}
): void => {
  if (!CADENCES.has(cadence)) {
    throw new Error("The controller authorization cadence is invalid.");
  }
  requireStorage(dependencies.storage).setItem(
    cadenceKey(organizationId),
    cadence
  );
};
