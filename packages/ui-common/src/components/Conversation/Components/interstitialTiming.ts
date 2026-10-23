export interface InterstitialTiming {
  startAt: string;
  endAt?: string;
}

export interface InterstitialSegment {
  text: string;
  timestamp: string | null;
}

/** The established horizontal rule is the only interstitial segment boundary. */
const INTERSTITIAL_DELIMITER = /^[ \t]*(?:[─━—―⎯-][ \t]*){3,}$/m;

const INTERSTITIAL_TIMESTAMP_SUFFIX =
  /\s+--\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s*$/;

const isUtcIsoTimestamp = (value: string): boolean =>
  Number.isFinite(Date.parse(value));

const parseInterstitialTimestamp = (segment: string): string | null => {
  const suffix = segment.match(INTERSTITIAL_TIMESTAMP_SUFFIX);
  if (!suffix || !isUtcIsoTimestamp(suffix[1])) {
    return null;
  }

  return suffix[1];
};

const parseInterstitialSegment = (segment: string): InterstitialSegment => {
  const trimmedSegment = segment.trim();
  const timestamp = parseInterstitialTimestamp(trimmedSegment);
  if (!timestamp) {
    return { text: trimmedSegment, timestamp: null };
  }

  const suffix = trimmedSegment.match(INTERSTITIAL_TIMESTAMP_SUFFIX);
  const suffixStart = suffix?.index;
  return {
    text:
      suffixStart === undefined
        ? trimmedSegment
        : trimmedSegment.slice(0, suffixStart).trimEnd(),
    timestamp,
  };
};

export const getInterstitialSegments = (
  response: string | null | undefined
): InterstitialSegment[] => {
  if (!response) return [];

  return response
    .split(INTERSTITIAL_DELIMITER)
    .map(parseInterstitialSegment)
    .filter(({ text, timestamp }) => text.length > 0 || timestamp !== null);
};

/**
 * Reads producer timestamps embedded in the canonical interstitial response.
 */
export const getInterstitialTiming = (
  response: string | null | undefined
): InterstitialTiming | null => {
  const segments = getInterstitialSegments(response);
  const startAt = segments.find(({ timestamp }) => timestamp !== null)
    ?.timestamp;
  if (!startAt) return null;

  const finalTimestamp = segments[segments.length - 1]?.timestamp;
  return finalTimestamp ? { startAt, endAt: finalTimestamp } : { startAt };
};

export const getElapsedInterstitialDurationMs = (
  timing: InterstitialTiming,
  now = Date.now(),
  isActive = false
): number | null => {
  const start = Date.parse(timing.startAt);
  if (!isActive && !timing.endAt) return null;
  const end = !isActive && timing.endAt ? Date.parse(timing.endAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  return Math.max(0, end - start);
};

export const formatInterstitialDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};
