import { notFound, redirect } from 'next/navigation';
import type { BrandProfileResponse } from '@synvaro/contracts';
import { apiBase, sessionCookieHeader } from '../../../../../lib/auth';
import { currentBrands } from '../../../../../lib/organization-brand';
import { ProfileEditor } from './profile-editor';

export default async function BrandProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const response = await fetch(`${apiBase()}/brands/${id}/profile`, {
    headers: { cookie: await sessionCookieHeader() },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 401) redirect('/login');
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Brand profile is temporarily unavailable');
  const { profile } = (await response.json()) as BrandProfileResponse;
  const brand = (await currentBrands()).find((item) => item.id === id);
  if (!brand) notFound();
  return (
    <ProfileEditor
      brandId={id}
      brandName={brand.name}
      initialProfile={profile}
    />
  );
}
