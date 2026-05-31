/** A non-2xx response from a Station server. Mirrors `StationRemoteError`. */
export class GlorpRemoteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message || code);
    this.name = "GlorpRemoteError";
    this.status = status;
    this.code = code;
  }
}
