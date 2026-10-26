import { notFound } from 'next/navigation';
import { draft } from '../../../../lib/content';
import { currentBrands } from '../../../../lib/organization-brand';
import { DraftEditor } from '../editor';
export default async function EditDraft({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const content = await draft(id);
  const brand = (await currentBrands()).find(
    (item) => item.id === content.brandId,
  );
  if (!brand) notFound();
  return <DraftEditor key={content.id} brand={brand} initial={content} />;
}
