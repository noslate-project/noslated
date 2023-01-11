export class AbortError extends Error {
  constructor(reason?: unknown) {
    if (reason) {
      super(`Aborted, reason(${reason})`);
    } else {
      super('Aborted');
    }
    this.name = 'AbortError';
    this.code = 'ABORT_ERR';
  }
}
