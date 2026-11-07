/**
 * Error envelope shared by the domain, the repositories and the HTTP surface.
 * See docs/TACTICAL-DESIGN.md §8.
 */

export type AppErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "STALE_VERSION"
  | "INPUT_PENDING"
  | "INPUT_NOT_PENDING"
  | "PAYMENT_NOT_SETTLED"
  | "TERMINAL_STATE"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface AppError {
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** The only shape a failed operation may take. */
export interface Failure {
  ok: false;
  error: AppError;
}

export type Result<T> = { ok: true; data: T } | Failure;

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(
  code: AppErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Failure {
  const error: AppError = details ? { code, message, details } : { code, message };
  return { ok: false, error };
}

/** Narrowing helper for callers that only care about success. */
export function isFailure<T>(result: Result<T>): result is Failure {
  return !result.ok;
}
