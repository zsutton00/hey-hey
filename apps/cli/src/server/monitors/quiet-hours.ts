/**
 * Check if the current time falls within the quiet-hours window. Handles
 * windows that cross midnight (e.g. 23:00–07:00). Lifted from the deleted
 * trigger engine — quiet-hours suppression is a pipeline concern, applied by
 * the pre-subscribe filter before an event reaches any monitor.
 */
export const isQuietHours = (quietHours: { start: string; end: string }): boolean => {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();

  const startParts = quietHours.start.split(':').map(Number);
  const endParts = quietHours.end.split(':').map(Number);
  const start = (startParts[0] ?? 0) * 60 + (startParts[1] ?? 0);
  const end = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0);

  if (start <= end) {
    return minutes >= start && minutes < end;
  }
  // Crosses midnight.
  return minutes >= start || minutes < end;
};
