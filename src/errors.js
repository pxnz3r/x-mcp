export class XAccessError extends Error {
  constructor(message, { hint, code, status } = {}) {
    super(message);
    this.name = 'XAccessError';
    this.hint = hint;
    this.code = code;
    this.status = status;
  }

  format() {
    return this.hint ? `${this.message}\n${this.hint}` : this.message;
  }
}

export const AUTH_HINT =
  'Copy the auth_token and ct0 cookies from x.com (DevTools > Application > Cookies), then set X_AUTH_TOKEN and X_CT0 in .env or put {"auth_token":"...","ct0":"..."} in auth.json.';

export const COBALT_HINT =
  'Set COBALT_API_URL to a cobalt instance you control or are allowed to use. See https://github.com/imputnet/cobalt for self-hosting.';
