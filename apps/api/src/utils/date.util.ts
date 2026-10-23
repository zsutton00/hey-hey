export const ensureStringDate = (date?: Date | string): string => {
  if (typeof date === 'string') {
    return date;
  }
  return date?.toISOString() || '';
};
