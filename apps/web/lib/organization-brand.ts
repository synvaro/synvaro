import 'server-only';
import { redirect } from 'next/navigation';
import type { OrganizationResponse, BrandsResponse } from '@synvaro/contracts';
import { apiBase, sessionCookieHeader } from './auth';

async function read(path: string) {
  const response = await fetch(`${apiBase()}${path}`, {
    headers: { cookie: await sessionCookieHeader() },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 401) redirect('/login');
  if (!response.ok) throw new Error('Studio data is temporarily unavailable');
  return response.json();
}
export async function currentOrganization() {
  return ((await read('/organizations/me')) as OrganizationResponse)
    .organization;
}
export async function currentBrands() {
  return ((await read('/brands')) as BrandsResponse).brands;
}
