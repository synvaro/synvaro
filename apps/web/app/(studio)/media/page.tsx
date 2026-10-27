import { currentBrands } from '../../../lib/organization-brand';
import { MediaWorkspace } from './workspace';
export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string }>;
}) {
  const brands = await currentBrands();
  const { brandId } = await searchParams;
  const selected = brands.some((brand) => brand.id === brandId) ? brandId! : '';
  return (
    <>
      <p className="eyebrow">YOUR STUDIO</p>
      <h1>Media</h1>
      <p className="intro">
        Uploaded originals and accepted AI images, privately stored for each
        brand.
      </p>
      <MediaWorkspace
        initialBrand={selected}
        brands={brands.map(({ id, name }) => ({ id, name }))}
      />
    </>
  );
}
