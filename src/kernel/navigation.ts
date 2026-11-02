/** user-requested cancellation, distinct from an operation failure */
export class InteractionExit extends Error {
  public readonly action: 'cancel';

  /**
   * identifies a cancellation without an operational error message
   * @param action requested navigation
   */
  constructor(action: 'cancel') {
    super('Cancelled by user.');
    this.action = action;
  }
}
