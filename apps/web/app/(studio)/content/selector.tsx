'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
export function BrandSelector({
  brands,
  selected,
}: {
  brands: { id: string; name: string }[];
  selected: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="brand-selector">
      <label htmlFor="draft-brand">Brand</label>
      <select
        id="draft-brand"
        value={selected}
        disabled={pending}
        onChange={(event) => {
          const id = event.target.value;
          start(() => router.push(id ? `/content?brandId=${id}` : '/content'));
        }}
      >
        <option value="">Select a brand</option>
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>
      <p role="status">{pending ? 'Loading drafts…' : ''}</p>
    </div>
  );
}
