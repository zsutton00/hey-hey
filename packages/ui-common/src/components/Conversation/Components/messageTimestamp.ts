const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const ONE_DAY_MS = 86_400_000;

export const formatMessageTimestamp = (createdAt: string): string => {
  const parsedDate = new Date(createdAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return createdAt;
  }
  const isOlderThanADay = Date.now() - parsedDate.getTime() > ONE_DAY_MS;
  return isOlderThanADay
    ? DATE_TIME_FORMATTER.format(parsedDate)
    : TIME_FORMATTER.format(parsedDate);
};
