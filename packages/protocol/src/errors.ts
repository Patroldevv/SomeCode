export type ErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'turn_in_progress'
  | 'agent_not_installed'
  | 'auth_required'
  | 'disconnected'
  | 'unauthorized'
  | 'forbidden'
  | 'internal';

export class SomeCodeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'SomeCodeError';
    this.code = code;
  }
}
