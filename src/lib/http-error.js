export class HttpError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.field = options.field;
    this.expose = options.expose ?? status < 500;
  }
}
