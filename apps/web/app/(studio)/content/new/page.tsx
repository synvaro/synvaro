import { notFound } from 'next/navigation';
import { currentBrands } from '../../../../lib/organization-brand';
import { DraftEditor } from '../editor';
export default async function NewDraft({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string }>;
}) {
  const { brandId } = await searchParams;
  const brand = (await currentBrands()).find((item) => item.id === brandId);
  if (!brand) notFound();
  return <DraftEditor brand={brand} initial={null} />;
}
