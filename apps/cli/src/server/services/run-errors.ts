/** A run cannot be created because Services it needs have no folder on this machine. */
export class MissingServiceBindingError extends Error {
  public constructor(
    public readonly serviceIds: string[],
    public readonly launchServiceId: string,
  ) {
    super(`Service ${launchServiceId} isn't bound to a folder on this machine.`);
    this.name = 'MissingServiceBindingError';
  }
}
