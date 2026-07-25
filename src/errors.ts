/** Требуется вход на форум: закрытый раздел, хайд или скрытая от гостей ссылка. */
export class AuthRequiredError extends Error {
  readonly code = 'AUTH_REQUIRED';
  constructor(
    message: string,
    readonly target: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class HttpError extends Error {
  readonly code = 'HTTP_ERROR';
  constructor(
    readonly status: number,
    readonly target: string,
    message?: string,
  ) {
    super(message || `HTTP ${status} при запросе ${target}`);
    this.name = 'HttpError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class BrowserUnavailableError extends Error {
  readonly code = 'BROWSER_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'BrowserUnavailableError';
  }
}
