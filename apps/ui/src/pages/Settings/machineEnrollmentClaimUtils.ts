export const normalizeEnrollmentCode = (value: string): string =>
  value.replace(/[\s-]/g, "").toUpperCase();
