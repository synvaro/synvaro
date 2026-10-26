export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = env.WEB_ORIGIN ?? (production ? '' : 'http://127.0.0.1:3000');
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('WEB_ORIGIN must be an explicit web origin');
  }
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (production && url.protocol !== 'https:') ||
    (url.protocol === 'http:' &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  ) {
    throw new Error(
      'WEB_ORIGIN must use HTTPS, except loopback in development/test',
    );
  }
  const databaseUrl = env.DATABASE_URL;
  try {
    if (
      !databaseUrl ||
      !['postgresql:', 'postgres:'].includes(new URL(databaseUrl).protocol)
    )
      throw new Error();
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  return {
    origin,
    registrationEnabled: !production,
    databaseUrl: databaseUrl!,
    secure: production || url.protocol === 'https:',
    cookieName:
      production || url.protocol === 'https:'
        ? '__Host-synvaro-session'
        : 'synvaro-session',
  };
}
export type AuthConfig = ReturnType<typeof loadAuthConfig>;
