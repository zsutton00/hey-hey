import type { ServicePlaceChoice } from "../../api";

/** Turns a Work in list value into the explicit choice a launch request carries. */
export const resolveChoice = (
  serviceId: string,
  value: ServicePlaceChoice | null,
): ServicePlaceChoice => value ?? { serviceId, kind: "MAIN_FOLDER" };
