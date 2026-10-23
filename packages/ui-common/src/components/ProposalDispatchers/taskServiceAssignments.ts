import type { ServiceDto } from "../../api";

export type ResolvedServiceNames =
  | { state: "resolved"; names: string[] }
  | { state: "unavailable" };

export function resolveServiceNames(
  serviceIds: readonly string[],
  services: readonly ServiceDto[]
): ResolvedServiceNames {
  const namesById = new Map(
    services.map((service) => [service.id, service.name])
  );
  const names = serviceIds.map((serviceId) => namesById.get(serviceId));

  if (names.every((name): name is string => name !== undefined)) {
    return { state: "resolved", names };
  }

  return { state: "unavailable" };
}

export function formatServiceNames(names: readonly string[]): string {
  return names.length > 0 ? names.join(", ") : "(none)";
}
