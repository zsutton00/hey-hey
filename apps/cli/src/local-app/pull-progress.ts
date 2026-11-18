/** Combined download status shown to the user; only numbers, never Docker's own text. */
export interface DownloadDetail {
  kind: 'images' | 'model';
  /** File name for model downloads. */
  label?: string;
  bytesDone: number;
  /** Null until every known layer reports a size. */
  bytesTotal: number | null;
  /** Null whenever the total is not yet known. */
  percent: number | null;
  layersDone?: number;
  layersTotal?: number;
}

export type PullProgressMode = 'json' | 'text';

interface Layer {
  /** Bytes actually measured as downloaded. */
  current: number;
  /** Null while the layer's size has never been reported; completion does not invent one. */
  total: number | null;
  done: boolean;
}

const UNITS: Record<string, number> = {
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
};

function parseSize(text: string): number | null {
  const match = /^([\d.]+)\s*([KMGT]?i?B)$/iu.exec(text.trim());
  const unit = match?.[2] ? UNITS[match[2].toUpperCase()] : undefined;
  return match?.[1] && unit ? Math.round(Number(match[1]) * unit) : null;
}

const DONE_TEXT = /^(Download complete|Pull complete|Already exists|Layer already exists)$/iu;
const KNOWN_TEXT = /^(Pulling fs layer|Waiting|Extracting|Verifying Checksum|Pulling|Pulled)$/iu;

/** Sums bytes and layers across every image Compose is pulling. */
export class PullProgressAggregator {
  private readonly layers = new Map<string, Layer>();
  private unrecognized = 0;
  readonly startedAt = Date.now();

  constructor(readonly mode: PullProgressMode) {}

  get unrecognizedLines(): number {
    return this.unrecognized;
  }

  /** Feeds one redacted output line. Returns whether the aggregate may have changed. */
  feed(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }
    const accepted = this.mode === 'json' ? this.feedJson(trimmed) : this.feedText(trimmed);
    if (!accepted) {
      this.unrecognized += 1;
    }
    return accepted;
  }

  private feedJson(line: string): boolean {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return false;
    }
    if (!isPullEvent(event)) {
      return false;
    }
    if (event.status === 'Error') {
      // Failure events carry the cause, so they stay with the failure capture.
      return false;
    }
    if (!event.parent_id) {
      return true;
    }
    this.apply(event.id, event.text, {
      current: event.current,
      total: event.total,
      status: event.status,
    });
    return true;
  }

  private feedText(line: string): boolean {
    const match = /^([0-9a-f]{12})\s+(.+)$/u.exec(line);
    if (!match?.[1] || !match[2]) {
      // Image-level lines such as "Image x Pulling" carry no layer state.
      return /^\S*\s*Image\s/u.test(line) || /^\[\+\]/u.test(line);
    }
    const rest = match[2].trim();
    const sizes = /([\d.]+\s*[KMGT]?i?B)\s*\/\s*([\d.]+\s*[KMGT]?i?B)/iu.exec(rest);
    const text = rest.replace(/\s*\[[^\]]*\].*$/u, '').trim();
    this.apply(match[1], text, {
      current: sizes?.[1] ? (parseSize(sizes[1]) ?? undefined) : undefined,
      total: sizes?.[2] ? (parseSize(sizes[2]) ?? undefined) : undefined,
    });
    return DONE_TEXT.test(text) || KNOWN_TEXT.test(text) || /^Downloading/iu.test(text);
  }

  private apply(
    id: string,
    text: string,
    values: { current?: number | undefined; total?: number | undefined; status?: string },
  ): void {
    const layer = this.layers.get(id) ?? { current: 0, total: null, done: false };
    this.layers.set(id, layer);
    if (values.total !== undefined) {
      layer.total = values.total;
    }
    if (/^Downloading/iu.test(text) && values.current !== undefined) {
      layer.current = values.current;
    }
    if (/^(Already exists|Layer already exists)$/iu.test(text)) {
      // Nothing to download for a layer Docker already has.
      layer.total = 0;
    }
    if (DONE_TEXT.test(text) || values.status === 'Done') {
      layer.done = true;
      if (layer.total !== null) {
        layer.current = layer.total;
      }
    }
  }

  detail(): DownloadDetail {
    const layers = [...this.layers.values()];
    const bytesDone = layers.reduce((sum, layer) => sum + layer.current, 0);
    // A total is only honest when every layer, finished or not, has a measured size.
    const sized = layers.length > 0 && layers.every((layer) => layer.total !== null);
    const bytesTotal = sized ? layers.reduce((sum, layer) => sum + (layer.total ?? 0), 0) : null;
    return {
      kind: 'images',
      bytesDone,
      bytesTotal,
      percent:
        bytesTotal && bytesTotal > 0
          ? Math.min(100, Math.floor((bytesDone / bytesTotal) * 100))
          : null,
      layersDone: layers.filter((layer) => layer.done).length,
      layersTotal: layers.length,
    };
  }
}

interface PullEvent {
  id: string;
  parent_id?: string;
  status: string;
  text: string;
  current?: number;
  total?: number;
}

/** Narrowing for Compose's `--progress json` events. */
function isPullEvent(value: unknown): value is PullEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['id'] === 'string' &&
    typeof record['status'] === 'string' &&
    typeof record['text'] === 'string' &&
    (record['current'] === undefined || typeof record['current'] === 'number') &&
    (record['total'] === undefined || typeof record['total'] === 'number')
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) {
    return `${(bytes / 1e9).toFixed(1)} GB`;
  }
  if (bytes >= 1e6) {
    return `${Math.round(bytes / 1e6)} MB`;
  }
  return `${Math.max(0, Math.round(bytes / 1e3))} KB`;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** One-line wording shared by the terminal screen and plain non-interactive output. */
export function describeDownload(
  label: string,
  detail: DownloadDetail | undefined,
  elapsedMs: number,
): string {
  const seconds = Math.floor(elapsedMs / 1000);
  const spinner = SPINNER[Math.floor(elapsedMs / 250) % SPINNER.length] ?? '';
  if (!detail) {
    return `${label} ${spinner} ${seconds}s`;
  }
  const layers =
    detail.layersTotal === undefined
      ? ''
      : ` · ${detail.layersDone ?? 0} of ${detail.layersTotal} layers done`;
  if (detail.bytesTotal === null || detail.percent === null) {
    const measured = detail.bytesDone > 0 ? ` · ${formatBytes(detail.bytesDone)} downloaded` : '';
    return `${label} ${spinner} ${seconds}s${measured}${layers}`;
  }
  return `${label} — ${formatBytes(detail.bytesDone)} of ${formatBytes(detail.bytesTotal)} (${detail.percent}%)${layers}`;
}
