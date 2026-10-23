import type { CanonicalMonitorEvent } from '../normalizer';
import type { MonitorGate } from '../declarations/types';

export class CountToNGate implements MonitorGate {
  private buffer: CanonicalMonitorEvent[] = [];

  public constructor(private threshold: number) {}

  public reconfigure(threshold: number): void {
    this.threshold = threshold;
    this.buffer = [];
  }

  public accept(event: CanonicalMonitorEvent) {
    this.buffer.push(event);
    if (this.buffer.length >= this.threshold) {
      const batch = this.buffer;
      this.buffer = [];
      return { fired: true, batch };
    }
    return { fired: false, batch: [] };
  }

  public inspect() {
    return { pending: this.buffer.length, threshold: this.threshold };
  }
}

export class EveryEventGate implements MonitorGate {
  public accept(event: CanonicalMonitorEvent) {
    return { fired: true, batch: [event] };
  }

  public inspect() {
    return { pending: 0, threshold: null };
  }
}
