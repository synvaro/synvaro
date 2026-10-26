import 'server-only';
import { notFound, redirect } from 'next/navigation';
import type { ContentResponse, ContentsResponse } from '@synvaro/contracts';
import { apiBase, sessionCookieHeader } from './auth';
async function read(path: string) {
  const response = await fetch(`${apiBase()}${path}`, {
    headers: { cookie: await sessionCookieHeader() },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 401) redirect('/login');
  if (response.status === 404 || response.status === 400) notFound();
  if (!response.ok) throw new Error('Drafts are temporarily unavailable');
  return response.json();
}
export async function drafts(brandId: string) {
  return (
    (await read(
      `/contents?brandId=${encodeURIComponent(brandId)}`,
    )) as ContentsResponse
  ).contents;
}
export async function draft(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return ((await read(`/contents/${id}`)) as ContentResponse).content;
}
