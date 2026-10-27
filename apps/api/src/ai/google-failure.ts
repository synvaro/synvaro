import { ApiError } from '@google/genai';

export type GooglePhase = 'count' | 'generate';
export type GoogleFailureCategory =
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'AUTHENTICATION'
  | 'PERMISSION'
  | 'UNSUPPORTED_REQUEST'
  | 'SERVER_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'PROVIDER_ERROR';

// Only these bounded fields may reach application diagnostics. SDK messages and
// response bodies can contain user context or credentials and are never copied.
export class GoogleFailure extends Error {
  constructor(
    readonly category: GoogleFailureCategory,
    readonly phase: GooglePhase,
    readonly elapsedMs: number,
    readonly httpStatus: number | null = null,
  ) {
    super(`Google ${phase} ${category}`);
    this.name = 'GoogleFailure';
  }
}

export function classifyGoogleFailure(
  error: unknown,
  phase: GooglePhase,
  elapsedMs: number,
): GoogleFailure {
  if (error instanceof GoogleFailure) return error;
  const status =
    error instanceof ApiError
      ? error.status
      : error instanceof Response
        ? error.status
        : null;
  const name = error instanceof Error ? error.name : '';
  const category: GoogleFailureCategory =
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    status === 408 ||
    status === 504
      ? 'TIMEOUT'
      : status === 429
        ? 'RATE_LIMIT'
        : status === 401
          ? 'AUTHENTICATION'
          : status === 403
            ? 'PERMISSION'
            : status === 400 || status === 404 || status === 422
              ? 'UNSUPPORTED_REQUEST'
              : status !== null && status >= 500
                ? 'SERVER_ERROR'
                : 'PROVIDER_ERROR';
  return new GoogleFailure(category, phase, elapsedMs, status);
}
