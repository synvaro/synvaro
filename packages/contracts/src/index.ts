/** SYN-001-A1: process liveness only; not database/provider readiness. */
export interface HealthResponse {
  status: 'ok';
  service: 'synvaro-api';
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string;
}

/** SYN-002A public auth projection. No password/session fields. */
export interface AuthUser {
  id: string;
  email: string;
}
export interface AuthResponse {
  user: AuthUser;
}
