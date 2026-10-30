import 'server-only';
import { cookies } from 'next/headers';
import type { AuthResponse } from '@synvaro/contracts';
import { apiOrigin } from './api-origin';

export function apiBase() {
  return apiOrigin(process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001');
}
export function webOrigin() {
  return process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000';
}
export async function sessionCookieHeader() {
  const store = await cookies();
  return ['__Host-synvaro-session', 'synvaro-session']
    .map((name) => store.get(name))
    .filter((cookie) => cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie.value))
    .map((cookie) => `${cookie!.name}=${cookie!.value}`)
    .join('; ');
}
export async function currentUser() {
  const response = await fetch(`${apiBase()}/auth/me`, {
    headers: { cookie: await sessionCookieHeader() },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Authentication service unavailable');
  return ((await response.json()) as AuthResponse).user;
}
