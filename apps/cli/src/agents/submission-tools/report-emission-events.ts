export interface ReportEmission {
  runId: string;
  reportId: string;
  reportType?: string;
}

export type ReportEmissionListener = (emission: ReportEmission) => void;

/**
 * Lifecycle channel for successful report emissions.
 *
 * The report proxy can be constructed before the monitor pipeline while the
 * eventual publisher subscribes once monitor ownership is available.
 */
export class ReportEmissionEvents {
  private readonly listeners = new Set<ReportEmissionListener>();

  public subscribe(listener: ReportEmissionListener): void {
    this.listeners.add(listener);
  }

  public unsubscribe(listener: ReportEmissionListener): void {
    this.listeners.delete(listener);
  }

  public publish(emission: ReportEmission): void {
    for (const listener of this.listeners) {
      listener(emission);
    }
  }
}
