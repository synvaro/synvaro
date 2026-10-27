import { notFound } from 'next/navigation';
import { currentBrands } from '../../../../../lib/organization-brand';
import { SocialAccounts } from './social-accounts';

export default async function SocialAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ attempt?: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const brand = (await currentBrands()).find((item) => item.id === id);
  if (!brand) notFound();
  const { attempt } = await searchParams;
  return (
    <SocialAccounts brandId={id} brandName={brand.name} attemptId={attempt} />
  );
}
