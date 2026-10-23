const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const localDateFromInput = (value: string): Date | null => {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  return date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
    ? date
    : null;
};

export const parseDateForLocalPicker = (value: string | null): Date | null => {
  if (!value) return null;

  const localDate = localDateFromInput(value);
  if (localDate) return localDate;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatLocalDateInputValue = (
  value: string | null | undefined
): string => {
  const date = parseDateForLocalPicker(value ?? null);
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const localDateInputToISOString = (value: string): string | null =>
  localDateFromInput(value)?.toISOString() ?? null;
